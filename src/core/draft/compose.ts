import { randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import { MailError } from '../errors.js';
import type { Address, DraftInput, StoredMessage } from '../types.js';

export interface DraftContext {
  identity: { name: string; email: string };
  signature: string | null;
  original: StoredMessage | null;
  now: Date;
  /** IANA zone for the "On <date>, <sender> wrote:" line; defaults to the system zone. */
  timeZone?: string;
}

export interface BuiltDraft {
  raw: Buffer;
  messageId: string;
  to: string[];
  cc: string[];
  subject: string;
}

export async function buildDraft(input: DraftInput, ctx: DraftContext): Promise<BuiltDraft> {
  const { original } = ctx;
  const self = ctx.identity.email.toLowerCase();

  let to: string[];
  let cc: string[];
  let subject: string;
  if (original) {
    to = unique(input.to?.length ? input.to : replyRecipients(original, self).map((a) => a.address));
    const everyone = input.replyAll ? [...original.to, ...original.cc].map((a) => a.address) : [];
    cc = unique([...(input.cc ?? []), ...everyone]).filter((a) => a !== self && !to.includes(a));
    subject = input.subject ?? reSubject(original.subject);
  } else {
    to = unique(input.to ?? []);
    cc = unique(input.cc ?? []);
    subject = input.subject ?? '';
    if (to.length === 0 || subject.trim() === '') {
      throw new MailError('INVALID_INPUT', 'A new draft needs at least one recipient in "to" and a subject');
    }
  }
  if (to.length === 0) throw new MailError('INVALID_INPUT', 'The draft has no recipients');

  const messageId = `<${randomUUID()}@${self.split('@')[1] ?? 'localhost'}>`;
  const quote = original ? quoteHeader(original, ctx) : null;

  const text = [input.body.trim()];
  const html = [paragraphs(input.body)];
  if (ctx.signature) {
    text.push(`-- \n${ctx.signature}`);
    html.push(`<p>-- <br>${escapeHtml(ctx.signature).replace(/\n/g, '<br>')}</p>`);
  }
  if (original && quote) {
    text.push(`${quote}\n${original.bodyText.split('\n').map((line) => `> ${line}`).join('\n')}`);
    html.push(
      `<p>${escapeHtml(quote)}</p>` +
        `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${paragraphs(original.bodyText)}</blockquote>`,
    );
  }

  const references = original ? [...original.references, ...(original.messageId ? [original.messageId] : [])] : [];
  const composer = new MailComposer({
    from: { name: ctx.identity.name, address: ctx.identity.email },
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    text: text.join('\n\n'),
    html: html.join('\n'),
    messageId,
    date: ctx.now,
    inReplyTo: original?.messageId ?? undefined,
    references: references.length > 0 ? references : undefined,
  });
  const raw = await composer.compile().build();
  return { raw, messageId, to, cc, subject };
}

/** Who a reply goes to by default: the original's recipients when the user sent it (Sent folder), else its sender. */
function replyRecipients(original: StoredMessage, self: string): Address[] {
  if (original.from?.address.toLowerCase() === self) return original.to;
  if (original.replyTo.length > 0) return original.replyTo;
  return original.from ? [original.from] : [];
}

function unique(addresses: string[]): string[] {
  return [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))];
}

function reSubject(subject: string): string {
  return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

function quoteHeader(original: StoredMessage, ctx: DraftContext): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ctx.timeZone,
  }).format(new Date(original.date));
  const from = original.from;
  const who = !from ? 'unknown sender' : from.name ? `${from.name} <${from.address}>` : from.address;
  return `On ${when}, ${who} wrote:`;
}

function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
