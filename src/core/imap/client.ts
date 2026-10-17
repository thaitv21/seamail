import { ImapFlow } from 'imapflow';
import { MailError } from '../errors.js';
import { log } from '../log.js';
import type { RawMessage } from './parse.js';

export interface ImapSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface RemoteFolder {
  path: string;
  specialUse: string | null;
}

export interface FolderInfo {
  uidValidity: number;
  exists: number;
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);

export function mapImapError(err: unknown): Error {
  if (err instanceof MailError) return err;
  const e = err as { authenticationFailed?: boolean; code?: string } | null;
  if (e?.authenticationFailed) return new MailError('AUTH_FAILED', 'IMAP login failed — run `sea-mail setup`');
  if (e?.code && NETWORK_CODES.has(e.code)) return new MailError('IMAP_UNAVAILABLE', `IMAP server unreachable (${e.code})`);
  return err instanceof Error ? err : new Error(String(err));
}

/** `\Recent` is per-session noise; sorting makes flag sets comparable. */
function cleanFlags(flags: Set<string> | undefined): string[] {
  return [...(flags ?? [])].filter((f) => f !== '\\Recent').sort();
}

/**
 * Thin wrapper over one imapflow connection. Never call another method while a fetch is running:
 * every method here awaits fetchAll(), so calls are always sequential.
 */
export class ImapSession {
  private constructor(private readonly client: ImapFlow) {}

  static async open(s: ImapSettings): Promise<ImapSession> {
    const client = new ImapFlow({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: { user: s.user, pass: s.password },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 120_000,
    });
    // Without a listener, a late socket error would crash the process.
    client.on('error', (err: Error) => log(`IMAP connection error: ${err.message}`));
    try {
      await client.connect();
    } catch (err) {
      throw mapImapError(err);
    }
    return new ImapSession(client);
  }

  async listFolders(): Promise<RemoteFolder[]> {
    const list = await this.client.list();
    return list
      .filter((f) => !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
      .map((f) => ({ path: f.path, specialUse: f.specialUse ?? null }));
  }

  /** Opens `path` read-only (EXAMINE), so nothing inside `fn` can change server flags. */
  async withFolder<T>(path: string, fn: (info: FolderInfo) => Promise<T>): Promise<T> {
    const lock = await this.client.getMailboxLock(path, { readOnly: true });
    try {
      const mailbox = this.client.mailbox;
      if (!mailbox) throw new Error(`Could not open folder ${path}`);
      return await fn({ uidValidity: Number(mailbox.uidValidity), exists: mailbox.exists });
    } finally {
      lock.release();
    }
  }

  async uidsAndFlags(): Promise<Map<number, string[]>> {
    const messages = await this.client.fetchAll('1:*', { uid: true, flags: true }, { uid: true });
    return new Map(messages.map((m) => [m.uid, cleanFlags(m.flags)] as [number, string[]]));
  }

  async fetchMeta(uids: number[]): Promise<RawMessage[]> {
    const messages = await this.client.fetchAll(
      uids.join(','),
      { uid: true, flags: true, size: true, internalDate: true, envelope: true, bodyStructure: true, headers: ['references'] },
      { uid: true },
    );
    return messages.map((m) => ({
      uid: m.uid,
      flags: cleanFlags(m.flags),
      size: m.size ?? 0,
      internalDate: m.internalDate ? new Date(m.internalDate) : null,
      envelope: m.envelope,
      referencesHeader: m.headers?.toString('utf8') ?? '',
      bodyStructure: m.bodyStructure,
    }));
  }

  async fetchSources(uids: number[]): Promise<Map<number, Buffer>> {
    const messages = await this.client.fetchAll(uids.join(','), { uid: true, source: true }, { uid: true });
    return new Map(messages.flatMap((m) => (m.source ? [[m.uid, m.source] as [number, Buffer]] : [])));
  }

  /** Downloads one body part, decoded to UTF-8 text. */
  async downloadPart(uid: number, part: string): Promise<string> {
    const download = await this.client.download(String(uid), part, { uid: true });
    if (!download.content) return '';
    const chunks: Buffer[] = [];
    for await (const chunk of download.content) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  async append(path: string, raw: Buffer, flags: string[]): Promise<void> {
    await this.client.append(path, raw, flags);
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      // The connection is already gone; nothing to clean up.
    }
  }
}
