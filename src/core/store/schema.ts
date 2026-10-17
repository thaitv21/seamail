/** Entry N upgrades the schema from version N to N+1 (tracked in PRAGMA user_version). */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE folders (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    special_use TEXT,
    uidvalidity INTEGER,
    last_uid INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES folders(id),
    uid INTEGER NOT NULL,
    msg_key TEXT NOT NULL,
    message_id TEXT,
    in_reply_to TEXT,
    references_json TEXT NOT NULL DEFAULT '[]',
    thread_id TEXT NOT NULL,
    date TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    from_name TEXT,
    from_addr TEXT,
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    reply_to_json TEXT NOT NULL DEFAULT '[]',
    flags_json TEXT NOT NULL DEFAULT '[]',
    seen INTEGER NOT NULL DEFAULT 0,
    body_text TEXT NOT NULL DEFAULT '',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    has_attachments INTEGER NOT NULL DEFAULT 0,
    parse_error INTEGER NOT NULL DEFAULT 0,
    subject_n TEXT NOT NULL DEFAULT '',
    from_n TEXT NOT NULL DEFAULT '',
    to_n TEXT NOT NULL DEFAULT '',
    body_n TEXT NOT NULL DEFAULT '',
    UNIQUE (folder_id, uid)
  );
  CREATE INDEX messages_thread ON messages(thread_id);
  CREATE INDEX messages_key ON messages(msg_key);
  CREATE INDEX messages_date ON messages(date);

  CREATE VIRTUAL TABLE messages_fts USING fts5(
    subject_n, from_n, to_n, body_n,
    content='messages', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, subject_n, from_n, to_n, body_n)
    VALUES (new.id, new.subject_n, new.from_n, new.to_n, new.body_n);
  END;
  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject_n, from_n, to_n, body_n)
    VALUES ('delete', old.id, old.subject_n, old.from_n, old.to_n, old.body_n);
  END;
  CREATE TRIGGER messages_au AFTER UPDATE OF subject_n, from_n, to_n, body_n ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject_n, from_n, to_n, body_n)
    VALUES ('delete', old.id, old.subject_n, old.from_n, old.to_n, old.body_n);
    INSERT INTO messages_fts(rowid, subject_n, from_n, to_n, body_n)
    VALUES (new.id, new.subject_n, new.from_n, new.to_n, new.body_n);
  END;

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];
