import { randomBytes } from 'node:crypto';
import type { ImapFlow } from 'imapflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImapSession } from '../../src/core/imap/client.js';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import { Syncer } from '../../src/core/sync/syncer.js';
import { parseQuery } from '../../src/core/text/normalize.js';
import { appendMail, connectRaw, newUser, serverFlags, settingsFor } from './greenmail.js';

describe('Syncer', () => {
  let user: string;
  let raw: ImapFlow;
  let repo: Repo;
  let inboxUid: number;

  const makeSyncer = (excludeFolders: string[] = []) =>
    new Syncer({ repo, excludeFolders, openSession: () => ImapSession.open(settingsFor(user)) });
  const search = (q: string) => repo.search({ fts: parseQuery(q)?.fts ?? null, limit: 50 }).rows;

  beforeEach(async () => {
    user = newUser();
    raw = await connectRaw(user);
    for (const folder of ['Drafts', 'Sent', 'Trash', 'Work']) await raw.mailboxCreate(folder);
    repo = new Repo(openDb(':memory:'));
    inboxUid = await appendMail(raw, 'INBOX', { messageId: '<q1@example.test>', subject: 'Báo giá server', text: 'Gửi anh báo giá tháng 8.' });
    await appendMail(raw, 'Work', { messageId: '<w1@example.test>', subject: 'ĐƠN HÀNG 42', text: 'Chi tiết đơn hàng.' });
    await appendMail(raw, 'Trash', { messageId: '<t1@example.test>', subject: 'Rác', text: 'deleted stuff' });
  });

  afterEach(async () => {
    await raw.logout();
  });

  it('indexes every folder except Trash and Junk', async () => {
    const result = await makeSyncer().sync();
    expect(result.newMessages).toBe(2);
    expect(repo.listFolders().map((f) => f.path)).toEqual(['Drafts', 'INBOX', 'Sent', 'Work']);
    expect(search('bao gia').map((m) => m.subject)).toEqual(['Báo giá server']);
    expect(search('don hang').map((m) => m.subject)).toEqual(['ĐƠN HÀNG 42']);
    expect(search('rac')).toEqual([]);
    expect(repo.getMeta('last_synced_at')).toBe(result.lastSyncedAt);
  });

  it('never sets \\Seen on the server', async () => {
    await makeSyncer().sync();
    for (const flags of (await serverFlags(raw, 'INBOX')).values()) expect(flags).not.toContain('\\Seen');
  });

  it('picks up new messages, flag changes and deletions incrementally', async () => {
    const syncer = makeSyncer();
    await syncer.sync();
    const second = await appendMail(raw, 'INBOX', { messageId: '<q2@example.test>', subject: 'Second', text: 'two' });
    await appendMail(raw, 'INBOX', { messageId: '<q3@example.test>', subject: 'Third', text: 'three' });
    expect((await syncer.sync()).newMessages).toBe(2);

    const lock = await raw.getMailboxLock('INBOX');
    try {
      await raw.messageFlagsAdd(String(inboxUid), ['\\Seen'], { uid: true });
      await raw.messageDelete(String(second), { uid: true });
    } finally {
      lock.release();
    }
    expect(await syncer.sync()).toMatchObject({ newMessages: 0, updatedFlags: 1, deleted: 1 });
    expect(search('bao gia')[0]?.flags).toContain('\\Seen');
    expect(search('second')).toEqual([]);
  });

  it('re-syncs a folder from scratch when UIDVALIDITY changes', async () => {
    await makeSyncer().sync();
    // GreenMail drops the connection and keeps the folder when DELETE targets a mailbox that another (now logged-out)
    // session had selected, so move the old folder aside instead and keep it out of the second sync.
    await raw.mailboxRename('Work', 'Old');
    await new Promise((resolve) => setTimeout(resolve, 1500)); // GreenMail derives UIDVALIDITY from the clock (seconds)
    await raw.mailboxCreate('Work');
    // The new folder reuses UID 1, so only a UIDVALIDITY reset keeps the stale local copy from shadowing it.
    await appendMail(raw, 'Work', { messageId: '<w2@example.test>', subject: 'Fresh', text: 'new folder' });
    await makeSyncer(['Old']).sync();
    expect(search('don hang')).toEqual([]);
    expect(search('fresh').map((m) => m.folderPath)).toEqual(['Work']);
  });

  it('downloads only the text part of messages over 2 MB', async () => {
    await appendMail(raw, 'INBOX', {
      messageId: '<big@example.test>',
      subject: 'Hợp đồng',
      text: 'Xem file đính kèm hợp đồng.',
      attachment: { filename: 'contract.pdf', content: randomBytes(2_621_440) },
    });
    const sessions: ImapSession[] = [];
    const syncer = new Syncer({
      repo,
      excludeFolders: [],
      openSession: async () => {
        const session = await ImapSession.open(settingsFor(user));
        vi.spyOn(session, 'downloadPart');
        sessions.push(session);
        return session;
      },
    });
    await syncer.sync();
    expect(sessions[0]?.downloadPart).toHaveBeenCalledTimes(1);
    const [row] = search('hop dong');
    expect(row?.bodyText).toBe('Xem file đính kèm hợp đồng.');
    expect(row?.attachments).toEqual([expect.objectContaining({ filename: 'contract.pdf' })]);
  });

  it('drops folders that become excluded', async () => {
    await makeSyncer().sync();
    await makeSyncer(['Work']).sync();
    expect(search('don hang')).toEqual([]);
    expect(repo.getFolder('Work')).toBeUndefined();
  });

  it('groups replies into the root thread', async () => {
    await appendMail(raw, 'INBOX', {
      messageId: '<r1@example.test>',
      subject: 'Re: Báo giá server',
      text: 'ok',
      inReplyTo: '<q1@example.test>',
      references: ['<q1@example.test>'],
      date: new Date('2026-10-02T08:00:00Z'),
    });
    await makeSyncer().sync();
    expect(repo.getThread('<q1@example.test>').map((m) => m.messageId)).toEqual(['<q1@example.test>', '<r1@example.test>']);
  });

  it('shares one in-flight sync between concurrent callers', async () => {
    const syncer = makeSyncer();
    const [a, b] = await Promise.all([syncer.sync(), syncer.sync()]);
    expect(a).toBe(b);
  });
});
