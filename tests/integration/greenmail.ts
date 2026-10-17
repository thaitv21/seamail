import { ImapFlow } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { ImapSettings } from '../../src/core/imap/client.js';

export const GREENMAIL = { host: '127.0.0.1', port: Number(process.env.GREENMAIL_IMAP_PORT ?? 3143) };

let seq = 0;

/** A fresh, empty mailbox for every test (GreenMail creates it on first login). */
export function newUser(): string {
  seq += 1;
  return `u${Date.now()}x${process.pid}x${seq}@example.test`;
}

export function settingsFor(user: string): ImapSettings {
  return { host: GREENMAIL.host, port: GREENMAIL.port, secure: false, user, password: 'any' };
}

export async function connectRaw(user: string): Promise<ImapFlow> {
  const client = new ImapFlow({ ...GREENMAIL, secure: false, auth: { user, pass: 'any' }, logger: false });
  client.on('error', () => {});
  await client.connect();
  return client;
}

export interface TestMail {
  messageId: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: Date;
  inReplyTo?: string;
  references?: string[];
  attachment?: { filename: string; content: Buffer };
}

export function composeRaw(mail: TestMail): Promise<Buffer> {
  return new MailComposer({
    from: mail.from ?? 'Anh A <a@example.test>',
    to: mail.to ?? 'Me <me@example.test>',
    cc: mail.cc,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    messageId: mail.messageId,
    date: mail.date ?? new Date('2026-10-01T08:00:00Z'),
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    attachments: mail.attachment ? [{ filename: mail.attachment.filename, content: mail.attachment.content }] : undefined,
  })
    .compile()
    .build();
}

export async function appendMail(client: ImapFlow, folder: string, mail: TestMail, flags: string[] = []): Promise<number> {
  const result = await client.append(folder, await composeRaw(mail), flags);
  if (!result || result.uid === undefined) throw new Error('APPEND returned no UID');
  return result.uid;
}

export async function serverFlags(client: ImapFlow, folder: string): Promise<Map<number, string[]>> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const messages = await client.fetchAll('1:*', { uid: true, flags: true }, { uid: true });
    return new Map(messages.map((m) => [m.uid, [...(m.flags ?? [])]] as [number, string[]]));
  } finally {
    lock.release();
  }
}
