import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import { MailError } from '../core/errors.js';

const NAME = 'sea-mail';

export interface McpServer {
  command: string;
  args: string[];
}

export interface ConnectOptions {
  /** How the client starts this installation's MCP server. */
  server: McpServer;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  write: (text: string) => void;
}

type Table = Record<string, unknown>;

/** A client config file format. Every method throws INVALID_INPUT rather than risk damaging the file. */
interface ConfigFormat {
  /** sea-mail's entry in the file, or undefined when there is none. */
  entry(file: string, text: string): unknown;
  upsert(file: string, text: string, server: McpServer): string;
  remove(file: string, text: string): string;
}

interface Client {
  files(options: ConnectOptions): string[];
  format: ConfigFormat;
  restart: string;
}

/** Registers (or with --remove, unregisters) this installation as an MCP server in Codex or Claude Desktop. */
export function runConnect(argv: string[], options: ConnectOptions): void {
  const { values } = parseArgs({
    args: argv,
    options: { client: { type: 'string' }, remove: { type: 'boolean', default: false } },
  });
  const client = values.client === 'codex' ? CODEX : values.client === 'claude' ? CLAUDE : undefined;
  if (!client) {
    const got = values.client === undefined ? 'nothing' : `"${values.client}"`;
    throw new MailError('INVALID_INPUT', `--client must be "codex" or "claude", got ${got}`);
  }
  let changed = false;
  for (const file of client.files(options)) {
    const fileChanged = values.remove ? disconnectFile(file, client.format, options) : connectFile(file, client.format, options);
    changed ||= fileChanged;
  }
  if (changed) options.write(`${client.restart}\n`);
}

function connectFile(file: string, format: ConfigFormat, { server, platform, write }: ConnectOptions): boolean {
  const text = readText(file);
  const entry = text === undefined ? undefined : format.entry(file, text);
  if (sameServer(entry, server, platform)) {
    write(`sea-mail is already registered in ${file}; nothing to change.\n`);
    return false;
  }
  const next = format.upsert(file, text ?? '', server);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  write(entry === undefined ? `Added sea-mail to ${file}:\n` : `Updated sea-mail in ${file} (it ran: ${commandLine(entry)}):\n`);
  write(`  ${commandLine(server)}\n`);
  return true;
}

function disconnectFile(file: string, format: ConfigFormat, { server, platform, write }: ConnectOptions): boolean {
  const text = readText(file);
  const entry = text === undefined ? undefined : format.entry(file, text);
  if (text === undefined || entry === undefined) {
    write(`sea-mail is not registered in ${file}; nothing to remove.\n`);
    return false;
  }
  if (!sameServer(entry, server, platform)) {
    write(`Left sea-mail in ${file} alone: it runs ${commandLine(entry)}, not this installation.\n`);
    return false;
  }
  fs.writeFileSync(file, format.remove(file, text));
  write(`Removed sea-mail from ${file}.\n`);
  return true;
}

/** The file's text without a byte order mark, or undefined when it does not exist. */
function readText(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function isTable(value: unknown): value is Table {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** Whether a client entry starts the given server; Windows paths compare case-insensitively. */
function sameServer(entry: unknown, server: McpServer, platform: NodeJS.Platform): boolean {
  if (!isTable(entry) || !Array.isArray(entry.args) || entry.args.length !== server.args.length) return false;
  const same = (value: unknown, expected: string) =>
    typeof value === 'string' && (platform === 'win32' ? value.toLowerCase() === expected.toLowerCase() : value === expected);
  return same(entry.command, server.command) && entry.args.every((arg, i) => same(arg, server.args[i]!));
}

function commandLine(entry: unknown): string {
  if (!isTable(entry)) return JSON.stringify(entry);
  const words = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].map(String);
  return words.map((word) => (/\s/.test(word) ? `"${word}"` : word)).join(' ');
}

// --- Codex: ~/.codex/config.toml -------------------------------------------------------------

const CODEX: Client = {
  files: ({ env, homedir }) => [path.join(env.CODEX_HOME || path.join(homedir, '.codex'), 'config.toml')],
  format: {
    entry: (file, text) => tomlEntry(parseTomlFile(file, text)),
    upsert: upsertToml,
    remove: removeToml,
  },
  restart: 'Restart Codex to pick up the change.',
};

const ENTRY_TABLE = String.raw`\[\s*mcp_servers\s*\.\s*(?:sea-mail|"sea-mail"|'sea-mail')\s*`;
/** `[mcp_servers.sea-mail]`, the table `sea-mail connect` edits. */
const ENTRY_HEADER = new RegExp(String.raw`^\s*${ENTRY_TABLE}\]\s*(?:#.*)?$`);
/** `[mcp_servers.sea-mail.env]` and the like, which belong to the entry too. */
const ENTRY_SUBTABLE_HEADER = new RegExp(String.raw`^\s*\[?${ENTRY_TABLE}\.`);
const ANY_HEADER = /^\s*\[/;
const KEY_LINE = /^\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*=(.*)$/;

function parseTomlFile(file: string, text: string): Table {
  try {
    return plain(parseToml(text)) as Table;
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    throw new MailError('INVALID_INPUT', `${file} is not valid TOML (${reason}). Fix it, then run this again.`);
  }
}

/** smol-toml builds null-prototype objects; rebuild them as plain ones so they compare equal to literals. */
function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain);
  if (isTable(value)) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  return value;
}

