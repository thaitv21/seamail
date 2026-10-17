import { dbPath, keychainAccount, keychainPasswordStore, loadConfig, type AppConfig, type PasswordStore } from '../core/config.js';
import { MailError } from '../core/errors.js';
import { ImapSession } from '../core/imap/client.js';
import { MailCore } from '../core/mail-core.js';
import { openDb } from '../core/store/db.js';
import { Repo } from '../core/store/repo.js';
import { Syncer } from '../core/sync/syncer.js';

export interface AppContext {
  home: string;
  config: AppConfig;
  repo: Repo;
  syncer: Syncer;
  core: MailCore;
  close(): void;
}

/** Reads the password lazily, so commands that don't touch IMAP never hit the keychain. */
export function openSessionFor(config: AppConfig, passwords: PasswordStore): () => Promise<ImapSession> {
  return async () => {
    const password = passwords.get(keychainAccount(config));
    if (!password) throw new MailError('AUTH_FAILED', 'No IMAP password in the keychain — run `sea-mail setup`');
    return ImapSession.open({ ...config.imap, password });
  };
}

export function createContext(
  home: string,
  passwords: PasswordStore = keychainPasswordStore,
  onProgress?: (folder: string, done: number, total: number) => void,
): AppContext {
  const config = loadConfig(home);
  const db = openDb(dbPath(home));
  const repo = new Repo(db);
  const openSession = openSessionFor(config, passwords);
  const syncer = new Syncer({ repo, openSession, excludeFolders: config.sync.excludeFolders, onProgress });
  const core = new MailCore({ repo, syncer, openSession, config });
  return { home, config, repo, syncer, core, close: () => db.close() };
}
