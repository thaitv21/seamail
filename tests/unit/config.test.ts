import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configPath, dbPath, homeDir, keychainAccount, loadConfig, saveConfig, type AppConfig } from '../../src/core/config.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-mail-cfg-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const minimal = {
  imap: { host: 'imap.example.test', port: 993, secure: true, user: 'me' },
  identity: { name: 'Me', email: 'me@example.test' },
};

describe('config', () => {
  it('resolves paths from SEA_MAIL_HOME or ~/.sea-mail', () => {
    expect(homeDir({ SEA_MAIL_HOME: '/x/y' })).toBe('/x/y');
    expect(homeDir({})).toBe(path.join(os.homedir(), '.sea-mail'));
    expect(configPath('/h')).toBe(path.join('/h', 'config.json'));
    expect(dbPath('/h')).toBe(path.join('/h', 'mail.db'));
  });

  it('applies defaults to a minimal config', () => {
    const home = tmp();
    fs.writeFileSync(configPath(home), JSON.stringify(minimal));
    expect(loadConfig(home)).toEqual({
      ...minimal,
      sync: { excludeFolders: [], staleAfterMinutes: 5 },
      drafts: { folder: null, signature: null },
    });
  });

  it('gives each loaded config its own default arrays', () => {
    const home = tmp();
    fs.writeFileSync(configPath(home), JSON.stringify(minimal));
    const first = loadConfig(home);
    first.sync.excludeFolders.push('LEAK');
    expect(loadConfig(home).sync.excludeFolders).toEqual([]);
  });

  it('round-trips and writes the file with mode 600', () => {
    const home = path.join(tmp(), 'nested');
    const config: AppConfig = {
      ...minimal,
      sync: { excludeFolders: ['Spam'], staleAfterMinutes: 10 },
      drafts: { folder: 'Drafts', signature: 'Me' },
    };
    saveConfig(home, config);
    expect(loadConfig(home)).toEqual(config);
    expect(fs.statSync(configPath(home)).mode & 0o777).toBe(0o600);
  });

  it('reports a missing or invalid config as NOT_CONFIGURED', () => {
    const home = tmp();
    expect(codeOf(() => loadConfig(home))).toBe('NOT_CONFIGURED');
    fs.writeFileSync(configPath(home), '{ not json');
    expect(codeOf(() => loadConfig(home))).toBe('NOT_CONFIGURED');
    fs.writeFileSync(configPath(home), JSON.stringify({ imap: {} }));
    expect(codeOf(() => loadConfig(home))).toBe('NOT_CONFIGURED');
  });

  it('names the keychain entry after user and host', () => {
    expect(keychainAccount(minimal)).toBe('me@imap.example.test');
  });
});
