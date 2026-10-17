import type { NewMessage } from '../../src/core/types.js';

let counter = 0;

export function newMessage(overrides: Partial<NewMessage> = {}): NewMessage {
  counter += 1;
  const messageId = overrides.messageId !== undefined ? overrides.messageId : `<m${counter}@example.test>`;
  return {
    uid: counter,
    msgKey: `key${counter}`,
    messageId,
    inReplyTo: null,
    references: [],
    threadId: messageId ?? `key${counter}`,
    date: '2026-10-01T00:00:00.000Z',
    subject: `Subject ${counter}`,
    from: { name: 'Sender', address: 'sender@example.test' },
    to: [{ name: 'Me', address: 'me@example.test' }],
    cc: [],
    replyTo: [],
    flags: [],
    bodyText: `Body ${counter}`,
    attachments: [],
    parseError: false,
    ...overrides,
  };
}
