import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import { parseQuery } from '../../src/core/text/normalize.js';
import { newMessage } from '../helpers/fixtures.js';

function seeded(): Repo {
  const repo = new Repo(openDb(':memory:'));
  const inbox = repo.upsertFolder('INBOX', '\\Inbox');
  const archive = repo.upsertFolder('Archive', null);
  repo.insertMessages(inbox.id, [
    newMessage({
      uid: 1, msgKey: 'quote', threadId: 't1', subject: 'Báo giá server', bodyText: 'Gửi anh báo giá.',
      from: { name: 'Nguyễn Văn A', address: 'a@example.test' }, date: '2026-08-10T09:00:00.000Z',
      attachments: [{ filename: 'q.pdf', mimeType: 'application/pdf', size: 10 }],
    }),
    newMessage({
      uid: 2, msgKey: 'body-only', threadId: 't2', subject: 'Hello', bodyText: 'Có báo giá trong nội dung',
      date: '2026-09-01T09:00:00.000Z', cc: [{ name: 'Kế toán', address: 'ketoan@example.test' }], flags: ['\\Seen'],
    }),
    newMessage({ uid: 3, msgKey: 'reply', threadId: 't1', subject: 'Re: Báo giá server', bodyText: 'Đồng ý', date: '2026-08-11T09:00:00.000Z' }),
  ]);
  // The same message also filed in Archive.
  repo.insertMessages(archive.id, [
    newMessage({ uid: 1, msgKey: 'quote', threadId: 't1', subject: 'Báo giá server', bodyText: 'Gửi anh báo giá.', date: '2026-08-10T09:00:00.000Z' }),
  ]);
  return repo;
}

const fts = (q: string) => parseQuery(q)!.fts;
const keys = (r: { rows: Array<{ msgKey: string }> }) => r.rows.map((m) => m.msgKey);

describe('Repo.search', () => {
  it('matches accent-insensitively, dedupes copies, ranks subject above body', () => {
    const res = seeded().search({ fts: fts('bao gia'), limit: 10 });
    expect(res.total).toBe(3);
    expect(keys(res)).toHaveLength(3);
    expect(new Set(keys(res))).toEqual(new Set(['quote', 'body-only', 'reply']));
    expect(keys(res).at(-1)).toBe('body-only');
  });

  it('lists newest first without a query and honours limit', () => {
    const repo = seeded();
    expect(keys(repo.search({ fts: null, limit: 10 }))).toEqual(['body-only', 'reply', 'quote']);
    const one = repo.search({ fts: null, limit: 1 });
    expect(one).toMatchObject({ total: 3 });
    expect(keys(one)).toEqual(['body-only']);
  });

  it('filters by sender, recipient (incl. Cc), folder, dates and attachments', () => {
    const repo = seeded();
    expect(keys(repo.search({ fts: null, from: 'nguyen van', limit: 10 }))).toEqual(['quote']);
    expect(keys(repo.search({ fts: null, to: 'ke toan', limit: 10 }))).toEqual(['body-only']);
    const archived = repo.search({ fts: null, folder: 'archive', limit: 10 });
    expect(archived.rows.map((m) => [m.msgKey, m.folderPath])).toEqual([['quote', 'Archive']]);
    expect(keys(repo.search({ fts: null, after: '2026-08-11T00:00:00.000Z', before: '2026-09-01T00:00:00.000Z', limit: 10 }))).toEqual(['reply']);
    expect(keys(repo.search({ fts: null, hasAttachment: true, limit: 10 }))).toEqual(['quote']);
  });

  it('treats LIKE wildcards in filters literally', () => {
    expect(seeded().search({ fts: null, from: '%', limit: 10 }).total).toBe(0);
  });
});

describe('Repo reads', () => {
  it('gets a message by key, preferring the first stored copy', () => {
    const repo = seeded();
    expect(repo.getByKey('quote')).toMatchObject({ folderPath: 'INBOX', subject: 'Báo giá server', from: { name: 'Nguyễn Văn A' } });
    expect(repo.getByKey('nope')).toBeUndefined();
  });

  it('returns a thread oldest first without duplicates', () => {
    expect(seeded().getThread('t1').map((m) => m.msgKey)).toEqual(['quote', 'reply']);
  });

  it('lists recent messages of a folder, optionally unread only', () => {
    const repo = seeded();
    const recent = (unreadOnly: boolean) =>
      repo.listRecent({ folder: 'inbox', since: '2026-08-11T00:00:00.000Z', unreadOnly, limit: 10 }).map((m) => m.msgKey);
    expect(recent(false)).toEqual(['body-only', 'reply']);
    expect(recent(true)).toEqual(['reply']);
  });
});