function tomlEntry(doc: Table): unknown {
  return isTable(doc.mcp_servers) ? doc.mcp_servers[NAME] : undefined;
}

/** The document with sea-mail's entry taken out, to check that an edit touched nothing else. */
function withoutTomlEntry(doc: Table): Table {
  const { mcp_servers: servers, ...rest } = doc;
  if (!isTable(servers)) return doc;
  const { [NAME]: _entry, ...others } = servers;
  return Object.keys(others).length > 0 ? { ...rest, mcp_servers: others } : rest;
}

function tomlBlock(server: McpServer): string[] {
  // A JSON string is a valid TOML basic string for any real path; the parse check below catches the rest.
  const str = (value: string) => JSON.stringify(value);
  return ['[mcp_servers.sea-mail]', `command = ${str(server.command)}`, `args = [${server.args.map(str).join(', ')}]`];
}

/**
 * Rewrites only the command and args lines of `[mcp_servers.sea-mail]`, or appends that table.
 * The result is parsed back and compared with the original, so an edit that would change
 * anything else (or produce invalid TOML) is refused instead of written.
 */
function upsertToml(file: string, text: string, server: McpServer): string {
  const before = parseTomlFile(file, text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const [header, ...assignments] = tomlBlock(server);
  const at = lines.findIndex((line) => ENTRY_HEADER.test(line));
  let edited: string[];
  if (at === -1) {
    const kept = withoutTrailingBlankLines(lines);
    edited = [...kept, ...(kept.length > 0 ? [''] : []), header!, ...assignments, ''];
  } else {
    const end = sectionEnd(lines, at);
    edited = [...lines.slice(0, at + 1), ...assignments, ...withoutKeys(lines.slice(at + 1, end), ['command', 'args']), ...lines.slice(end)];
  }
  const next = edited.join(eol);

  const after = tryParseToml(next);
  const entryBefore = tomlEntry(before);
  const entryAfter = after && tomlEntry(after);
  const intact =
    after !== undefined &&
    isTable(entryAfter) &&
    isDeepStrictEqual(withoutTomlEntry(before), withoutTomlEntry(after)) &&
    isDeepStrictEqual(entryAfter, { ...(isTable(entryBefore) ? entryBefore : {}), ...server });
  if (!intact) throw cannotEdit(file, tomlBlock(server).join('\n'));
  return next;
}

/** Deletes `[mcp_servers.sea-mail]` and its subtables, keeping comments that introduce the next table. */
function removeToml(file: string, text: string): string {
  const before = parseTomlFile(file, text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!ENTRY_HEADER.test(lines[i]!) && !ENTRY_SUBTABLE_HEADER.test(lines[i]!)) {
      kept.push(lines[i++]!);
      continue;
    }
    const end = sectionEnd(lines, i);
    let last = i;
    for (let j = i + 1; j < end; j++) if (!/^\s*(?:#.*)?$/.test(lines[j]!)) last = j;
    i = last + 1;
    while (i < lines.length && lines[i]!.trim() === '') i++;
  }
  let next = kept.join(eol);
  if (/\n$/.test(text) && next !== '' && !next.endsWith(eol)) next += eol;

  const after = tryParseToml(next);
  const intact = after !== undefined && tomlEntry(after) === undefined && isDeepStrictEqual(withoutTomlEntry(before), withoutTomlEntry(after));
  if (!intact) throw new MailError('INVALID_INPUT', `Could not remove sea-mail from ${file} safely; delete its [mcp_servers.sea-mail] table by hand.`);
  return next;
}

function tryParseToml(text: string): Table | undefined {
  try {
    return plain(parseToml(text)) as Table;
  } catch {
    return undefined;
  }
}

function cannotEdit(file: string, block: string): MailError {
  return new MailError('INVALID_INPUT', `Could not update sea-mail in ${file} without touching the rest of it. Make its entry read:\n\n${block}\n`);
}

/** Index of the next table header after `start`, or the end of the file. */
function sectionEnd(lines: string[], start: number): number {
  const next = lines.findIndex((line, i) => i > start && ANY_HEADER.test(line));
  return next === -1 ? lines.length : next;
}

function withoutTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === '') end--;
  return lines.slice(0, end);
}

