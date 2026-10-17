export interface Address {
  name: string;
  address: string;
}

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
}

/** A message parsed from IMAP, ready to be stored. */
export interface NewMessage {
  uid: number;
  msgKey: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  threadId: string;
  /** ISO 8601, UTC. */
  date: string;
  subject: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  flags: string[];
  bodyText: string;
  attachments: AttachmentMeta[];
  parseError: boolean;
}

/** A message read back from the local store. */
export interface StoredMessage extends NewMessage {
  id: number;
  folderId: number;
  folderPath: string;
}

export interface EmailSummary {
  /** Stable public id (msg_key). */
  id: string;
  threadId: string;
  date: string;
  from: Address;
  to: Address[];
  subject: string;
  snippet: string;
  folder: string;
  hasAttachments: boolean;
  unread: boolean;
}

export interface EmailFull extends EmailSummary {
  cc: Address[];
  replyTo: Address[];
  body: string;
  attachments: AttachmentMeta[];
  truncated: boolean;
}

export interface SearchParams {
  query?: string;
  from?: string;
  to?: string;
  folder?: string;
  after?: string;
  before?: string;
  hasAttachment?: boolean;
  limit?: number;
}

export interface ListRecentParams {
  folder?: string;
  since?: string;
  unreadOnly?: boolean;
  limit?: number;
}

export interface ThreadParams {
  id?: string;
  threadId?: string;
  includeQuoted?: boolean;
  maxCharsPerMessage?: number;
}

export interface DraftInput {
  to?: string[];
  cc?: string[];
  subject?: string;
  body: string;
  replyToId?: string;
  replyAll?: boolean;
}

export interface DraftResult {
  draftFolder: string;
  to: string[];
  cc: string[];
  subject: string;
  messageId: string;
}

export interface SyncResult {
  newMessages: number;
  updatedFlags: number;
  deleted: number;
  durationMs: number;
  lastSyncedAt: string;
  /** Folders skipped because they could not be synced (the rest of the mailbox was still synced). */
  failedFolders: string[];
}

export interface Freshness {
  lastSyncedAt: string | null;
  stale?: true;
}
