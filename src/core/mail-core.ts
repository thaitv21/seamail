import type { AppConfig } from './config.js';
import { buildDraft } from './draft/compose.js';
import { MailError } from './errors.js';
import { log } from './log.js';
import type { Repo } from './store/repo.js';
import { parseQuery, type ParsedQuery } from './text/normalize.js';
import { stripQuotes } from './text/quotes.js';
import { makeSnippet } from './text/snippet.js';
import type {
  DraftInput,
  DraftResult,
  EmailFull,
  EmailSummary,
  Freshness,
  ListRecentParams,
  SearchParams,
  StoredMessage,
  SyncResult,
  ThreadParams,
} from './types.js';

/** The part of an IMAP session that drafting needs (ImapSession satisfies it). */
export interface DraftSink {
  append(path: string, raw: Buffer, flags: string[]): Promise<void>;
  close(): Promise<void>;
}

export interface MailCoreDeps {
  repo: Repo;
  syncer: { sync(): Promise<SyncResult> };
  openSession: () => Promise<DraftSink>;
  config: AppConfig;
  now?: () => Date;
  freshnessTimeoutMs?: number;
}

export class MailCore {
  constructor(private readonly deps: MailCoreDeps) {}

  sync(): Promise<SyncResult> {
    return this.deps.syncer.sync();
  }

  async search(p: SearchParams): Promise<{ results: EmailSummary[]; total: number } & Freshness> {
    // Validate the input first, so a bad request fails fast instead of triggering a sync.
    let parsed: ParsedQuery | null = null;
    if (p.query !== undefined && p.query.trim() !== '') {
      parsed = parseQuery(p.query);
      if (!parsed) throw new MailError('INVALID_INPUT', `Nothing searchable in query: ${p.query}`);
    }
    const base = {
      from: p.from,
      to: p.to,
      folder: p.folder,
      after: toIsoBound(p.after, 'after'),
      before: toIsoBound(p.before, 'before'),
      hasAttachment: p.hasAttachment,
      limit: clamp(p.limit ?? 20, 1, 50),
    };
    const freshness = await this.ensureFresh();
    let found: { rows: StoredMessage[]; total: number };
    try {
      found = this.deps.repo.search({ ...base, fts: parsed?.fts ?? null });
    } catch (err) {
      if (!parsed) throw err;
      try {
        found = this.deps.repo.search({ ...base, fts: `"${parsed.terms.join(' ')}"` });
      } catch {
        throw new MailError('INVALID_INPUT', `Could not search for: ${p.query}`);
      }
    }
    const terms = parsed?.terms ?? [];
    return {
      results: found.rows.map((m) => toSummary(m, makeSnippet(m.bodyText, terms))),
      total: found.total,
      ...freshness,
    };
  }

  async getEmail(id: string, maxChars = 8000): Promise<EmailFull & Freshness> {
    const freshness = await this.ensureFresh();
    const message = this.deps.repo.getByKey(id);
    if (!message) throw new MailError('NOT_FOUND', `No email with id ${id}`);
    return { ...toFull(message, message.bodyText, maxChars), ...freshness };
  }

  async getThread(p: ThreadParams): Promise<{ threadId: string; messages: EmailFull[] } & Freshness> {
    if (!p.id && !p.threadId) throw new MailError('INVALID_INPUT', 'Pass either id or threadId');
    const freshness = await this.ensureFresh();
    const threadId = p.threadId ?? this.deps.repo.getByKey(p.id!)?.threadId;
    const rows = threadId ? this.deps.repo.getThread(threadId) : [];
    if (!threadId || rows.length === 0) throw new MailError('NOT_FOUND', `No thread found for ${p.threadId ?? p.id}`);
    const max = p.maxCharsPerMessage ?? 4000;
    return {
      threadId,
      messages: rows.map((m) => toFull(m, p.includeQuoted ? m.bodyText : stripQuotes(m.bodyText), max)),
      ...freshness,
    };
  }

