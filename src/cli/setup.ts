import { confirm, input, password, select } from '@inquirer/prompts';
import { configPath, keychainAccount, loadConfig, saveConfig, type AppConfig, type PasswordStore } from '../core/config.js';
import { ImapSession, type RemoteFolder } from '../core/imap/client.js';
import { runSync } from './sync.js';

const required = (value: string): boolean | string => value.trim() !== '' || 'Required';

export async function runSetup(home: string, passwords: PasswordStore): Promise<void> {
  let existing: AppConfig | undefined;
  try {
    existing = loadConfig(home);
  } catch {
    existing = undefined;
  }

  const host = await input({ message: 'IMAP server host', default: existing?.imap.host, validate: required });
  const secure = await confirm({ message: 'Use TLS (usually port 993)?', default: existing?.imap.secure ?? true });
  const port = Number(
    await input({
      message: 'IMAP port',
      default: String(existing?.imap.port ?? (secure ? 993 : 143)),
      validate: (v) => /^\d+$/.test(v.trim()) || 'Enter a port number',
    }),
  );
  const user = await input({ message: 'IMAP username', default: existing?.imap.user, validate: required });
  const pass = await password({ message: 'IMAP password (stored in the OS keychain)', mask: '*' });
  const email = await input({
    message: 'Your email address',
    default: existing?.identity.email ?? (user.includes('@') ? user : undefined),
    validate: required,
  });
  const name = await input({ message: 'Your display name', default: existing?.identity.name, validate: required });

  process.stderr.write('Connecting…\n');
  const session = await ImapSession.open({ host, port, secure, user, password: pass });
  let folders: RemoteFolder[];
  try {
    folders = await session.listFolders();
  } finally {
    await session.close();
  }

  const configured = existing?.drafts.folder ?? null;
  const detected = folders.find((f) => f.specialUse === '\\Drafts')?.path ?? null;
  // A detected Drafts folder never overrides one set by hand; when none is detected the user's pick is saved.
  const savedDraftsFolder = detected
    ? (configured ?? detected)
    : await select({
        message: 'Which folder holds your drafts?',
        choices: folders.map((f) => ({ name: f.path, value: f.path })),
        default: configured ?? undefined,
      });
  const config: AppConfig = {
    imap: { host, port, secure, user },
    identity: { name, email },
    sync: existing?.sync ?? { excludeFolders: [], staleAfterMinutes: 5 },
    drafts: { folder: savedDraftsFolder, signature: existing?.drafts.signature ?? null },
  };
  passwords.set(keychainAccount(config), pass);
  saveConfig(home, config);
  process.stderr.write(`Saved ${configPath(home)} (drafts folder: ${savedDraftsFolder}). Running the first sync…\n`);
  await runSync(home, passwords);
}
