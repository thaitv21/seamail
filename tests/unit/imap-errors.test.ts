import { describe, expect, it } from 'vitest';
import { MailError } from '../../src/core/errors.js';
import { mapImapError } from '../../src/core/imap/client.js';

describe('mapImapError', () => {
  it('maps imapflow authentication failures', () => {
    expect(mapImapError(Object.assign(new Error('Command failed'), { authenticationFailed: true }))).toMatchObject({ code: 'AUTH_FAILED' });
  });
  it('maps network errors', () => {
    expect(mapImapError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toMatchObject({ code: 'IMAP_UNAVAILABLE' });
  });
  it.each([
    'CONNECT_TIMEOUT',
    'GREETING_TIMEOUT',
    'EConnectionClosed',
    'ClosedAfterConnectText',
    'ClosedAfterConnectTLS',
    'NoConnection',
    'EPIPE',
    'ECONNABORTED',
  ])('maps the %s code to IMAP_UNAVAILABLE', (code) => {
    expect(mapImapError(Object.assign(new Error('x'), { code }))).toMatchObject({ code: 'IMAP_UNAVAILABLE' });
  });
  it('passes other errors through', () => {
    const plain = new Error('x');
    const mail = new MailError('NOT_FOUND', 'y');
    expect(mapImapError(plain)).toBe(plain);
    expect(mapImapError(mail)).toBe(mail);
  });
});
