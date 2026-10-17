import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImapSession } from '../../src/core/imap/client.js';
import type { RawMessage } from '../../src/core/imap/parse.js';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import { Syncer } from '../../src/core/sync/syncer.js';

interface FakeMail {
  uid: number;
  size?: number;
  subject?: string;
}

interface FakeServer {
  /** Folder path → messages, in LIST order. */
  folders: Record<string, FakeMail[]>;
  /** Folder path → error thrown when the folder is opened. */
  openErrors?: Record<string, Error>;
  downloadPart?: (uid: number, part: string) => Promise<string>;
}

function codedError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

/** An in-memory stand-in for ImapSession: only the methods Syncer calls. */
function fakeSession(server: FakeServer): ImapSession & { closed: boolean } {
  let current: FakeMail[] = [];
  const session = {
    closed: false,
    listFolders: async () => Object.keys(server.folders).map((path) => ({ path, specialUse: null })),
    withFolder: async <T>(path: string, fn: (info: { uidValidity: number; exists: number }) => Promise<T>): Promise<T> => {
      const error = server.openErrors?.[path];
      if (error) throw error;
      current = server.folders[path] ?? [];
      return fn({ uidValidity: 1, exists: current.length });
    },
    uidsAndFlags: async () => new Map(current.map((m) => [m.uid, [] as string[]] as [number, string[]])),
    fetchMeta: async (uids: number[]): Promise<RawMessage[]> =>
      current
        .filter((m) => uids.includes(m.uid))
        .map((m) => ({
          uid: m.uid,
          flags: [],
          size: m.size ?? 100,
          internalDate: new Date('2026-10-01T00:00:00Z'),
          envelope: { subject: m.subject ?? `Mail ${m.uid}`, messageId: `<${m.uid}@example.test>` },
          referencesHeader: '',
          bodyStructure: { type: 'text/plain' as const, part: '1' },
        })),
    fetchSources: async (uids: number[]) =>
      new Map(
        current
          .filter((m) => uids.includes(m.uid))
          .map((m) => [m.uid, Buffer.from(`Subject: s\r\nContent-Type: text/plain\r\n\r\nBody of ${m.uid}`)] as [number, Buffer]),
      ),
    downloadPart: server.downloadPart ?? (async () => 'downloaded text'),
    close: async () => {
      session.closed = true;
    },
  };
  return session as unknown as ImapSession & { closed: boolean };
}

describe('Syncer with a fake session', () => {
  let repo: Repo;

  const makeSyncer = (session: ImapSession) =>
    new Syncer({ repo, excludeFolders: [], openSession: async () => session, now: () => new Date('2026-10-17T10:00:00Z') });

  // Skipped folders and failed downloads are logged to stderr by design; keep the test output clean.
  beforeEach(() => {
    repo = new Repo(openDb(':memory:'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a failing folder', () => {
    it('is skipped and reported while the other folders are still indexed', async () => {
      const session = fakeSession({
        folders: { Broken: [{ uid: 1 }], INBOX: [{ uid: 1, subject: 'Báo giá' }] },
        openErrors: { Broken: new Error('NO [NONEXISTENT] Mailbox does not exist') },
      });
      const result = await makeSyncer(session).sync();
      expect(result.failedFolders).toEqual(['Broken']);
      expect(result.newMessages).toBe(1);
      expect(repo.search({ fts: null, limit: 50 }).rows.map((m) => [m.folderPath, m.subject])).toEqual([['INBOX', 'Báo giá']]);
      expect(repo.getMeta('last_synced_at')).toBe('2026-10-17T10:00:00.000Z');
      expect(result.lastSyncedAt).toBe('2026-10-17T10:00:00.000Z');
      expect(session.closed).toBe(true);
    });

    it('reports no failed folders when everything syncs', async () => {
      const result = await makeSyncer(fakeSession({ folders: { INBOX: [{ uid: 1 }] } })).sync();
      expect(result.failedFolders).toEqual([]);
    });

    it('aborts the run on a connection-level error without marking the mailbox as synced', async () => {
      const session = fakeSession({
        folders: { INBOX: [{ uid: 1 }], Broken: [{ uid: 1 }] },
        openErrors: { Broken: codedError('ECONNRESET') },
      });
      await expect(makeSyncer(session).sync()).rejects.toMatchObject({ code: 'IMAP_UNAVAILABLE' });
      expect(repo.getMeta('last_synced_at')).toBeNull();
      expect(session.closed).toBe(true);
    });

    it('aborts the run on an authentication failure', async () => {
      const session = fakeSession({
        folders: { INBOX: [{ uid: 1 }] },
        openErrors: { INBOX: Object.assign(new Error('Command failed'), { authenticationFailed: true }) },
      });
      await expect(makeSyncer(session).sync()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
      expect(repo.getMeta('last_synced_at')).toBeNull();
    });
  });
});
