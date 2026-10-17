import { normalizeForSearch } from './normalize.js';

/** About `width` characters of `text` around the first occurrence of any (normalized) term. */
export function makeSnippet(text: string, terms: string[], width = 200): string {
  let start = 0;
  if (terms.length > 0) {
    const haystack = normalizeForSearch(text);
    const hits = terms.map((t) => haystack.indexOf(t)).filter((i) => i >= 0);
    if (hits.length > 0) start = Math.max(0, Math.min(...hits) - Math.floor(width / 4));
  }
  const end = Math.min(text.length, start + width);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}
