import { describe, expect, it } from 'vitest';
import { makeSnippet } from '../../src/core/text/snippet.js';

describe('makeSnippet', () => {
  it('cuts original text around the first match', () => {
    const text = `${'Mở đầu. '.repeat(40)}Gửi anh BÁO GIÁ server tháng 8.${' Kết thúc.'.repeat(40)}`;
    const s = makeSnippet(text, ['bao', 'gia']);
    expect(s).toContain('BÁO GIÁ');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(202);
  });

  it('uses the start of the text without terms and collapses whitespace', () => {
    expect(makeSnippet('Short body\n\nline 2', [])).toBe('Short body line 2');
    expect(makeSnippet('abc', ['zzz'])).toBe('abc');
  });
});
