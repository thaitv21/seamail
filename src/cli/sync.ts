import type { PasswordStore } from '../core/config.js';
import { createContext } from './context.js';

export async function runSync(home: string, passwords: PasswordStore): Promise<void> {
  const ctx = createContext(home, passwords, (folder, done, total) => {
    process.stderr.write(`\r${folder}: ${done}/${total}${done === total ? '\n' : ''}`);
  });
  try {
    const r = await ctx.syncer.sync();
    process.stderr.write(
      `Synced: ${r.newMessages} new, ${r.updatedFlags} flag changes, ${r.deleted} deleted in ${(r.durationMs / 1000).toFixed(1)} s\n`,
    );
    if (r.failedFolders.length > 0) {
      process.stderr.write(`Skipped ${r.failedFolders.length} folder(s) that could not be synced: ${r.failedFolders.join(', ')}\n`);
    }
  } finally {
    ctx.close();
  }
}
