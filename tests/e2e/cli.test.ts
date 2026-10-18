import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbPath, saveConfig } from '../../src/core/config.js';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import { TEST_CONFIG } from '../helpers/core.js';
import { newMessage } from '../helpers/fixtures.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  return { ...env, ...extra };
}

describe('sea-mail CLI (built)', () => {
  let home: string;

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-mail-e2e-'));
    saveConfig(home, TEST_CONFIG);
    const db = openDb(dbPath(home));
    const repo = new Repo(db);
    const inbox = repo.upsertFolder('INBOX', '\\Inbox');
    repo.insertMessages(inbox.id, [newMessage({ msgKey: 'k1', subject: 'Báo giá server', bodyText: 'Gửi anh báo giá.' })]);
    repo.setMeta('last_synced_at', new Date().toISOString());
    db.close();
  }, 120_000);

  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('prints usage and rejects unknown commands', () => {
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stderr).toContain('Usage: sea-mail');
    expect(spawnSync(process.execPath, [CLI, 'bogus'], { encoding: 'utf8' }).status).toBe(1);
  });

  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: cleanEnv({ SEA_MAIL_HOME: home, DEBUG: '', ...env }) });
  const STACK_FRAME = /^\s+at /m;

  it('rejects a --limit that is not a positive whole number', () => {
    for (const limit of ['abc', '0', '2.5']) {
      const r = run(['search', 'bao gia', '--limit', limit]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/^INVALID_INPUT: --limit /);
      expect(r.stdout).toBe('');
    }
    expect(run(['search', 'bao gia', '--limit', '5']).stdout).toContain('Báo giá server');
  });

  it('prints an unexpected error as one line, with the stack only under DEBUG', () => {
    const plain = run(['search', '--bogus']);
    expect(plain.status).toBe(1);
    expect(plain.stderr).toContain("Unknown option '--bogus'");
    expect(plain.stderr).not.toMatch(STACK_FRAME);
    expect(run(['search', '--bogus'], { DEBUG: '1' }).stderr).toMatch(STACK_FRAME);
  });

  it('serves MCP over stdio with a clean stdout', async () => {
    // The client reports every non-JSON-RPC line the server writes to stdout through onerror.
    const errors: Error[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'serve'],
      env: cleanEnv({ SEA_MAIL_HOME: home }),
      stderr: 'ignore',
    });
    const client = new Client({ name: 'stdio-test', version: '0' });
    client.onerror = (error) => errors.push(error);
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: 'search_emails', arguments: { query: 'bao gia' } });
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(payload.results[0].subject).toBe('Báo giá server');
      expect(errors).toEqual([]);
    } finally {
      await client.close();
    }
  }, 20_000);
});
