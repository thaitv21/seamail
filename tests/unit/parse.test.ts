import type { MessageStructureObject } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentsFromStructure, buildNewMessage, hasPlainAlternative, pickTextPart, type RawMessage } from '../../src/core/imap/parse.js';

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

const withForwardedMail: MessageStructureObject = {
  type: 'multipart/mixed',
  childNodes: [
    { part: '1', type: 'text/html' },
    {
      part: '2',
      type: 'message/rfc822',
      disposition: 'attachment',
      dispositionParameters: { filename: 'fwd.eml' },
      size: 4321,
      childNodes: [
        {
          type: 'multipart/mixed',
          part: '2',
          childNodes: [
            { part: '2.1', type: 'text/plain' },
            { part: '2.2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'deep.pdf' }, size: 99 },
          ],
        },
      ],
    },
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
  it('does not descend into an attached email', () => {
    expect(pickTextPart(withForwardedMail)).toEqual({ part: '1', type: 'text/html' });
  });
  it('ignores text attachments', () => {
    expect(pickTextPart({ type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain', disposition: 'attachment' }] })).toBeNull();
  });
});

describe('attachmentsFromStructure', () => {
  it('lists real attachments but not inline images', () => {
    expect(attachmentsFromStructure(mixed)).toEqual([{ filename: 'q.pdf', mimeType: 'application/pdf', size: 1234 }]);
  });
  it('lists an attached email as one attachment without its contents', () => {
    expect(attachmentsFromStructure(withForwardedMail)).toEqual([{ filename: 'fwd.eml', mimeType: 'message/rfc822', size: 4321 }]);
  });
  it('names an unnamed attached email message.eml', () => {
    expect(attachmentsFromStructure({ type: 'message/rfc822', size: 7, childNodes: [{ type: 'text/plain', part: '1' }] })).toEqual([
      { filename: 'message.eml', mimeType: 'message/rfc822', size: 7 },
    ]);
  });
  it('normalizes attachment filenames to NFC', () => {
    const nfd = 'Hợp đồng.pdf'.normalize('NFD');
    expect(nfd).not.toBe('Hợp đồng.pdf'.normalize('NFC'));
    const [attachment] = attachmentsFromStructure({ type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: nfd }, size: 1 });
    expect(attachment?.filename).toBe('Hợp đồng.pdf'.normalize('NFC'));
  });
  it('normalizes the filename of an attached email to NFC', () => {
    const nfd = 'Chuyển tiếp.eml'.normalize('NFD');
    const [attachment] = attachmentsFromStructure({ type: 'message/rfc822', parameters: { name: nfd }, size: 1 });
    expect(attachment?.filename).toBe('Chuyển tiếp.eml'.normalize('NFC'));
  });
});

/** A hand-built multipart/mixed message from (content type, UTF-8 body) pairs. */
function mixedSource(...parts: Array<[string, string]>): Buffer {
  const b = 'sea-boundary';
  const body = parts
    .map(([type, content]) => `--${b}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${content}\r\n`)
    .join('');
  return Buffer.from(
    `From: a@example.test\r\nTo: me@example.test\r\nSubject: x\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=${b}\r\n\r\n${body}--${b}--\r\n`,
    'utf8',
  );
}

describe('hasPlainAlternative', () => {
  const alternative = (children: MessageStructureObject[]): MessageStructureObject => ({ type: 'multipart/alternative', childNodes: children });
  it('is true for a multipart/alternative with a text/plain child, at any depth', () => {
    expect(hasPlainAlternative(mixed)).toBe(true);
    expect(hasPlainAlternative({ type: 'multipart/related', childNodes: [alternative([{ type: 'text/plain', part: '1.1' }, { type: 'text/html', part: '1.2' }])] })).toBe(true);
  });
  it('is false without a multipart/alternative that offers text/plain', () => {
    expect(hasPlainAlternative(undefined)).toBe(false);
    expect(hasPlainAlternative({ type: 'text/html' })).toBe(false);
    expect(hasPlainAlternative({ type: 'multipart/mixed', childNodes: [{ type: 'text/html', part: '1' }, { type: 'text/plain', part: '2' }] })).toBe(false);
    expect(hasPlainAlternative(alternative([{ type: 'text/html', part: '1' }]))).toBe(false);
  });
  it('does not look inside an attached email', () => {
    expect(hasPlainAlternative(withForwardedMail)).toBe(false);
    const attachedAlternative: MessageStructureObject = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'text/html', part: '1' },
        { type: 'message/rfc822', part: '2', childNodes: [alternative([{ type: 'text/plain', part: '2.1' }, { type: 'text/html', part: '2.2' }])] },
      ],
    };
    expect(hasPlainAlternative(attachedAlternative)).toBe(false);
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('runs the custom html converter on a single-part html source', async () => {
    const html =
      '<table><tr><td>Sản phẩm</td><td>Giá</td></tr><tr><td>A</td><td>100</td></tr></table>' +
      '<img src="https://t.example/p.gif"><p><a href="https://evil.example/x">Xem link</a></p>';
    const source = await new MailComposer({ from: 'a@example.test', to: 'me@example.test', subject: 'x', html }).compile().build();
    const m = await buildNewMessage({ ...raw, bodyStructure: { type: 'text/html' } }, { kind: 'source', source }, ctx);
    expect(m.bodyText).toMatch(/Sản phẩm\s+Giá/);
    expect(m.bodyText).toContain('Xem link');
    expect(m.bodyText).not.toContain('https://');
  });

  it('keeps the plain part of a multipart/alternative source', async () => {
    const source = await new MailComposer({
      from: 'a@example.test',
      to: 'me@example.test',
      subject: 'x',
      text: 'Phần văn bản thuần.',
      html: '<p>Phần <b>HTML</b></p>',
    })
      .compile()
      .build();
    const alternativeRaw = { ...raw, bodyStructure: { type: 'multipart/alternative', childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'text/html' }] } satisfies MessageStructureObject };
    expect((await buildNewMessage(alternativeRaw, { kind: 'source', source }, ctx)).bodyText).toBe('Phần văn bản thuần.');
  });

  it('keeps the html body of a multipart/mixed message that also has a text/plain part', async () => {
    const html = '<p>Báo giá server</p><table><tr><td>Sản phẩm</td><td>Giá</td></tr><tr><td>A100</td><td>5.000.000</td></tr></table>';
    const source = mixedSource(['text/html', html], ['text/plain', '-- \r\nMailing list footer']);
    const mixedRaw = { ...raw, bodyStructure: { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/html' }, { part: '2', type: 'text/plain' }] } satisfies MessageStructureObject };
    const m = await buildNewMessage(mixedRaw, { kind: 'source', source }, ctx);
    expect(m.bodyText).toContain('Báo giá server');
    expect(m.bodyText).toMatch(/Sản phẩm\s+Giá/);
    expect(m.bodyText).toContain('Mailing list footer');
    expect(m.parseError).toBe(false);
  });

  it('keeps both parts of a multipart/mixed message with a text/plain intro before the html', async () => {
    const source = mixedSource(['text/plain', 'Chuyển tiếp anh xem.'], ['text/html', '<p>Nội dung <b>được chuyển</b></p><table><tr><td>Sản phẩm</td><td>Giá</td></tr></table>']);
    const mixedRaw = { ...raw, bodyStructure: { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'text/html' }] } satisfies MessageStructureObject };
    const m = await buildNewMessage(mixedRaw, { kind: 'source', source }, ctx);
    expect(m.bodyText).toContain('Chuyển tiếp anh xem.');
    expect(m.bodyText).toContain('Nội dung được chuyển');
    expect(m.bodyText).toMatch(/Sản phẩm\s+Giá/);
  });

  it('converts a downloaded html part', async () => {
    const m = await buildNewMessage(raw, { kind: 'part', type: 'text/html', content: '<p>Xin <b>chào</b></p>' }, ctx);
    expect(m.bodyText).toBe('Xin chào');
  });

  it('logs and flags a source that cannot be parsed', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const m = await buildNewMessage(raw, { kind: 'source', source: null as unknown as Buffer }, ctx);
    expect(m).toMatchObject({ bodyText: '', parseError: true });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Could not parse UID 9: '));
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
