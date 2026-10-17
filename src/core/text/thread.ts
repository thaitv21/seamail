import { createHash } from 'node:crypto';

const MESSAGE_ID = /<[^<>\s]+>/g;

/** Extracts `<id>` tokens from a References / In-Reply-To value or a raw header block. */
export function parseMessageIds(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const text = Array.isArray(value) ? value.join(' ') : value;
  return text.match(MESSAGE_ID) ?? [];
}

export function normalizeMessageId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`;
}

/** Stable public id: the same message in several folders gets the same key. */
export function makeMsgKey(messageId: string | null, folderPath: string, uidValidity: number, uid: number): string {
  const basis = messageId ?? `${folderPath}|${uidValidity}|${uid}`;
  return createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

export function deriveThreadId(m: {
  references: string[];
  inReplyTo: string | null;
  messageId: string | null;
  msgKey: string;
}): string {
  return m.references[0] ?? m.inReplyTo ?? m.messageId ?? m.msgKey;
}
