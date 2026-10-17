import { describe, expect, it } from 'vitest';
import { ImapSession } from '../../src/core/imap/client.js';
import { MailCore } from '../../src/core/mail-core.js';
import { openDb } from '../../src/core/store/db.js';
import { Repo } from '../../src/core/store/repo.js';
import { Syncer } from '../../src/core/sync/syncer.js';
import { TEST_CONFIG } from '../helpers/core.js';
import { appendMail, connectRaw, newUser, serverFlags, settingsFor } from './greenmail.js';

describe('createDraft against GreenMail', () => {
  it('appends a threaded reply draft that the next sync indexes into the thread', async () => {
    const user = newUser();
    const raw = await connectRaw(user);
    await raw.mailboxCreate('Drafts');
    await appendMail(raw, 'INBOX', { messageId: '<q1@example.test>', subject: 'Báo giá server', text: 'Gửi anh báo giá.' });

    const repo = new Repo(openDb(':memory:'));
    const openSession = () => ImapSession.open(settingsFor(user));
    const syncer = new Syncer({ repo, openSession, excludeFolders: [] });
    const core = new MailCore({ repo, syncer, openSession, config: { ...TEST_CONFIG, identity: { name: 'Me', email: user } } });
    await core.sync();

    const [hit] = (await core.search({ query: 'bao gia' })).results;
    const draft = await core.createDraft({ body: 'Đồng ý.', replyToId: hit!.id });
    const [flags] = [...(await serverFlags(raw, 'Drafts')).values()];
    expect(flags).toEqual(expect.arrayContaining(['\\Draft', '\\Seen']));

    await core.sync();
    const thread = await core.getThread({ id: hit!.id });
    expect(thread.messages.map((m) => m.folder)).toEqual(['INBOX', 'Drafts']);
    expect(thread.messages[1]?.subject).toBe(draft.subject);
    await raw.logout();
  });
});
