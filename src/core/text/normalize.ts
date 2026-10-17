const COMBINING_MARKS = /\p{M}/gu;
const NON_WORD = /[^\p{L}\p{N}]+/u;

/**
 * Lowercases, strips diacritics and maps đ → d, emitting exactly as many UTF-16 units as it reads,
 * so an offset found in the result is the same offset in the input.
 *
 * Callers must pass NFC text: the one-to-one offset guarantee and the word segmentation both assume
 * precomposed input. A standalone combining mark (one read as its own code point, as happens with
 * decomposed input) is kept as-is rather than stripped, so it survives as a non-letter character.
 */
export function normalizeForSearch(input: string): string {
  let out = '';
  for (const ch of input) {
    let mapped = ch === 'đ' || ch === 'Đ' ? 'd' : ch.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
    if (mapped.length !== ch.length) {
      const lower = ch.toLowerCase();
      mapped = lower.length === ch.length ? lower : ch;
    }
    out += mapped;
  }
  return out;
}

export interface ParsedQuery {
  /** FTS5 MATCH expression made only of double-quoted string literals and OR. */
  fts: string;
  /** Normalized words, used to place snippets. */
  terms: string[];
}

/** Turns free text (words, "phrases", OR) into a safe FTS5 expression. */
export function parseQuery(query: string): ParsedQuery | null {
  query = query.normalize('NFC');
  const parts: string[] = [];
  const terms: string[] = [];
  for (const [, phrase, word] of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    if (word === 'OR') {
      if (parts.length > 0 && parts[parts.length - 1] !== 'OR') parts.push('OR');
      continue;
    }
    const words = normalizeForSearch(phrase ?? word ?? '').split(NON_WORD).filter(Boolean);
    if (words.length === 0) continue;
    terms.push(...words);
    if (phrase !== undefined) parts.push(`"${words.join(' ')}"`);
    else parts.push(...words.map((w) => `"${w}"`));
  }
  while (parts[parts.length - 1] === 'OR') parts.pop();
  return terms.length > 0 ? { fts: parts.join(' '), terms } : null;
}
