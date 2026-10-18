import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConnect, type ConnectOptions } from '../../src/cli/connect.js';
import { MailError } from '../../src/core/errors.js';

const SERVER = { command: '/opt/node/bin/node', args: ['/opt/sea-mail/dist/cli/index.js', 'serve'] };
const SECTION = `[mcp_servers.sea-mail]
command = "/opt/node/bin/node"
args = ["/opt/sea-mail/dist/cli/index.js", "serve"]
`;

describe('sea-mail connect', () => {
  let root: string;
  let home: string;
  let output: string[];

  const options = (overrides: Partial<ConnectOptions> = {}): ConnectOptions => ({
    server: SERVER,
    platform: 'darwin',
    env: {},
    homedir: home,
    write: (text) => output.push(text),
    ...overrides,
  });
  const printed = () => output.join('');
  const read = (file: string) => fs.readFileSync(file, 'utf8');
  const seed = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const expectInvalid = (fn: () => void, message: RegExp) => {
    let error: unknown;
    try {
      fn();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).code).toBe('INVALID_INPUT');
    expect((error as MailError).message).toMatch(message);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-mail-connect-'));
    home = path.join(root, 'home');
    fs.mkdirSync(home);
    output = [];
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('arguments', () => {
    it('requires --client to be codex or claude', () => {
      expectInvalid(() => runConnect([], options()), /--client/);
      expectInvalid(() => runConnect(['--client', 'cursor'], options()), /--client/);
      expect(fs.readdirSync(home)).toEqual([]);
    });
  });

  describe('--client codex', () => {
    let config: string;
    beforeEach(() => {
      config = path.join(home, '.codex', 'config.toml');
    });
    const connect = (extra: string[] = [], overrides: Partial<ConnectOptions> = {}) =>
      runConnect(['--client', 'codex', ...extra], options(overrides));

    it('creates ~/.codex/config.toml holding the server when there is none', () => {
      connect();
      expect(read(config)).toBe(SECTION);
      expect(printed()).toContain(`Added sea-mail to ${config}`);
      expect(printed()).toContain('/opt/node/bin/node /opt/sea-mail/dist/cli/index.js serve');
    });

    it('uses $CODEX_HOME when it is set', () => {
      const codexHome = path.join(root, 'codex-home');
      connect([], { env: { CODEX_HOME: codexHome } });
      expect(read(path.join(codexHome, 'config.toml'))).toBe(SECTION);
      expect(fs.existsSync(config)).toBe(false);
    });

    it('appends to an existing config and leaves the rest of it byte for byte', () => {
      const existing = '# my settings\nmodel = "o3"\n\n[mcp_servers.other]\ncommand = "other"\n';
      seed(config, existing);
      connect();
      expect(read(config)).toBe(`${existing}\n${SECTION}`);
    });

    it('updates command and args in place, keeping the entry’s other keys, its subtables and other sections', () => {
      seed(
        config,
        `model = "o3"

[mcp_servers.sea-mail]
# set up by hand
command = "old-node"
args = [
  "old.js",
  "serve",
]
startup_timeout_sec = 30

[mcp_servers.sea-mail.env]
FOO = "bar"

[profiles.x]
model = "y"
`,
      );
      connect();
      expect(read(config)).toBe(`model = "o3"

[mcp_servers.sea-mail]
command = "/opt/node/bin/node"
args = ["/opt/sea-mail/dist/cli/index.js", "serve"]
# set up by hand
startup_timeout_sec = 30

[mcp_servers.sea-mail.env]
FOO = "bar"

[profiles.x]
model = "y"
`);
      expect(printed()).toContain(`Updated sea-mail in ${config}`);
      expect(printed()).toContain('old-node old.js serve');
    });

    it('changes nothing when the entry already runs this installation, however it is written', () => {
      const existing = `[mcp_servers."sea-mail"]\ncommand = '/opt/node/bin/node'\nargs = [ '/opt/sea-mail/dist/cli/index.js', 'serve' ]\n`;
      seed(config, existing);
      connect();
      connect();
      expect(read(config)).toBe(existing);
      expect(printed()).not.toContain('Updated');
      expect(printed()).toContain(`sea-mail is already registered in ${config}`);
    });

    it('is idempotent: a second run leaves the file as the first run wrote it', () => {
      seed(config, 'model = "o3"\n');
      connect();
      const first = read(config);
      connect();
      expect(read(config)).toBe(first);
      expect(output.filter((line) => line.includes('Added'))).toHaveLength(1);
    });

    it('writes Windows paths so that Codex reads back exactly the same path', () => {
      const command = "C:\\Users\\O'Brien\\AppData\\Local\\Programs\\sea-mail\\node\\node.exe";
      const cli = "C:\\Users\\O'Brien\\AppData\\Local\\Programs\\sea-mail\\app\\dist\\cli\\index.js";
      connect([], { server: { command, args: [cli, 'serve'] } });
      expect(read(config)).toContain(
        `command = "C:\\\\Users\\\\O'Brien\\\\AppData\\\\Local\\\\Programs\\\\sea-mail\\\\node\\\\node.exe"`,
      );
      const parsed = parseToml(read(config)) as { mcp_servers: Record<string, { command: string; args: string[] }> };
      expect(parsed.mcp_servers['sea-mail']).toEqual({ command, args: [cli, 'serve'] });
    });

    it('keeps CRLF line endings', () => {
      seed(config, 'model = "o3"\r\n');
      connect();
      expect(read(config)).toBe(`model = "o3"\r\n\r\n${SECTION.replaceAll('\n', '\r\n')}`);
    });

    it('refuses to touch a file that is not valid TOML', () => {
      seed(config, 'model = \n');
      expectInvalid(() => connect(), /not valid TOML/);
      expect(read(config)).toBe('model = \n');
    });

    it('refuses an entry it cannot edit in place instead of writing a second one', () => {
      const existing = '[mcp_servers]\nsea-mail = { command = "old-node", args = [] }\n';
      seed(config, existing);
      expectInvalid(() => connect(), /\[mcp_servers\.sea-mail\]/);
      expect(read(config)).toBe(existing);
    });

    describe('--remove', () => {
      it('deletes the entry and its subtables when it runs this installation, and nothing else', () => {
        seed(
          config,
          `model = "o3"

${SECTION}startup_timeout_sec = 30

[mcp_servers.sea-mail.env]
FOO = "bar"

# The other server
[mcp_servers.other]
command = "other"
`,
        );
        connect(['--remove']);
        expect(read(config)).toBe(`model = "o3"

# The other server
[mcp_servers.other]
command = "other"
`);
        expect(printed()).toContain(`Removed sea-mail from ${config}`);
      });

      it('leaves an entry that runs another sea-mail alone', () => {
        const existing = '[mcp_servers.sea-mail]\ncommand = "node"\nargs = ["/src/sea-mail/dist/cli/index.js", "serve"]\n';
        seed(config, existing);
        connect(['--remove']);
        expect(read(config)).toBe(existing);
        expect(printed()).toContain('/src/sea-mail/dist/cli/index.js');
        expect(printed()).not.toContain('Removed');
      });

      it('does nothing when there is no entry', () => {
        connect(['--remove']);
        expect(fs.existsSync(config)).toBe(false);
        expect(printed()).toContain('not registered');
      });
    });
  });

  describe('--client claude', () => {
    const macConfig = () => path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    const connect = (extra: string[] = [], overrides: Partial<ConnectOptions> = {}) =>
      runConnect(['--client', 'claude', ...extra], options(overrides));
    const readJson = (file: string) => JSON.parse(read(file)) as unknown;

    it('creates the config in ~/Library/Application Support/Claude on macOS', () => {
      connect();
      expect(read(macConfig())).toBe(`{
  "mcpServers": {
    "sea-mail": {
      "command": "/opt/node/bin/node",
      "args": [
        "/opt/sea-mail/dist/cli/index.js",
        "serve"
      ]
    }
  }
}
`);
      expect(printed()).toContain(`Added sea-mail to ${macConfig()}`);
    });

    it('writes %APPDATA%\\Claude on Windows, plus the folder a Microsoft Store (MSIX) install reads', () => {
      const appData = path.join(root, 'Roaming');
      const localAppData = path.join(root, 'Local');
      fs.mkdirSync(path.join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc'), { recursive: true });
      fs.mkdirSync(path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe'));
      connect([], { platform: 'win32', env: { APPDATA: appData, LOCALAPPDATA: localAppData } });

      const plain = path.join(appData, 'Claude', 'claude_desktop_config.json');
      const msix = path.join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
      for (const file of [plain, msix]) {
        expect(readJson(file)).toEqual({ mcpServers: { 'sea-mail': SERVER } });
        expect(printed()).toContain(`Added sea-mail to ${file}`);
      }
      expect(fs.readdirSync(path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe'))).toEqual([]);
    });

    it('writes $XDG_CONFIG_HOME/Claude on Linux', () => {
      const xdg = path.join(root, 'xdg');
      connect([], { platform: 'linux', env: { XDG_CONFIG_HOME: xdg } });
      expect(readJson(path.join(xdg, 'Claude', 'claude_desktop_config.json'))).toEqual({ mcpServers: { 'sea-mail': SERVER } });
    });

    it('merges into an existing config, keeping other servers, other settings and extra keys on the entry', () => {
      seed(
        macConfig(),
        JSON.stringify({
          globalShortcut: 'Ctrl+Space',
          mcpServers: {
            other: { command: 'other', args: [] },
            'sea-mail': { command: 'old-node', args: ['old.js', 'serve'], env: { DEBUG: '1' } },
          },
        }),
      );
      connect();
      expect(readJson(macConfig())).toEqual({
        globalShortcut: 'Ctrl+Space',
        mcpServers: {
          other: { command: 'other', args: [] },
          'sea-mail': { ...SERVER, env: { DEBUG: '1' } },
        },
      });
      expect(printed()).toContain(`Updated sea-mail in ${macConfig()}`);
      expect(printed()).toContain('old-node old.js serve');
    });

    it('changes nothing when the entry already runs this installation', () => {
      const existing = JSON.stringify({ mcpServers: { 'sea-mail': SERVER } });
      seed(macConfig(), existing);
      connect();
      expect(read(macConfig())).toBe(existing);
      expect(printed()).toContain(`sea-mail is already registered in ${macConfig()}`);
    });

    it('reads a file saved with a UTF-8 byte order mark', () => {
      seed(macConfig(), '\uFEFF{ "mcpServers": {} }');
      connect();
      expect(readJson(macConfig())).toEqual({ mcpServers: { 'sea-mail': SERVER } });
    });

    it('refuses to touch a file that is not valid JSON, or whose mcpServers is not an object', () => {
      for (const existing of ['{ "mcpServers": ', '[]', '{ "mcpServers": [] }']) {
        seed(macConfig(), existing);
        expectInvalid(() => connect(), /claude_desktop_config\.json/);
        expect(read(macConfig())).toBe(existing);
      }
    });

    describe('--remove', () => {
      it('deletes the entry when it runs this installation, keeping everything else', () => {
        seed(macConfig(), JSON.stringify({ globalShortcut: 'x', mcpServers: { other: { command: 'o' }, 'sea-mail': SERVER } }));
        connect(['--remove']);
        expect(readJson(macConfig())).toEqual({ globalShortcut: 'x', mcpServers: { other: { command: 'o' } } });
        expect(printed()).toContain(`Removed sea-mail from ${macConfig()}`);
      });

      it('leaves an entry that runs another sea-mail alone', () => {
        const existing = JSON.stringify({ mcpServers: { 'sea-mail': { command: 'node', args: ['/src/index.js', 'serve'] } } });
        seed(macConfig(), existing);
        connect(['--remove']);
        expect(read(macConfig())).toBe(existing);
        expect(printed()).toContain('/src/index.js');
        expect(printed()).not.toContain('Removed');
      });

      it('matches this installation’s paths case-insensitively on Windows', () => {
        const appData = path.join(root, 'Roaming');
        const file = path.join(appData, 'Claude', 'claude_desktop_config.json');
        const command = 'C:\\Users\\Me\\AppData\\Local\\Programs\\sea-mail\\node\\node.exe';
        seed(file, JSON.stringify({ mcpServers: { 'sea-mail': { command: command.toLowerCase(), args: ['C:\\APP\\index.js', 'serve'] } } }));
        connect(['--remove'], {
          platform: 'win32',
          env: { APPDATA: appData, LOCALAPPDATA: path.join(root, 'Local') },
          server: { command, args: ['C:\\app\\index.js', 'serve'] },
        });
        expect(readJson(file)).toEqual({ mcpServers: {} });
      });
    });
  });
});
