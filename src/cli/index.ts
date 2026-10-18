#!/usr/bin/env node
import { createRequire } from 'node:module';
import { homeDir, keychainPasswordStore } from '../core/config.js';
import { MailError } from '../core/errors.js';
import { runSearch } from './search.js';
import { runServe } from './serve.js';
import { runSetup } from './setup.js';
import { runSync } from './sync.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const USAGE = `Usage: sea-mail <command>

Commands:
  setup            Configure the IMAP account and run the first sync
  sync             Fetch new mail into the local index
  search <query>   Search the local index (--from --to --folder --after --before --limit)
  serve            Run the MCP server on stdio (used by Codex / Claude)
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const home = homeDir();
  switch (command) {
    case 'setup':
      return runSetup(home, keychainPasswordStore);
    case 'sync':
      return runSync(home, keychainPasswordStore);
    case 'search':
      return runSearch(home, keychainPasswordStore, rest);
    case 'serve':
      return runServe(home, keychainPasswordStore, version);
    default:
      process.stderr.write(USAGE);
      process.exitCode = command === undefined || command === '--help' || command === '-h' ? 0 : 1;
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`${describeError(err)}\n`);
  process.exit(1);
});

/** One line for the user; set DEBUG to also get the stack of an unexpected error. */
function describeError(err: unknown): string {
  if (err instanceof MailError) return `${err.code}: ${err.message}`;
  if (!(err instanceof Error)) return String(err);
  return process.env.DEBUG ? (err.stack ?? err.message) : err.message;
}
