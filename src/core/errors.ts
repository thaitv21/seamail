export type MailErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'IMAP_UNAVAILABLE'
  | 'EMPTY_INDEX'
  | 'NOT_FOUND'
  | 'NO_DRAFTS_FOLDER'
  | 'INVALID_INPUT';

export class MailError extends Error {
  constructor(
    readonly code: MailErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MailError';
  }
}
