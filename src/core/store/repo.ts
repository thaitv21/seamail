import { normalizeForSearch } from '../text/normalize.js';
import type { NewMessage } from '../types.js';
import type { Db } from './db.js';

export interface FolderRow {
  id: number;
  path: string;
  specialUse: string | null;
  uidValidity: number | null;
  lastUid: number;
  lastSyncedAt: string | null;
}

interface FolderDbRow {
  id: number;
  path: string;
  special_use: string | null;
  uidvalidity: number | null;
  last_uid: number;
  last_synced_at: string | null;
}

const INSERT_MESSAGE = `
  INSERT INTO messages (
    folder_id, uid, msg_key, message_id, in_reply_to, references_json, thread_id, date, subject,
    from_name, from_addr, to_json, cc_json, reply_to_json, flags_json, seen, body_text,
    attachments_json, has_attachments, parse_error, subject_n, from_n, to_n, body_n
  ) VALUES (
    @folder_id, @uid, @msg_key, @message_id, @in_reply_to, @references_json, @thread_id, @date, @subject,
    @from_name, @from_addr, @to_json, @cc_json, @reply_to_json, @flags_json, @seen, @body_text,
    @attachments_json, @has_attachments, @parse_error, @subject_n, @from_n, @to_n, @body_n
  )`;

export class Repo {
  constructor(private readonly db: Db) {}

  upsertFolder(path: string, specialUse: string | null): FolderRow {
    this.db
      .prepare(
        `INSERT INTO folders (path, special_use) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET special_use = excluded.special_use`,
      )
      .run(path, specialUse);
    return this.getFolder(path)!;
  }

  getFolder(path: string): FolderRow | undefined {
    const row = this.db.prepare('SELECT * FROM folders WHERE path = ?').get(path) as FolderDbRow | undefined;
    return row && toFolder(row);
  }

  listFolders(): FolderRow[] {
    return (this.db.prepare('SELECT * FROM folders ORDER BY path').all() as FolderDbRow[]).map(toFolder);
  }

  removeFolder(folderId: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folderId);
      this.db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    })();
  }

  resetFolder(folderId: number, uidValidity: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folderId);
      this.db.prepare('UPDATE folders SET uidvalidity = ?, last_uid = 0 WHERE id = ?').run(uidValidity, folderId);
    })();
  }

  setFolderSyncState(folderId: number, lastUid: number, lastSyncedAt: string): void {
    this.db.prepare('UPDATE folders SET last_uid = ?, last_synced_at = ? WHERE id = ?').run(lastUid, lastSyncedAt, folderId);
  }

  insertMessages(folderId: number, messages: NewMessage[]): void {
    // DELETE + INSERT instead of INSERT OR REPLACE: REPLACE skips the delete trigger that keeps FTS in sync.
    const remove = this.db.prepare('DELETE FROM messages WHERE folder_id = ? AND uid = ?');
    const insert = this.db.prepare(INSERT_MESSAGE);
    this.db.transaction(() => {
      for (const m of messages) {
        remove.run(folderId, m.uid);
        insert.run(toDbParams(folderId, m));
      }
    })();
  }

  uidFlags(folderId: number): Map<number, string[]> {
    const rows = this.db.prepare('SELECT uid, flags_json FROM messages WHERE folder_id = ?').all(folderId) as Array<{
      uid: number;
      flags_json: string;
    }>;
    return new Map(rows.map((r) => [r.uid, JSON.parse(r.flags_json) as string[]]));
  }

  updateFlags(folderId: number, uid: number, flags: string[]): void {
    this.db
      .prepare('UPDATE messages SET flags_json = ?, seen = ? WHERE folder_id = ? AND uid = ?')
      .run(JSON.stringify(flags), flags.includes('\\Seen') ? 1 : 0, folderId, uid);
  }

  deleteUids(folderId: number, uids: number[]): void {
    const remove = this.db.prepare('DELETE FROM messages WHERE folder_id = ? AND uid = ?');
    this.db.transaction(() => {
      for (const uid of uids) remove.run(folderId, uid);
    })();
  }

  countMessages(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n;
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }
}

function toFolder(r: FolderDbRow): FolderRow {
  return {
    id: r.id,
    path: r.path,
    specialUse: r.special_use,
    uidValidity: r.uidvalidity,
    lastUid: r.last_uid,
    lastSyncedAt: r.last_synced_at,
  };
}

function toDbParams(folderId: number, m: NewMessage) {
  const fromText = m.from ? `${m.from.name} ${m.from.address}` : '';
  const toText = [...m.to, ...m.cc].map((a) => `${a.name} ${a.address}`).join(' ');
  return {
    folder_id: folderId,
    uid: m.uid,
    msg_key: m.msgKey,
    message_id: m.messageId,
    in_reply_to: m.inReplyTo,
    references_json: JSON.stringify(m.references),
    thread_id: m.threadId,
    date: m.date,
    subject: m.subject,
    from_name: m.from?.name ?? null,
    from_addr: m.from?.address ?? null,
    to_json: JSON.stringify(m.to),
    cc_json: JSON.stringify(m.cc),
    reply_to_json: JSON.stringify(m.replyTo),
    flags_json: JSON.stringify(m.flags),
    seen: m.flags.includes('\\Seen') ? 1 : 0,
    body_text: m.bodyText,
    attachments_json: JSON.stringify(m.attachments),
    has_attachments: m.attachments.length > 0 ? 1 : 0,
    parse_error: m.parseError ? 1 : 0,
    subject_n: normalizeForSearch(m.subject),
    from_n: normalizeForSearch(fromText),
    to_n: normalizeForSearch(toText),
    body_n: normalizeForSearch(m.bodyText),
  };
}
