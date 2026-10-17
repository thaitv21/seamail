import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import { newMessage } from '../helpers/fixtures.js';

function setup() {
  const db = openDb(':memory:');
  const repo = new Repo(db);
  const folder = repo.upsertFolder('INBOX', '\\Inbox');
  const hits = (q: string) =>
    (db.prepare('SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?').get(q) as { n: number }).n;
  return { repo, folder, hits };
}

describe('openDb', () => {
  it('creates the file with mode 600 and migrates idempotently', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-mail-db-'));
    const file = path.join(dir, 'nested', 'mail.db');
    openDb(file).close();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const db = openDb(file);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Repo write side', () => {
  it('upserts folders', () => {
    const { repo, folder } = setup();
    expect(folder).toMatchObject({ path: 'INBOX', specialUse: '\\Inbox', uidValidity: null, lastUid: 0, lastSyncedAt: null });
    expect(repo.upsertFolder('INBOX', null).id).toBe(folder.id);
    expect(repo.getFolder('INBOX')?.specialUse).toBeNull();
    expect(repo.listFolders().map((f) => f.path)).toEqual(['INBOX']);
  });

  it('indexes inserted messages accent-insensitively', () => {
    const { repo, folder, hits } = setup();
    repo.insertMessages(folder.id, [newMessage({ uid: 1, subject: 'Báo giá', bodyText: 'ĐƠN HÀNG' })]);
    expect(repo.countMessages()).toBe(1);
    expect(hits('"bao" "gia"')).toBe(1);
    expect(hits('"don" "hang"')).toBe(1);
  });

  it('replaces a message re-inserted with the same uid without duplicating the index', () => {
    const { repo, folder, hits } = setup();
    repo.insertMessages(folder.id, [newMessage({ uid: 1, subject: 'first' })]);
    repo.insertMessages(folder.id, [newMessage({ uid: 1, subject: 'second' })]);
    expect(repo.countMessages()).toBe(1);
    expect(hits('"first"')).toBe(0);
    expect(hits('"second"')).toBe(1);
  });

  it('tracks flags and deletions', () => {
    const { repo, folder, hits } = setup();
    repo.insertMessages(folder.id, [newMessage({ uid: 1, subject: 'keep' }), newMessage({ uid: 2, subject: 'gone' })]);
    repo.updateFlags(folder.id, 1, ['\\Seen']);
    repo.deleteUids(folder.id, [2]);
    expect(repo.uidFlags(folder.id)).toEqual(new Map([[1, ['\\Seen']]]));
    expect(hits('"gone"')).toBe(0);
  });

  it('resets a folder and records sync state', () => {
    const { repo, folder } = setup();
    repo.insertMessages(folder.id, [newMessage({ uid: 5 })]);
    repo.setFolderSyncState(folder.id, 5, '2026-10-17T00:00:00.000Z');
    repo.resetFolder(folder.id, 777);
    expect(repo.countMessages()).toBe(0);
    expect(repo.getFolder('INBOX')).toMatchObject({ uidValidity: 777, lastUid: 0, lastSyncedAt: '2026-10-17T00:00:00.000Z' });
  });

  it('removes a folder together with its messages', () => {
    const { repo, folder, hits } = setup();
    repo.insertMessages(folder.id, [newMessage({ uid: 1, subject: 'bye' })]);
    repo.removeFolder(folder.id);
    expect(repo.getFolder('INBOX')).toBeUndefined();
    expect(hits('"bye"')).toBe(0);
  });

  it('stores metadata', () => {
    const { repo } = setup();
    expect(repo.getMeta('last_synced_at')).toBeNull();
    repo.setMeta('last_synced_at', 'x');
    repo.setMeta('last_synced_at', 'y');
    expect(repo.getMeta('last_synced_at')).toBe('y');
  });
});
