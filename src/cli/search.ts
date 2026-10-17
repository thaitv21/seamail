import { parseArgs } from 'node:util';
import type { PasswordStore } from '../core/config.js';
import { createContext } from './context.js';

/** Debugging aid: prints search_emails results as text. */
export async function runSearch(home: string, passwords: PasswordStore, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      folder: { type: 'string' },
      after: { type: 'string' },
      before: { type: 'string' },
      limit: { type: 'string' },
    },
  });
  const ctx = createContext(home, passwords);
  try {
    const res = await ctx.core.search({
      query: positionals.join(' ') || undefined,
      from: values.from,
      to: values.to,
      folder: values.folder,
      after: values.after,
      before: values.before,
      limit: values.limit ? Number(values.limit) : undefined,
    });
    for (const r of res.results) {
      process.stdout.write(`${r.date.slice(0, 10)}  ${r.from.address.padEnd(32)}  ${r.subject}\n    [${r.id}] ${r.snippet}\n`);
    }
    process.stdout.write(`${res.results.length} of ${res.total}${res.stale ? ' (stale: could not refresh)' : ''}\n`);
  } finally {
    ctx.close();
  }
}
