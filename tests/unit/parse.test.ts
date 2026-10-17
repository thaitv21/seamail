import type { MessageStructureObject } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer';
import { describe, expect, it } from 'vitest';
import { attachmentsFromStructure, buildNewMessage, pickTextPart, type RawMessage } from '../../src/core/imap/parse.js';

const mixed: MessageStructureObject = {
  type: 'multipart/mixed',
  childNodes: [
    {
      type: 'multipart/alternative',
      part: '1',
      childNodes: [
        { part: '1.1', type: 'text/plain' },
        { part: '1.2', type: 'text/html' },
      ],
    },
    { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'q.pdf' }, size: 1234 },
    { part: '3', type: 'image/png', disposition: 'inline', parameters: { name: 'logo.png' }, size: 50 },
  ],
};

describe('pickTextPart', () => {
  it('prefers text/plain', () => {
    expect(pickTextPart(mixed)).toEqual({ part: '1.1', type: 'text/plain' });
  });
  it('falls back to text/html', () => {
    expect(pickTextPart({ type: 'multipart/alternative', childNodes: [{ part: '1', type: 'text/html' }] })).toEqual({ part: '1', type: 'text/html' });
  });
  it('uses part 1 for a single-part message', () => {
    expect(pickTextPart({ type: 'text/plain' })).toEqual({ part: '1', type: 'text/plain' });
  });
  it('ignores text attachments', () => {
    expect(pickTextPart({ type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain', disposition: 'attachment' }] })).toBeNull();
  });
});

describe('attachmentsFromStructure', () => {
  it('lists real attachments but not inline images', () => {
    expect(attachmentsFromStructure(mixed)).toEqual([{ filename: 'q.pdf', mimeType: 'application/pdf', size: 1234 }]);
  });
});

describe('buildNewMessage', () => {
  const raw: RawMessage = {
    uid: 9,
    flags: ['\\Seen'],
    size: 500,
    internalDate: new Date('2026-10-02T00:00:00Z'),
    envelope: {
      date: new Date('2026-10-01T08:00:00Z'),
      subject: 'Re: Báo giá',
      messageId: '<r@x>',
      inReplyTo: '<q@x>',
      from: [{ name: 'Anh A', address: 'A@Example.test' }],
      to: [{ name: 'Me', address: 'me@example.test' }],
      cc: [],
      replyTo: [{ name: 'Anh A', address: 'A@Example.test' }],
    },
    referencesHeader: 'References: <root@x>\r\n <q@x>\r\n',
    bodyStructure: { type: 'text/plain' },
  };
  const ctx = { folderPath: 'INBOX', uidValidity: 1 };

  it('combines envelope, references and the parsed source', async () => {
    const source = await new MailComposer({ from: 'a@example.test', to: 'me@example.test', subject: 'x', text: 'Đồng ý báo giá.' })
      .compile()
      .build();
    const m = await buildNewMessage(raw, { kind: 'source', source }, ctx);
    expect(m).toMatchObject({
      uid: 9,
      messageId: '<r@x>',
      inReplyTo: '<q@x>',
      references: ['<root@x>', '<q@x>'],
      threadId: '<root@x>',
      date: '2026-10-01T08:00:00.000Z',
      subject: 'Re: Báo giá',
      from: { name: 'Anh A', address: 'a@example.test' },
      flags: ['\\Seen'],
      bodyText: 'Đồng ý báo giá.',
      attachments: [],
      parseError: false,
    });
    expect(m.msgKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it('converts a downloaded html part', async () => {
    const m = await buildNewMessage(raw, { kind: 'part', type: 'text/html', content: '<p>Xin <b>chào</b></p>' }, ctx);
    expect(m.bodyText).toBe('Xin chào');
  });

  it('marks failed downloads as parse errors', async () => {
    expect(await buildNewMessage(raw, { kind: 'failed' }, ctx)).toMatchObject({ bodyText: '', parseError: true });
  });

  it('falls back to internalDate and a folder-based key', async () => {
    const m = await buildNewMessage({ ...raw, envelope: { subject: 's' }, referencesHeader: '' }, { kind: 'none' }, ctx);
    expect(m.date).toBe('2026-10-02T00:00:00.000Z');
    expect(m.messageId).toBeNull();
    expect(m.threadId).toBe(m.msgKey);
  });
});
