import { describe, expect, it } from 'vitest';
import { deriveThreadId, makeMsgKey, normalizeMessageId, parseMessageIds } from '../../src/core/text/thread.js';

describe('parseMessageIds', () => {
  it('extracts ids from raw headers, folded lines and arrays', () => {
    expect(parseMessageIds('References: <a@x>\r\n <b@x>\r\n')).toEqual(['<a@x>', '<b@x>']);
    expect(parseMessageIds(['<a@x>', '<b@x> <c@x>'])).toEqual(['<a@x>', '<b@x>', '<c@x>']);
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseMessageIds('no ids here')).toEqual([]);
  });
});

describe('normalizeMessageId', () => {
  it('trims and wraps in angle brackets', () => {
    expect(normalizeMessageId(' <a@x> ')).toBe('<a@x>');
    expect(normalizeMessageId('a@x')).toBe('<a@x>');
    expect(normalizeMessageId('')).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
  });
});

describe('makeMsgKey', () => {
  it('is stable for the same Message-ID regardless of folder or uid', () => {
    const a = makeMsgKey('<a@x>', 'INBOX', 1, 10);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(makeMsgKey('<a@x>', 'Archive', 9, 99)).toBe(a);
  });

  it('falls back to folder, UIDVALIDITY and uid without a Message-ID', () => {
    expect(makeMsgKey(null, 'INBOX', 1, 10)).not.toBe(makeMsgKey(null, 'INBOX', 1, 11));
    expect(makeMsgKey(null, 'INBOX', 1, 10)).toBe(makeMsgKey(null, 'INBOX', 1, 10));
  });
});

describe('deriveThreadId', () => {
  const base = { references: [] as string[], inReplyTo: null, messageId: null, msgKey: 'k' };
  it('uses the first reference, then In-Reply-To, then Message-ID, then msgKey', () => {
    expect(deriveThreadId({ ...base, references: ['<root@x>', '<p@x>'], inReplyTo: '<p@x>', messageId: '<m@x>' })).toBe('<root@x>');
    expect(deriveThreadId({ ...base, inReplyTo: '<p@x>', messageId: '<m@x>' })).toBe('<p@x>');
    expect(deriveThreadId({ ...base, messageId: '<m@x>' })).toBe('<m@x>');
    expect(deriveThreadId(base)).toBe('k');
  });
});
