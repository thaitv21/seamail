import type { ImapFlow } from 'imapflow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImapSession } from '../../src/core/imap/client.js';
import { appendMail, connectRaw, newUser, serverFlags, settingsFor } from './greenmail.js';

describe('ImapSession against GreenMail', () => {
  let user: string;
  let raw: ImapFlow;
  let session: ImapSession;

  beforeEach(async () => {
    user = newUser();
    raw = await connectRaw(user);
    for (const folder of ['Drafts', 'Sent', 'Trash']) await raw.mailboxCreate(folder);
    session = await ImapSession.open(settingsFor(user));
  });

  afterEach(async () => {
    await session.close();
    await raw.logout();
  });

  it('lists folders with special-use detected', async () => {
    expect(await session.listFolders()).toEqual(
      expect.arrayContaining([
        { path: 'INBOX', specialUse: '\\Inbox' },
        { path: 'Drafts', specialUse: '\\Drafts' },
        { path: 'Sent', specialUse: '\\Sent' },
        { path: 'Trash', specialUse: '\\Trash' },
      ]),
    );
  });

  it('fetches metadata, sources and parts without marking messages seen', async () => {
    const uid = await appendMail(raw, 'INBOX', {
      messageId: '<a1@example.test>',
      subject: 'Báo giá',
      text: 'Nội dung',
      inReplyTo: '<root@example.test>',
      references: ['<root@example.test>'],
    });
    await session.withFolder('INBOX', async (info) => {
      expect(info.exists).toBe(1);
      expect(info.uidValidity).toBeGreaterThan(0);
      expect([...(await session.uidsAndFlags()).keys()]).toEqual([uid]);
      const [meta] = await session.fetchMeta([uid]);
      expect(meta?.envelope?.subject).toBe('Báo giá');
      expect(meta?.referencesHeader).toContain('<root@example.test>');
      expect((await session.fetchSources([uid])).get(uid)?.toString()).toContain('Message-ID: <a1@example.test>');
      expect(await session.downloadPart(uid, '1')).toContain('Nội dung');
    });
    expect((await serverFlags(raw, 'INBOX')).get(uid)).not.toContain('\\Seen');
  });

  it('appends a draft with flags', async () => {
    await session.append('Drafts', Buffer.from('Subject: d\r\nMessage-ID: <d@x>\r\n\r\nbody\r\n'), ['\\Draft', '\\Seen']);
    const [flags] = [...(await serverFlags(raw, 'Drafts')).values()];
    expect(flags).toEqual(expect.arrayContaining(['\\Draft', '\\Seen']));
  });

  it('maps a refused connection to IMAP_UNAVAILABLE', async () => {
    await expect(ImapSession.open({ ...settingsFor(user), port: 1 })).rejects.toMatchObject({ code: 'IMAP_UNAVAILABLE' });
  });
});
