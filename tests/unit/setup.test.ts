import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSetup } from '../../src/cli/setup.js';
import { loadConfig, saveConfig, type AppConfig } from '../../src/core/config.js';
import type { RemoteFolder } from '../../src/core/imap/client.js';
import { TEST_CONFIG } from '../helpers/core.js';
import { memoryPasswordStore } from '../helpers/passwords.js';

interface PromptConfig {
  message: string;
  default?: unknown;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
}

const h = vi.hoisted(() => ({
  /** Scripted answers per prompt, matched against the prompt message; an exhausted script accepts the default. */
  script: [] as Array<[RegExp, unknown[]]>,
  rejections: [] as Array<{ message: string; answer: unknown; verdict: string | boolean }>,
  folders: [] as RemoteFolder[],
}));

/** Answers like an inquirer prompt: a value the validator refuses is recorded and the user is asked again. */
async function ask(config: PromptConfig): Promise<unknown> {
  const queue = h.script.find(([pattern]) => pattern.test(config.message))?.[1] ?? [];
  for (;;) {
    const answer = queue.length > 0 ? queue.shift() : config.default;
    if (answer === undefined) throw new Error(`No answer for prompt: ${config.message}`);
    const verdict = config.validate ? await config.validate(String(answer)) : true;
    if (verdict === true) return answer;
    h.rejections.push({ message: config.message, answer, verdict });
  }
}

vi.mock('@inquirer/prompts', () => ({ input: ask, confirm: ask, password: ask, select: ask }));
vi.mock('../../src/core/imap/client.js', () => ({
  ImapSession: { open: async () => ({ listFolders: async () => h.folders, close: async () => {} }) },
}));
vi.mock('../../src/cli/sync.js', () => ({ runSync: async () => {} }));

const ANSWERS: Array<[RegExp, unknown[]]> = [
  [/host/i, ['imap.example.test']],
  [/TLS/, [true]],
  [/^IMAP port/, ['993']],
  [/username/i, ['me']],
  [/password/i, ['secret']],
  [/email/i, ['me@example.test']],
  [/display name/i, ['Me']],
];

describe('runSetup', () => {
  let home: string;

  const withAnswers = (overrides: Array<[RegExp, unknown[]]>) => {
    h.script = [...overrides, ...ANSWERS].map(([pattern, answers]) => [pattern, [...answers]]);
  };
  const existing = (drafts: Partial<AppConfig['drafts']>) => saveConfig(home, { ...TEST_CONFIG, drafts: { ...TEST_CONFIG.drafts, ...drafts } });

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-mail-setup-'));
    h.rejections = [];
    h.folders = [
      { path: 'INBOX', specialUse: '\\Inbox' },
      { path: 'Drafts', specialUse: '\\Drafts' },
      { path: 'INBOX.Nháp', specialUse: null },
      { path: 'Archive', specialUse: null },
    ];
    withAnswers([]);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe('the drafts folder', () => {
    const undetected = () => {
      h.folders = h.folders.filter((f) => f.specialUse !== '\\Drafts');
    };

    it('offers the configured folder as the default when no Drafts folder is detected', async () => {
      existing({ folder: 'INBOX.Nháp' });
      undetected();
      await runSetup(home, memoryPasswordStore());
      expect(loadConfig(home).drafts.folder).toBe('INBOX.Nháp');
    });

    it('saves the folder the user picks instead of the configured one', async () => {
      existing({ folder: 'INBOX.Nháp' });
      undetected();
      withAnswers([[/drafts/i, ['Archive']]]);
      await runSetup(home, memoryPasswordStore());
      expect(loadConfig(home).drafts.folder).toBe('Archive');
    });

    it('keeps a configured folder when a Drafts folder is detected', async () => {
      existing({ folder: 'INBOX.Nháp' });
      await runSetup(home, memoryPasswordStore());
      expect(loadConfig(home).drafts.folder).toBe('INBOX.Nháp');
    });

    it('saves the detected Drafts folder on a first setup', async () => {
      await runSetup(home, memoryPasswordStore());
      expect(loadConfig(home).drafts.folder).toBe('Drafts');
    });
  });
});
