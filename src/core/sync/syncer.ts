import { MailError } from '../errors.js';
import { mapImapError, type ImapSession, type RemoteFolder } from '../imap/client.js';
import { buildNewMessage, pickTextPart, type BodySource, type RawMessage } from '../imap/parse.js';
import { log } from '../log.js';
import type { Repo } from '../store/repo.js';
import type { NewMessage, SyncResult } from '../types.js';

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const BATCH_SIZE = 200;

export interface SyncerDeps {
  repo: Repo;
  openSession: () => Promise<ImapSession>;
  excludeFolders: string[];
  now?: () => Date;
  onProgress?: (folder: string, done: number, total: number) => void;
}

interface FolderTotals {
  newMessages: number;
  updatedFlags: number;
  deleted: number;
}

export class Syncer {
  private inflight: Promise<SyncResult> | null = null;

  constructor(private readonly deps: SyncerDeps) {}

  /** Runs one sync; concurrent callers share the same in-flight run. */
  sync(): Promise<SyncResult> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async run(): Promise<SyncResult> {
    const started = Date.now();
    const totals: FolderTotals = { newMessages: 0, updatedFlags: 0, deleted: 0 };
    const failedFolders: string[] = [];
    const session = await this.deps.openSession();
    try {
      const remote = (await session.listFolders()).filter((f) => this.isIncluded(f));
      const remotePaths = new Set(remote.map((f) => f.path));
      for (const local of this.deps.repo.listFolders()) {
        if (!remotePaths.has(local.path)) this.deps.repo.removeFolder(local.id);
      }
      for (const folder of remote) {
        try {
          const r = await this.syncFolder(session, folder);
          totals.newMessages += r.newMessages;
          totals.updatedFlags += r.updatedFlags;
          totals.deleted += r.deleted;
        } catch (err) {
          const mapped = mapImapError(err);
          // A dead connection or bad credentials affect every folder: abort the run. Anything else is this folder's problem.
          if (mapped instanceof MailError && (mapped.code === 'IMAP_UNAVAILABLE' || mapped.code === 'AUTH_FAILED')) throw mapped;
          log(`Skipping folder ${folder.path}: ${mapped.message}`);
          failedFolders.push(folder.path);
        }
      }
    } finally {
      await session.close();
    }
    const lastSyncedAt = this.now().toISOString();
    this.deps.repo.setMeta('last_synced_at', lastSyncedAt);
    return { ...totals, durationMs: Date.now() - started, lastSyncedAt, failedFolders };
  }

  private isIncluded(f: RemoteFolder): boolean {
    return f.specialUse !== '\\Trash' && f.specialUse !== '\\Junk' && !this.deps.excludeFolders.includes(f.path);
  }

  private async syncFolder(session: ImapSession, remote: RemoteFolder): Promise<FolderTotals> {
    const { repo } = this.deps;
    const folder = repo.upsertFolder(remote.path, remote.specialUse);
    return session.withFolder(remote.path, async (info) => {
      if (folder.uidValidity !== info.uidValidity) repo.resetFolder(folder.id, info.uidValidity);

      const serverFlags = info.exists > 0 ? await session.uidsAndFlags() : new Map<number, string[]>();
      const localFlags = repo.uidFlags(folder.id);

      const gone = [...localFlags.keys()].filter((uid) => !serverFlags.has(uid));
      repo.deleteUids(folder.id, gone);

      let updatedFlags = 0;
      for (const [uid, flags] of serverFlags) {
        const local = localFlags.get(uid);
        if (local && local.join(' ') !== flags.join(' ')) {
          repo.updateFlags(folder.id, uid, flags);
          updatedFlags += 1;
        }
      }

      // UID set difference (not uid > last_uid) so an interrupted sync resumes where it stopped.
      const newUids = [...serverFlags.keys()].filter((uid) => !localFlags.has(uid)).sort((a, b) => a - b);
      let done = 0;
      for (let i = 0; i < newUids.length; i += BATCH_SIZE) {
        const batch = newUids.slice(i, i + BATCH_SIZE);
        const metas = await session.fetchMeta(batch);
        const small = metas.filter((m) => m.size <= MAX_SOURCE_BYTES).map((m) => m.uid);
        const sources = small.length > 0 ? await session.fetchSources(small) : new Map<number, Buffer>();
        const messages: NewMessage[] = [];
        for (const meta of metas) {
          const body = await this.bodyFor(session, meta, sources);
          messages.push(await buildNewMessage(meta, body, { folderPath: remote.path, uidValidity: info.uidValidity }));
        }
        repo.insertMessages(folder.id, messages);
        done += batch.length;
        this.deps.onProgress?.(remote.path, done, newUids.length);
      }

      let maxUid = 0;
      for (const uid of serverFlags.keys()) if (uid > maxUid) maxUid = uid;
      repo.setFolderSyncState(folder.id, maxUid, this.now().toISOString());
      return { newMessages: newUids.length, updatedFlags, deleted: gone.length };
    });
  }

  private async bodyFor(session: ImapSession, meta: RawMessage, sources: Map<number, Buffer>): Promise<BodySource> {
    const source = sources.get(meta.uid);
    if (source) return { kind: 'source', source };
    const part = pickTextPart(meta.bodyStructure);
    if (!part) return { kind: 'none' };
    try {
      return { kind: 'part', type: part.type, content: await session.downloadPart(meta.uid, part.part) };
    } catch (err) {
      log(`Could not download the body of UID ${meta.uid}: ${(err as Error).message}`);
      return { kind: 'failed' };
    }
  }
}