  async listRecent(p: ListRecentParams): Promise<{ results: EmailSummary[] } & Freshness> {
    const sinceBound = toIsoBound(p.since, 'since');
    const freshness = await this.ensureFresh();
    const since = sinceBound ?? new Date(this.now().getTime() - 24 * 3600_000).toISOString();
    const rows = this.deps.repo.listRecent({
      folder: p.folder ?? 'INBOX',
      since,
      unreadOnly: p.unreadOnly ?? false,
      limit: clamp(p.limit ?? 50, 1, 200),
    });
    return { results: rows.map((m) => toSummary(m, makeSnippet(m.bodyText, []))), ...freshness };
  }

  async createDraft(input: DraftInput): Promise<DraftResult> {
    const { repo, config } = this.deps;
    const draftFolder = config.drafts.folder ?? repo.listFolders().find((f) => f.specialUse === '\\Drafts')?.path;
    if (!draftFolder) throw new MailError('NO_DRAFTS_FOLDER', 'Drafts folder not configured — run `sea-mail setup`');
    let original: StoredMessage | null = null;
    if (input.replyToId) {
      original = repo.getByKey(input.replyToId) ?? null;
      if (!original) throw new MailError('NOT_FOUND', `No email with id ${input.replyToId} to reply to`);
    }
    const draft = await buildDraft(input, {
      identity: config.identity,
      signature: config.drafts.signature,
      original,
      now: this.now(),
    });
    const session = await this.deps.openSession();
    try {
      await session.append(draftFolder, draft.raw, ['\\Draft', '\\Seen']);
    } finally {
      await session.close();
    }
    return { draftFolder, to: draft.to, cc: draft.cc, subject: draft.subject, messageId: draft.messageId };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Syncs first when the index is older than staleAfterMinutes; falls back to local data if that fails. */
  private async ensureFresh(): Promise<Freshness> {
    const { repo, config } = this.deps;
    const last = repo.getMeta('last_synced_at');
    if (!last) throw new MailError('EMPTY_INDEX', 'No mail indexed yet — run `sea-mail sync`');
    if (this.now().getTime() - Date.parse(last) <= config.sync.staleAfterMinutes * 60_000) return { lastSyncedAt: last };
    try {
      const result = await withTimeout(this.deps.syncer.sync(), this.deps.freshnessTimeoutMs ?? 20_000);
      return { lastSyncedAt: result.lastSyncedAt };
    } catch (err) {
      if (err instanceof MailError && err.code === 'AUTH_FAILED') throw err;
      log(`Freshness sync failed, answering from local data: ${(err as Error).message}`);
      return { lastSyncedAt: repo.getMeta('last_synced_at'), stale: true };
    }
  }
}

function toSummary(m: StoredMessage, snippet: string): EmailSummary {
  return {
    id: m.msgKey,
    threadId: m.threadId,
    date: m.date,
    from: m.from ?? { name: '', address: '' },
    to: m.to,
    subject: m.subject,
    snippet,
    folder: m.folderPath,
    hasAttachments: m.attachments.length > 0,
    unread: !m.flags.includes('\\Seen'),
  };
}

function toFull(m: StoredMessage, body: string, maxChars: number): EmailFull {
  const truncated = body.length > maxChars;
  return {
    ...toSummary(m, makeSnippet(body, [])),
    cc: m.cc,
    replyTo: m.replyTo,
    body: truncated ? body.slice(0, maxChars) : body,
    attachments: m.attachments,
    truncated,
  };
}

/** YYYY-MM-DD, optionally followed by THH:MM[:SS[.fff]] and an optional Z or ±HH:MM offset. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))?)?$/;

/** Accepts only well-formed ISO-8601 dates (new Date() alone would roll 2026-02-30 over to March 2). */
function toIsoBound(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const fail = () => new MailError('INVALID_INPUT', `${name} must be an ISO date such as 2026-08-01`);
  const m = ISO_DATE.exec(value);
  if (!m) throw fail();
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [1, 2, 3, 4, 5, 6, 8, 9].map((i) => Number(m[i] ?? 0));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw fail();
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) throw fail();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw fail();
  return date.toISOString();
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  // Promise.race also handles a late rejection of `promise`, so it can never become unhandled.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
