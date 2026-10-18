import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';
import { buildDraft, type DraftContext } from '../../src/core/draft/compose.js';
import { MailError } from '../../src/core/errors.js';
import type { StoredMessage } from '../../src/core/types.js';

const ctx: DraftContext = {
  identity: { name: 'Me', email: 'me@example.test' },
  signature: null,
  original: null,
  now: new Date('2026-10-17T03:00:00Z'),
  timeZone: 'UTC',
};

function original(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 1,
    folderId: 1,
    folderPath: 'INBOX',
    uid: 7,
    msgKey: 'k1',
    messageId: '<orig@example.test>',
    inReplyTo: '<root@example.test>',
    references: ['<root@example.test>'],
    threadId: '<root@example.test>',
    date: '2026-10-16T08:30:00.000Z',
    subject: 'Báo giá server',
    from: { name: 'Anh A', address: 'a@example.test' },
    to: [
      { name: 'Me', address: 'me@example.test' },
      { name: 'B', address: 'b@example.test' },
    ],
    cc: [{ name: 'C', address: 'c@example.test' }],
    replyTo: [],
    flags: ['\\Seen'],
    bodyText: 'Gửi anh báo giá.\nCảm ơn.',
    attachments: [],
    parseError: false,
    ...overrides,
  };
}

describe('buildDraft', () => {
  it('builds a new draft with from, to, subject and text + html parts', async () => {
    const d = await buildDraft({ to: ['x@example.test'], subject: 'Hello', body: 'Line 1\n\nLine 2' }, ctx);
    const p = await simpleParser(d.raw);
    expect(p.from?.value[0]).toEqual({ name: 'Me', address: 'me@example.test' });
    expect(p.subject).toBe('Hello');
    expect(p.messageId).toBe(d.messageId);
    expect(d.messageId).toMatch(/^<[^@]+@example\.test>$/);
    expect(p.text).toContain('Line 1');
    expect(p.html).toContain('<p>Line 2</p>');
    expect(d.to).toEqual(['x@example.test']);
    expect(d.cc).toEqual([]);
  });

  it('rejects a new draft without recipients or subject', async () => {
    await expect(buildDraft({ body: 'x', subject: 's' }, ctx)).rejects.toBeInstanceOf(MailError);
    await expect(buildDraft({ body: 'x', to: ['a@example.test'] }, ctx)).rejects.toBeInstanceOf(MailError);
  });

  it('threads a reply to the original sender with Re: subject and references', async () => {
    const d = await buildDraft({ body: 'Đồng ý.', replyToId: 'k1' }, { ...ctx, original: original() });
    const p = await simpleParser(d.raw);
    expect(d.to).toEqual(['a@example.test']);
    expect(p.subject).toBe('Re: Báo giá server');
    expect(p.inReplyTo).toBe('<orig@example.test>');
    expect(p.references).toEqual(['<root@example.test>', '<orig@example.test>']);
    expect(p.text).toContain('> Gửi anh báo giá.');
    expect(p.html).toContain('<blockquote');
  });

  it('prefers Reply-To and does not stack Re:', async () => {
    const d = await buildDraft(
      { body: 'ok', replyToId: 'k1' },
      { ...ctx, original: original({ subject: 'RE: Báo giá', replyTo: [{ name: '', address: 'sales@example.test' }] }) },
    );
    expect(d.to).toEqual(['sales@example.test']);
    expect(d.subject).toBe('RE: Báo giá');
  });

  it('reply-all adds the original To and Cc minus self and the primary recipients', async () => {
    const d = await buildDraft({ body: 'ok', replyToId: 'k1', replyAll: true }, { ...ctx, original: original() });
    expect(d.to).toEqual(['a@example.test']);
    expect(d.cc).toEqual(['b@example.test', 'c@example.test']);
  });

  describe('replying to a message the user sent', () => {
    const sent = (overrides: Partial<StoredMessage> = {}) =>
      original({
        folderPath: 'Sent',
        from: { name: 'Me', address: 'me@example.test' },
        to: [{ name: 'B', address: 'b@example.test' }],
        cc: [{ name: 'C', address: 'c@example.test' }],
        ...overrides,
      });

    it('addresses the original recipients instead of the user', async () => {
      const d = await buildDraft({ body: 'Nhắc lại.', replyToId: 'k1' }, { ...ctx, original: sent() });
      expect(d.to).toEqual(['b@example.test']);
      expect(d.cc).toEqual([]);
    });

    it('ignores a Reply-To the user set', async () => {
      const d = await buildDraft({ body: 'ok', replyToId: 'k1' }, { ...ctx, original: sent({ replyTo: [{ name: 'Team', address: 'team@example.test' }] }) });
      expect(d.to).toEqual(['b@example.test']);
    });

    it('keeps the original Cc on reply-all', async () => {
      const d = await buildDraft({ body: 'ok', replyToId: 'k1', replyAll: true }, { ...ctx, original: sent() });
      expect(d.to).toEqual(['b@example.test']);
      expect(d.cc).toEqual(['c@example.test']);
    });

    it('matches the identity case-insensitively', async () => {
      const d = await buildDraft({ body: 'ok', replyToId: 'k1' }, { ...ctx, identity: { name: 'Me', email: 'Me@Example.test' }, original: sent() });
      expect(d.to).toEqual(['b@example.test']);
    });
  });

  it('treats an empty "to" on a reply as not provided', async () => {
    const d = await buildDraft({ body: 'ok', replyToId: 'k1', to: [] }, { ...ctx, original: original() });
    expect(d.to).toEqual(['a@example.test']);
  });

  it('puts the signature before the quote', async () => {
    const d = await buildDraft({ body: 'ok', replyToId: 'k1' }, { ...ctx, signature: 'Best,\nMe', original: original() });
    const text = (await simpleParser(d.raw)).text ?? '';
    expect(text.indexOf('Best,')).toBeGreaterThan(-1);
    expect(text.indexOf('Best,')).toBeLessThan(text.indexOf('> Gửi anh'));
  });
});
