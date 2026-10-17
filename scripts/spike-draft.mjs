// M0 spike (spec §14): append a new draft and a reply draft to the real mailbox,
// then check them in Outlook for Mac. Run: npm run build && node scripts/spike-draft.mjs
import { ImapFlow } from 'imapflow';
import { input, password, select } from '@inquirer/prompts';
import { buildDraft } from '../dist/core/draft/compose.js';

const host = await input({ message: 'IMAP host' });
const port = Number(await input({ message: 'IMAP port', default: '993' }));
const user = await input({ message: 'IMAP username' });
const pass = await password({ message: 'IMAP password', mask: '*' });
const email = await input({ message: 'Your email address', default: user.includes('@') ? user : undefined });

const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false });
client.on('error', (err) => console.error('IMAP error:', err.message));
await client.connect();

const folders = await client.list();
const drafts = await select({
  message: 'Drafts folder',
  choices: folders.map((f) => ({ name: `${f.path} ${f.specialUse ?? ''}`, value: f.path })),
  default: folders.find((f) => f.specialUse === '\\Drafts')?.path,
});

const lock = await client.getMailboxLock('INBOX', { readOnly: true });
let last;
try {
  last = await client.fetchOne('*', { uid: true, envelope: true, headers: ['references'] });
} finally {
  lock.release();
}
if (!last) throw new Error('INBOX is empty; put one email in INBOX and retry');

const env = last.envelope ?? {};
const original = {
  id: 0, folderId: 0, folderPath: 'INBOX', uid: last.uid, msgKey: 'spike',
  messageId: env.messageId ?? null, inReplyTo: env.inReplyTo ?? null,
  references: (last.headers?.toString() ?? '').match(/<[^<>\s]+>/g) ?? [],
  threadId: env.messageId ?? 'spike', date: new Date(env.date ?? Date.now()).toISOString(),
  subject: env.subject ?? '', from: env.from?.[0] ? { name: env.from[0].name ?? '', address: env.from[0].address ?? '' } : null,
  to: [], cc: [], replyTo: [], flags: [], bodyText: '(original body not loaded by the spike)',
  attachments: [], parseError: false,
};
const identity = { name: 'sea-mail spike', email };
const ctx = { identity, signature: null, now: new Date() };

// Both drafts are addressed to you, so sending them is harmless.
const fresh = await buildDraft({ to: [email], subject: '[sea-mail spike] new draft', body: 'New draft created over IMAP.' }, { ...ctx, original: null });
const reply = await buildDraft({ to: [email], body: 'Reply draft created over IMAP.', replyToId: 'spike' }, { ...ctx, original });

await client.append(drafts, fresh.raw, ['\\Draft', '\\Seen']);
await client.append(drafts, reply.raw, ['\\Draft', '\\Seen']);
await client.logout();

console.log(`Appended to "${drafts}":\n  1. ${fresh.subject}\n  2. ${reply.subject} (reply to: ${original.subject})`);
console.log('Now check Outlook for Mac — see the checklist in the plan (Task 2, Step 3).');
