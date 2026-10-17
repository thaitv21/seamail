import { normalizeForSearch } from '../text/normalize.js';
import type { Address, AttachmentMeta, NewMessage, StoredMessage } from '../types.js';
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

export interface RepoSearch {
  /** FTS5 expression from parseQuery(), or null to list by date. */
  fts: string | null;
  from?: string;
  to?: string;
  folder?: string;
  /** Inclusive ISO lower bound. */
  after?: string;
  /** Exclusive ISO upper bound. */
  before?: string;
  hasAttachment?: boolean;
  limit: number;
}

interface MessageDbRow {
  id: number;
  folder_id: number;
  folder_path: string;
  uid: number;
  msg_key: string;
  message_id: string | null;
  in_reply_to: string | null;
  references_json: string;
  thread_id: string;
  date: string;
  subject: string;
  from_name: string | null;
  from_addr: string | null;
  to_json: string;
  cc_json: string;
  reply_to_json: string;
  flags_json: string;
  body_text: string;
  attachments_json: string;
  parse_error: number;
}

const SELECT_MESSAGE = 'SELECT m.*, f.path AS folder_path FROM messages m JOIN folders f ON f.id = m.folder_id';

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

  search(p: RepoSearch): { rows: StoredMessage[]; total: number } {
    const joins = ['JOIN folders f ON f.id = m.folder_id'];
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (p.fts) {
      joins.push('JOIN messages_fts ON messages_fts.rowid = m.id');
      where.push('messages_fts MATCH ?');
      args.push(p.fts);
    }
    if (p.from) {
      where.push(`m.from_n LIKE ? ESCAPE '\\'`);
      args.push(likeContains(p.from));
    }
    if (p.to) {
      where.push(`m.to_n LIKE ? ESCAPE '\\'`);
      args.push(likeContains(p.to));
    }
    if (p.folder) {
      where.push('f.path = ? COLLATE NOCASE');
      args.push(p.folder);
    }
    if (p.after) {
      where.push('m.date >= ?');
      args.push(p.after);
    }
    if (p.before) {
      where.push('m.date < ?');
      args.push(p.before);
    }
    if (p.hasAttachment !== undefined) {
      where.push('m.has_attachments = ?');
      args.push(p.hasAttachment ? 1 : 0);
    }
    const filter = `FROM messages m ${joins.join(' ')}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const score = p.fts ? 'bm25(messages_fts, 5.0, 2.0, 2.0, 1.0)' : '0';
    const order = p.fts ? 'score ASC, date DESC' : 'date DESC';

    const total = (this.db.prepare(`SELECT COUNT(DISTINCT m.msg_key) AS n ${filter}`).get(...args) as { n: number }).n;
    // bm25() cannot share a SELECT with a window function, so rank in a materialized CTE first.
    const rows = this.db
      .prepare(
        `WITH ranked AS MATERIALIZED (SELECT m.*, f.path AS folder_path, ${score} AS score ${filter}),
              deduped AS (SELECT ranked.*, ROW_NUMBER() OVER (PARTITION BY msg_key ORDER BY id) AS rn FROM ranked)
         SELECT * FROM deduped WHERE rn = 1 ORDER BY ${order} LIMIT ?`,
      )
      .all(...args, p.limit) as MessageDbRow[];
    return { rows: rows.map(toStored), total };
  }

  getByKey(msgKey: string): StoredMessage | undefined {
    const row = this.db.prepare(`${SELECT_MESSAGE} WHERE m.msg_key = ? ORDER BY m.id LIMIT 1`).get(msgKey) as
      | MessageDbRow
      | undefined;
    return row && toStored(row);
  }

  getThread(threadId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `WITH deduped AS (
           SELECT m.*, f.path AS folder_path, ROW_NUMBER() OVER (PARTITION BY m.msg_key ORDER BY m.id) AS rn
           FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.thread_id = ?)
         SELECT * FROM deduped WHERE rn = 1 ORDER BY date ASC, id ASC`,
      )
      .all(threadId) as MessageDbRow[];
    return rows.map(toStored);
  }

  listRecent(p: { folder: string; since: string; unreadOnly: boolean; limit: number }): StoredMessage[] {
    const rows = this.db
      .prepare(
        `${SELECT_MESSAGE} WHERE f.path = ? COLLATE NOCASE AND m.date >= ?${p.unreadOnly ? ' AND m.seen = 0' : ''}
         ORDER BY m.date DESC LIMIT ?`,
      )
      .all(p.folder, p.since, p.limit) as MessageDbRow[];
    return rows.map(toStored);
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

function toStored(r: MessageDbRow): StoredMessage {
  return {
    id: r.id,
    folderId: r.folder_id,
    folderPath: r.folder_path,
    uid: r.uid,
    msgKey: r.msg_key,
    messageId: r.message_id,
    inReplyTo: r.in_reply_to,
    references: JSON.parse(r.references_json) as string[],
    threadId: r.thread_id,
    date: r.date,
    subject: r.subject,
    from: r.from_addr !== null ? { name: r.from_name ?? '', address: r.from_addr } : null,
    to: JSON.parse(r.to_json) as Address[],
    cc: JSON.parse(r.cc_json) as Address[],
    replyTo: JSON.parse(r.reply_to_json) as Address[],
    flags: JSON.parse(r.flags_json) as string[],
    bodyText: r.body_text,
    attachments: JSON.parse(r.attachments_json) as AttachmentMeta[],
    parseError: r.parse_error === 1,
  };
}

function likeContains(value: string): string {
  return `%${normalizeForSearch(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
