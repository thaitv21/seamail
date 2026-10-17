import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContext } from '../../src/cli/context.js';
import { keychainAccount, saveConfig, type AppConfig } from '../../src/core/config.js';
import { TEST_CONFIG } from '../helpers/core.js';
import { memoryPasswordStore } from '../helpers/passwords.js';
import { GREENMAIL, appendMail, connectRaw, newUser } from './greenmail.js';

function tempHome(config: AppConfig): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-mail-ctx-'));
  saveConfig(home, config);
  return home;
}

describe('createContext', () => {
  it('wires config, password store and IMAP into a working core', async () => {
    const user = newUser();
    const raw = await connectRaw(user);
    await appendMail(raw, 'INBOX', { messageId: '<c1@example.test>', subject: 'Hợp đồng', text: 'hop dong' });
    const config: AppConfig = { ...TEST_CONFIG, imap: { host: GREENMAIL.host, port: GREENMAIL.port, secure: false, user } };
    const home = tempHome(config);
    const ctx = createContext(home, memoryPasswordStore({ [keychainAccount(config)]: 'any' }));
    try {
      await ctx.syncer.sync();
      expect((await ctx.core.search({ query: 'hop dong' })).total).toBe(1);
    } finally {
      ctx.close();
      await raw.logout();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('reports a missing keychain entry as AUTH_FAILED', async () => {
    const home = tempHome(TEST_CONFIG);
    const ctx = createContext(home, memoryPasswordStore());
    try {
      await expect(ctx.syncer.sync()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    } finally {
      ctx.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
