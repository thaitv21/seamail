import { describe, expect, it } from 'vitest';
import { chooseBodyText } from '../../src/core/text/body.js';

describe('chooseBodyText', () => {
  it('prefers the text part and normalizes line endings', () => {
    expect(chooseBodyText('Hello\r\nWorld\r\n', '<p>ignored</p>')).toBe('Hello\nWorld');
  });

  it('falls back to HTML converted to text without links or images', () => {
    expect(chooseBodyText('   ', '<p>Xin chào <a href="http://x">anh</a></p><img src="a.png">')).toBe('Xin chào anh');
  });

  it('returns NFC text and empty string when there is no body', () => {
    expect(chooseBodyText('Báo', null)).toBe('Báo');
    expect(chooseBodyText(null, null)).toBe('');
  });
});