/** Drops `key = value` lines, including the continuation lines of a multi-line array. */
function withoutKeys(body: string[], keys: string[]): string[] {
  const kept: string[] = [];
  let depth = 0;
  for (const line of body) {
    if (depth > 0) {
      depth = bracketDepth(line, depth);
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (match && keys.includes(match[1] ?? match[2] ?? match[3]!)) {
      depth = bracketDepth(match[4]!, 0);
      continue;
    }
    kept.push(line);
  }
  return kept;
}

/** Array nesting depth after `text`, ignoring brackets inside strings and comments. */
function bracketDepth(text: string, depth: number): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '#') break;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return depth;
}

// --- Claude Desktop: claude_desktop_config.json ----------------------------------------------

const CLAUDE_FILE = 'claude_desktop_config.json';

const CLAUDE: Client = {
  files: claudeConfigFiles,
  format: {
    entry: (file, text) => jsonServers(file, parseJsonFile(file, text))?.[NAME],
    upsert(file, text, server) {
      const doc = parseJsonFile(file, text);
      const servers = jsonServers(file, doc) ?? {};
      const entry = servers[NAME];
      return toJson({ ...doc, mcpServers: { ...servers, [NAME]: { ...(isTable(entry) ? entry : {}), ...server } } });
    },
    remove(file, text) {
      const doc = parseJsonFile(file, text);
      const { [NAME]: _entry, ...others } = jsonServers(file, doc) ?? {};
      return toJson({ ...doc, mcpServers: others });
    },
  },
  restart: 'Quit Claude Desktop completely and reopen it to pick up the change.',
};

function claudeConfigFiles({ platform, env, homedir }: ConnectOptions): string[] {
  if (platform === 'darwin') return [path.join(homedir, 'Library', 'Application Support', 'Claude', CLAUDE_FILE)];
  if (platform !== 'win32') return [path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), 'Claude', CLAUDE_FILE)];
  const appData = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
  // The Microsoft Store (MSIX) build of Claude Desktop reads a per-package copy of %APPDATA% instead.
  const packages = path.join(env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local'), 'Packages');
  const msix = subdirectories(packages)
    .filter((name) => name.startsWith('Claude_'))
    .map((name) => path.join(packages, name, 'LocalCache', 'Roaming', 'Claude', CLAUDE_FILE));
  return [path.join(appData, 'Claude', CLAUDE_FILE), ...msix];
}

function subdirectories(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function parseJsonFile(file: string, text: string): Table {
  if (text.trim() === '') return {};
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new MailError('INVALID_INPUT', `${file} is not valid JSON (${reason}). Fix it, then run this again.`);
  }
  if (!isTable(doc)) throw new MailError('INVALID_INPUT', `${file} does not hold a JSON object. Fix it, then run this again.`);
  return doc;
}

function jsonServers(file: string, doc: Table): Table | undefined {
  if (doc.mcpServers === undefined) return undefined;
  if (!isTable(doc.mcpServers)) {
    throw new MailError('INVALID_INPUT', `"mcpServers" in ${file} is not a JSON object. Fix it, then run this again.`);
  }
  return doc.mcpServers;
}

function toJson(doc: Table): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
