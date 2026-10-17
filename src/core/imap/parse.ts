import type { MessageAddressObject, MessageEnvelopeObject, MessageStructureObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { log } from '../log.js';
import { chooseBodyText } from '../text/body.js';
import { deriveThreadId, makeMsgKey, normalizeMessageId, parseMessageIds } from '../text/thread.js';
import type { Address, AttachmentMeta, NewMessage } from '../types.js';

export interface RawMessage {
  uid: number;
  flags: string[];
  size: number;
  internalDate: Date | null;
  envelope: MessageEnvelopeObject | undefined;
  /** Raw "References:" header block (may be empty). */
  referencesHeader: string;
  bodyStructure: MessageStructureObject | undefined;
}

export type BodySource =
  | { kind: 'source'; source: Buffer }
  | { kind: 'part'; type: 'text/plain' | 'text/html'; content: string }
  | { kind: 'none' }
  | { kind: 'failed' };

type TextType = 'text/plain' | 'text/html';

export function pickTextPart(node: MessageStructureObject | undefined): { part: string; type: TextType } | null {
  for (const type of ['text/plain', 'text/html'] as const) {
    const part = findPart(node, type);
    if (part) return { part, type };
  }
  return null;
}

function findPart(node: MessageStructureObject | undefined, type: TextType): string | null {
  if (!node) return null;
  // An attached email carries a whole message of its own; its text is not this message's body.
  if (node.type === 'message/rfc822') return null;
  if (node.childNodes && node.childNodes.length > 0) {
    for (const child of node.childNodes) {
      const found = findPart(child, type);
      if (found) return found;
    }
    return null;
  }
  // A single-part message has no part number; its body is section 1.
  return node.type === type && node.disposition !== 'attachment' ? (node.part ?? '1') : null;
}

export function attachmentsFromStructure(node: MessageStructureObject | undefined): AttachmentMeta[] {
  if (!node) return [];
  const filename = (node.dispositionParameters?.filename ?? node.parameters?.name)?.normalize('NFC');
  // An attached email is a single attachment: its inner parts are not attachments of this message.
  if (node.type === 'message/rfc822') return [{ filename: filename ?? 'message.eml', mimeType: node.type, size: node.size ?? 0 }];
  if (node.childNodes && node.childNodes.length > 0) return node.childNodes.flatMap(attachmentsFromStructure);
  const isAttachment = node.disposition === 'attachment' || (!node.disposition && !!filename && !node.type.startsWith('text/'));
  return isAttachment ? [{ filename: filename ?? 'unnamed', mimeType: node.type, size: node.size ?? 0 }] : [];
}

export async function buildNewMessage(
  raw: RawMessage,
  body: BodySource,
  ctx: { folderPath: string; uidValidity: number },
): Promise<NewMessage> {
  const env: MessageEnvelopeObject = raw.envelope ?? {};
  const messageId = normalizeMessageId(env.messageId);
  const inReplyTo = parseMessageIds(env.inReplyTo)[0] ?? null;
  const references = parseMessageIds(raw.referencesHeader);
  const msgKey = makeMsgKey(messageId, ctx.folderPath, ctx.uidValidity, raw.uid);

  let bodyText = '';
  let parseError = body.kind === 'failed';
  try {
    if (body.kind === 'source') {
      // Skip mailparser's own HTML-to-text so an HTML-only message goes through htmlToPlainText below.
      const parsed = await simpleParser(body.source, { skipHtmlToText: true, skipImageLinks: true });
      bodyText = chooseBodyText(parsed.text, parsed.html || null);
    } else if (body.kind === 'part') {
      bodyText = body.type === 'text/plain' ? chooseBodyText(body.content, null) : chooseBodyText(null, body.content);
    }
  } catch (err) {
    log(`Could not parse UID ${raw.uid}: ${err instanceof Error ? err.message : String(err)}`);
    parseError = true;
  }

  return {
    uid: raw.uid,
    msgKey,
    messageId,
    inReplyTo,
    references,
    threadId: deriveThreadId({ references, inReplyTo, messageId, msgKey }),
    date: toIso(env.date) ?? toIso(raw.internalDate) ?? new Date(0).toISOString(),
    subject: (env.subject ?? '').normalize('NFC'),
    from: env.from?.[0] ? toAddress(env.from[0]) : null,
    to: (env.to ?? []).map(toAddress),
    cc: (env.cc ?? []).map(toAddress),
    replyTo: (env.replyTo ?? []).map(toAddress),
    flags: raw.flags,
    bodyText,
    attachments: attachmentsFromStructure(raw.bodyStructure),
    parseError,
  };
}

function toAddress(a: MessageAddressObject): Address {
  return { name: (a.name ?? '').normalize('NFC'), address: (a.address ?? '').toLowerCase() };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
