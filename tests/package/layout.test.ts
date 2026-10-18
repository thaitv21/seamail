import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse as parseToml } from 'smol-toml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbPath, saveConfig } from '../../src/core/config.js';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import { TEST_CONFIG } from '../helpers/core.js';
import { newMessage } from '../helpers/fixtures.js';

/**
 * Smoke test of the Windows layout from scripts/package-windows.mjs, or of an installed copy
 * (SEA_MAIL_LAYOUT=%LOCALAPPDATA%\Programs\sea-mail): the bundled node runs the bundled app.
 * Run it on an installed copy too: inside the repo, a dependency missing from app\node_modules
 * would still resolve from the repo's own node_modules.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LAYOUT = path.resolve(ROOT, process.env.SEA_MAIL_LAYOUT || path.join('build', 'windows', 'sea-mail'));
const NODE = path.join(LAYOUT, 'node', 'node.exe');
const APP = path.join(LAYOUT, 'app');
const CLI = path.join(APP, 'dist', 'cli', 'index.js');
const SEA_MAIL_CMD = path.join(LAYOUT, 'bin', 'sea-mail.cmd');
const onWindows = process.platform === 'win32';

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return { ...env, DEBUG: '', ...extra };
}

describe(`packaged sea-mail in ${LAYOUT}`, () => {
  let scratch: string;
  let home: string;
  const options = (env: Record<string, string> = {}): SpawnSyncOptions & { encoding: 'utf8' } => ({
    cwd: scratch,
    encoding: 'utf8',
    env: cleanEnv({ SEA_MAIL_HOME: home, ...env }),
  });
  const seaMailCmd = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('cmd.exe', ['/d', '/c', SEA_MAIL_CMD, ...args], options(env));
  const samePath = (actual: unknown, expected: string) =>
    expect(onWindows && typeof actual === 'string' ? actual.toLowerCase() : actual).toBe(onWindows ? expected.toLowerCase() : expected);

  beforeAll(() => {
    expect(fs.existsSync(NODE), `${NODE} is missing; run scripts/package-windows.mjs first`).toBe(true);
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-mail-package-'));
    home = path.join(scratch, 'home');
    saveConfig(home, TEST_CONFIG);
    const db = openDb(dbPath(home));
    const repo = new Repo(db);
    const inbox = repo.upsertFolder('INBOX', '\\Inbox');
    repo.insertMessages(inbox.id, [newMessage({ msgKey: 'k1', subject: 'Báo giá server', bodyText: 'Gửi anh báo giá.' })]);
    repo.setMeta('last_synced_at', new Date().toISOString());
    db.close();
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('loads its native modules with the bundled node', () => {
    const script = [
      "const Database = require('better-sqlite3');",
      "new Database(':memory:').prepare('select 1').get();",
      "const { Entry } = require('@napi-rs/keyring');",
      "new Entry('sea-mail-smoke-test', 'nobody');",
    ].join(' ');
    const r = spawnSync(NODE, ['-e', script], { ...options(), cwd: APP });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it.runIf(onWindows)('runs the CLI through bin\\sea-mail.cmd and passes its exit code back', () => {
    const help = seaMailCmd(['--help']);
    expect(help.stderr).toContain('Usage: sea-mail');
    expect(help.status).toBe(0);
    expect(seaMailCmd(['bogus']).status).toBe(1);
  });

  it('registers the bundled node and CLI with Codex, and the uninstaller’s --remove matches them', () => {
    const codexHome = path.join(scratch, 'codex');
    const config = path.join(codexHome, 'config.toml');
    const env = { CODEX_HOME: codexHome };
    // Like the installer: connect through sea-mail.cmd, remove by calling node.exe directly.
    const connect = onWindows ? seaMailCmd(['connect', '--client', 'codex'], env) : spawnSync(NODE, [CLI, 'connect', '--client', 'codex'], options(env));
    expect(connect.stderr).toBe('');
    expect(connect.status).toBe(0);
    const entry = (parseToml(fs.readFileSync(config, 'utf8')) as { mcp_servers: Record<string, { command: string; args: string[] }> })
      .mcp_servers['sea-mail']!;
    samePath(entry.command, NODE);
    samePath(entry.args[0], CLI);
    expect(entry.args[1]).toBe('serve');

    const remove = spawnSync(NODE, [CLI, 'connect', '--client', 'codex', '--remove'], options(env));
    expect(remove.stdout).toContain('Removed sea-mail');
    expect(parseToml(fs.readFileSync(config, 'utf8'))).toEqual({});
  });

  it('serves MCP over stdio with a clean stdout', async () => {
    const errors: Error[] = [];
    const transport = new StdioClientTransport({
      command: NODE,
      args: [CLI, 'serve'],
      cwd: scratch,
      env: cleanEnv({ SEA_MAIL_HOME: home }),
      stderr: 'ignore',
    });
    const client = new Client({ name: 'package-smoke-test', version: '0' });
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
  });
});
