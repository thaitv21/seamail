import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Entry } from '@napi-rs/keyring';
import { z } from 'zod';
import { MailError } from './errors.js';

const ConfigSchema = z.object({
  imap: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    secure: z.boolean(),
    user: z.string().min(1),
  }),
  identity: z.object({
    name: z.string(),
    email: z.string().min(3),
  }),
  sync: z
    .object({
      excludeFolders: z.array(z.string()).default([]),
      staleAfterMinutes: z.number().positive().default(5),
    })
    .default({ excludeFolders: [], staleAfterMinutes: 5 }),
  drafts: z
    .object({
      folder: z.string().nullable().default(null),
      signature: z.string().nullable().default(null),
    })
    .default({ folder: null, signature: null }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SEA_MAIL_HOME ?? path.join(os.homedir(), '.sea-mail');
}

export function configPath(home: string): string {
  return path.join(home, 'config.json');
}

export function dbPath(home: string): string {
  return path.join(home, 'mail.db');
}

export function loadConfig(home: string): AppConfig {
  const file = configPath(home);
  if (!fs.existsSync(file)) {
    throw new MailError('NOT_CONFIGURED', 'sea-mail is not set up yet — run `sea-mail setup`');
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new MailError('NOT_CONFIGURED', `${file} is not valid JSON — run \`sea-mail setup\``);
  }
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new MailError('NOT_CONFIGURED', `Invalid ${file}: ${parsed.error.message} — run \`sea-mail setup\``);
  }
  return parsed.data;
}

export function saveConfig(home: string, config: AppConfig): void {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = configPath(home);
  fs.writeFileSync(file, `${JSON.stringify(ConfigSchema.parse(config), null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export interface PasswordStore {
  get(account: string): string | null;
  set(account: string, password: string): void;
}

const KEYCHAIN_SERVICE = 'sea-mail';

/** macOS Keychain / Windows Credential Manager / Secret Service, via @napi-rs/keyring. */
export const keychainPasswordStore: PasswordStore = {
  get: (account) => new Entry(KEYCHAIN_SERVICE, account).getPassword(),
  set: (account, password) => new Entry(KEYCHAIN_SERVICE, account).setPassword(password),
};

export function keychainAccount(config: Pick<AppConfig, 'imap'>): string {
  return `${config.imap.user}@${config.imap.host}`;
}
