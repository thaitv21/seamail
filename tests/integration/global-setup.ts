import { ImapFlow } from 'imapflow';
import { GREENMAIL } from './greenmail.js';

/** Waits until GreenMail answers IMAP logins (the container takes a few seconds to start). */
export default async function setup(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new ImapFlow({ ...GREENMAIL, secure: false, auth: { user: 'probe@example.test', pass: 'x' }, logger: false });
    client.on('error', () => {});
    try {
      await client.connect();
      await client.logout();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(
    `GreenMail is not reachable on ${GREENMAIL.host}:${GREENMAIL.port} (${String(lastError)}). ` +
      'Start it with: docker compose -f docker-compose.test.yml up -d',
  );
}
