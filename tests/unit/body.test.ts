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

  it('keeps the cells of a one-column layout table on separate lines', () => {
    expect(chooseBodyText(null, '<table><tr><td>Hello</td></tr><tr><td>World</td></tr></table>')).toBe('Hello\nWorld');
  });

  it('keeps adjacent table cells apart and does not uppercase header cells', () => {
    const text = chooseBodyText(null, '<table><tr><th>Sản phẩm</th><th>Giá</th></tr><tr><td>A</td><td>100</td></tr></table>');
    expect(text).toMatch(/Sản phẩm\s+Giá/);
    expect(text).toMatch(/A\s+100/);
    expect(text).toContain('Sản phẩm');
  });
});
