const WROTE_ONE_LINE = [/^On\b.*\bwrote:$/iu, /^Vào\b.*đã viết:$/iu];
const WROTE_START = [/^On\b/iu, /^Vào\b/iu];
const WROTE_END = [/\bwrote:$/iu, /đã viết:$/iu];
const ORIGINAL_MESSAGE = /^-{2,}\s*Original Message\s*-{2,}$/iu;
const SEPARATOR = /^_{10,}$/u;
const FROM_LINE = /^(From|Từ):/iu;
const SENT_LINE = /^(Sent|Date|Đã gửi):/iu;

/** Removes the quoted history from a reply so a thread can be read without repetition. */
export function stripQuotes(body: string): string {
  const lines = body.split('\n');
  const at = (i: number): string => (lines[i] ?? '').trim();
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = at(i);
    const next = at(i + 1);
    const wrote =
      WROTE_ONE_LINE.some((re) => re.test(line)) ||
      WROTE_START.some((re, k) => re.test(line) && WROTE_END[k]!.test(next));
    const outlookHeader = FROM_LINE.test(line) && [1, 2, 3, 4].some((d) => SENT_LINE.test(at(i + d)));
    if (wrote || ORIGINAL_MESSAGE.test(line) || (SEPARATOR.test(line) && FROM_LINE.test(next)) || outlookHeader) {
      cut = i;
      break;
    }
  }
  const kept = lines
    .slice(0, cut)
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .trim();
  return kept === '' ? body.trim() : kept;
}
