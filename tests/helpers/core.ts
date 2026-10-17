import { vi } from 'vitest';
import type { AppConfig } from '../../src/core/config.js';
import { MailCore, type DraftSink } from '../../src/core/mail-core.js';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import type { SyncResult } from '../../src/core/types.js';
import { newMessage } from './fixtures.js';

export const TEST_NOW = new Date('2026-10-17T10:00:00Z');

export const TEST_CONFIG: AppConfig = {
  imap: { host: 'imap.example.test', port: 993, secure: true, user: 'me' },
  identity: { name: 'Me', email: 'me@example.test' },
  sync: { excludeFolders: [], staleAfterMinutes: 5 },
  drafts: { folder: null, signature: null },
};

export interface TestCoreOptions {
  /** null = never synced; default = one minute before TEST_NOW. */
  lastSyncedAt?: string | null;
  sync?: () => Promise<SyncResult>;
  config?: AppConfig;
  withDraftsFolder?: boolean;
}

/**
 * A MailCore over an in-memory store holding a two-message thread (k1, then reply k2)
 * in INBOX, plus a Drafts folder.
 */
export function createTestCore(opts: TestCoreOptions = {}) {
  const repo = new Repo(openDb(':memory:'));
  const inbox = repo.upsertFolder('INBOX', '\\Inbox');
  if (opts.withDraftsFolder !== false) repo.upsertFolder('Drafts', '\\Drafts');
  repo.insertMessages(inbox.id, [
    newMessage({
      uid: 1, msgKey: 'k1', messageId: '<a@x>', threadId: '<a@x>', subject: 'Báo giá server',
      bodyText: 'Gửi anh báo giá.', date: '2026-10-16T09:00:00.000Z', flags: ['\\Seen'],
    }),
    newMessage({
      uid: 2, msgKey: 'k2', messageId: '<b@x>', threadId: '<a@x>', references: ['<a@x>'], inReplyTo: '<a@x>',
      subject: 'Re: Báo giá server', bodyText: 'Đồng ý.\n\nOn Thu, 16 Oct 2026, Anh A <a@x> wrote:\n> Gửi anh báo giá.',
      date: '2026-10-17T08:00:00.000Z',
    }),
  ]);
  if (opts.lastSyncedAt !== null) repo.setMeta('last_synced_at', opts.lastSyncedAt ?? '2026-10-17T09:59:00.000Z');

  const sync = vi.fn(
    opts.sync ??
      (async (): Promise<SyncResult> => ({ newMessages: 0, updatedFlags: 0, deleted: 0, durationMs: 1, lastSyncedAt: TEST_NOW.toISOString() })),
  );
  const appended: Array<{ path: string; raw: Buffer; flags: string[] }> = [];
  const sink: DraftSink = {
    append: async (path, raw, flags) => {
      appended.push({ path, raw, flags });
    },
    close: async () => {},
  };
  const core = new MailCore({
    repo,
    syncer: { sync },
    openSession: async () => sink,
    config: opts.config ?? TEST_CONFIG,
    now: () => TEST_NOW,
    freshnessTimeoutMs: 50,
  });
  return { core, repo, sync, appended };
}
