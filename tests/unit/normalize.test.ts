import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { normalizeForSearch, parseQuery } from '../../src/core/text/normalize.js';

describe('normalizeForSearch', () => {
  it('strips Vietnamese diacritics, maps đ and lowercases', () => {
    expect(normalizeForSearch('Báo giá ĐƠN HÀNG')).toBe('bao gia don hang');
    expect(normalizeForSearch('Ước tính Đà Nẵng')).toBe('uoc tinh da nang');
    expect(normalizeForSearch('Hello WORLD')).toBe('hello world');
  });

  it('preserves string length so offsets map back to the original', () => {
    for (const s of ['Báo giá 🚀 xong', 'İstanbul', 'ﬁle', 'a\u0301', 'Nguyễn Văn Đức']) {
      expect(normalizeForSearch(s)).toHaveLength(s.length);
    }
  });
});

describe('parseQuery', () => {
  it('quotes every normalized word', () => {
    expect(parseQuery('Báo giá')).toEqual({ fts: '"bao" "gia"', terms: ['bao', 'gia'] });
  });

  it('treats a decomposed (NFD) query the same as its NFC form', () => {
    expect(parseQuery('Báo giá'.normalize('NFD'))).toEqual({ fts: '"bao" "gia"', terms: ['bao', 'gia'] });
  });

  it('keeps phrases and OR', () => {
    expect(parseQuery('"đơn hàng" OR invoice')).toEqual({
      fts: '"don hang" OR "invoice"',
      terms: ['don', 'hang', 'invoice'],
    });
  });

  it('neutralizes FTS syntax characters', () => {
    expect(parseQuery('server-01: "x')?.fts).toBe('"server" "01" "x"');
  });

  it('drops dangling OR and returns null when nothing is searchable', () => {
    expect(parseQuery('a OR')).toEqual({ fts: '"a"', terms: ['a'] });
    expect(parseQuery('OR OR')).toBeNull();
    expect(parseQuery('  ')).toBeNull();
  });

  it('produces expressions FTS5 accepts and matches accent-insensitively', () => {
    const db = new Database(':memory:');
    db.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='unicode61 remove_diacritics 2')");
    db.prepare('INSERT INTO t(body) VALUES (?)').run(normalizeForSearch('Gửi anh báo giá ĐƠN HÀNG server-01'));
    for (const q of ['bao gia', '"don hang"', 'server-01', 'AND NOT NEAR(', 'x OR "don hang"', 'C:\\path *star*']) {
      const parsed = parseQuery(q);
      if (parsed) expect(() => db.prepare('SELECT count(*) FROM t WHERE t MATCH ?').get(parsed.fts)).not.toThrow();
    }
    expect(db.prepare('SELECT count(*) AS n FROM t WHERE t MATCH ?').get(parseQuery('BÁO GIÁ')!.fts)).toEqual({ n: 1 });
  });
});
