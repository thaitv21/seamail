import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailError } from '../../src/core/errors.js';
import { createTestCore, TEST_CONFIG, TEST_NOW } from '../helpers/core.js';

const STALE = '2026-10-17T09:00:00.000Z';

describe('MailCore freshness', () => {
  // The fallback path logs a diagnostic to stderr by design; keep the test output clean.
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to answer before the first sync', async () => {
    await expect(createTestCore({ lastSyncedAt: null }).core.search({ query: 'x' })).rejects.toMatchObject({ code: 'EMPTY_INDEX' });
  });

  it('does not sync while the index is fresh', async () => {
    const { core, sync } = createTestCore();
    const res = await core.search({ query: 'bao gia' });
    expect(sync).not.toHaveBeenCalled();
    expect(res.lastSyncedAt).toBe('2026-10-17T09:59:00.000Z');
    expect(res.stale).toBeUndefined();
  });

  it('syncs first when the index is stale', async () => {
    const { core, sync } = createTestCore({ lastSyncedAt: STALE });
    const res = await core.search({ query: 'bao gia' });
    expect(sync).toHaveBeenCalledOnce();
    expect(res.lastSyncedAt).toBe(TEST_NOW.toISOString());
  });

  it('answers from local data with stale: true when the sync fails', async () => {
    const { core } = createTestCore({
      lastSyncedAt: STALE,
      sync: async () => {
        throw new MailError('IMAP_UNAVAILABLE', 'down');
      },
    });
    expect(await core.search({ query: 'bao gia' })).toMatchObject({ stale: true, lastSyncedAt: STALE, total: 2 });
  });

  it('answers stale when the sync exceeds the timeout', async () => {
    const { core } = createTestCore({ lastSyncedAt: STALE, sync: () => new Promise(() => {}) });
    expect((await core.search({ query: 'bao gia' })).stale).toBe(true);
  });

  it('surfaces authentication failures', async () => {
    const { core } = createTestCore({
      lastSyncedAt: STALE,
      sync: async () => {
        throw new MailError('AUTH_FAILED', 'bad password');
      },
    });
    await expect(core.search({ query: 'x' })).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
});

describe('MailCore reads', () => {
  it('searches with accent-preserving snippets', async () => {
    const res = await createTestCore().core.search({ query: 'bao gia' });
    expect(res.total).toBe(2);
    expect(res.results.map((r) => r.id).sort()).toEqual(['k1', 'k2']);
    const first = res.results.find((r) => r.id === 'k1');
    expect(first).toMatchObject({ subject: 'Báo giá server', folder: 'INBOX', unread: false, hasAttachments: false });
    expect(first?.snippet).toContain('báo giá');
  });

  it('honours limit and rejects malformed dates', async () => {
    const { core } = createTestCore();
    expect((await core.search({ query: 'bao gia', limit: 1 })).results).toHaveLength(1);
    await expect(core.search({ after: 'last tuesday' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('gets one email, truncated, or reports an unknown id', async () => {
    const { core } = createTestCore();
    expect(await core.getEmail('k1', 5)).toMatchObject({ id: 'k1', body: 'Gửi a', truncated: true });
    await expect(core.getEmail('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns a thread with quotes stripped unless asked to keep them', async () => {
    const { core } = createTestCore();
    const stripped = await core.getThread({ id: 'k2' });
    expect(stripped.threadId).toBe('<a@x>');
    expect(stripped.messages.map((m) => m.body)).toEqual(['Gửi anh báo giá.', 'Đồng ý.']);
    const full = await core.getThread({ threadId: '<a@x>', includeQuoted: true });
    expect(full.messages[1]?.body).toContain('> Gửi anh báo giá.');
    await expect(core.getThread({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('lists recent INBOX mail, last 24 h by default', async () => {
    const { core } = createTestCore();
    expect((await core.listRecent({})).results.map((r) => r.id)).toEqual(['k2']);
    expect((await core.listRecent({ since: '2026-10-16T00:00:00Z' })).results.map((r) => r.id)).toEqual(['k2', 'k1']);
    expect((await core.listRecent({ since: '2026-10-16T00:00:00Z', unreadOnly: true })).results.map((r) => r.id)).toEqual(['k2']);
  });
});

describe('MailCore input validation', () => {
  it.each(['???', '-', '@'])('rejects a query with nothing searchable: %s', async (query) => {
    await expect(createTestCore().core.search({ query })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('lists by date when the query is missing or blank', async () => {
    const { core } = createTestCore();
    expect((await core.search({})).total).toBe(2);
    expect((await core.search({ query: '   ' })).total).toBe(2);
  });

  it.each(['2026-02-30', '2026-13-01', '1', 'last tuesday 5', '2026-08-01T25:00:00Z'])(
    'rejects the malformed date %s before syncing',
    async (value) => {
      const { core, sync } = createTestCore({ lastSyncedAt: STALE });
      await expect(core.search({ after: value })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(core.search({ before: value })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(core.listRecent({ since: value })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(sync).not.toHaveBeenCalled();
    },
  );

  it('accepts ISO-8601 dates, with or without a time and offset', async () => {
    const { core } = createTestCore();
    expect((await core.search({ after: '2026-08-01' })).total).toBe(2);
    expect((await core.search({ after: '2026-08-01T09:30:00Z' })).total).toBe(2);
    expect((await core.search({ after: '2026-08-01T09:30:00+07:00' })).total).toBe(2);
    expect((await core.search({ after: '2026-08-01T09:30' })).total).toBe(2);
    expect((await core.search({ after: '2026-08-01T09:30:00.250Z' })).total).toBe(2);
    // 2026-10-17T00:00+07:00 is 2026-10-16T17:00Z: only the reply (k2) is on or after it.
    expect((await core.search({ after: '2026-10-17T00:00:00+07:00' })).results.map((r) => r.id)).toEqual(['k2']);
  });
});

describe('MailCore.createDraft', () => {
  it('appends a reply to the detected Drafts folder', async () => {
    const { core, appended } = createTestCore();
    const res = await core.createDraft({ body: 'Cảm ơn anh.', replyToId: 'k1' });
    expect(res).toMatchObject({ draftFolder: 'Drafts', to: ['sender@example.test'], subject: 'Re: Báo giá server' });
    expect(appended).toHaveLength(1);
    expect(appended[0]?.path).toBe('Drafts');
    expect(appended[0]?.flags).toEqual(['\\Draft', '\\Seen']);
    expect(appended[0]?.raw.toString()).toContain('In-Reply-To: <a@x>');
  });

  it('prefers the configured Drafts folder', async () => {
    const { core } = createTestCore({ config: { ...TEST_CONFIG, drafts: { folder: 'INBOX.Drafts', signature: null } } });
    expect((await core.createDraft({ to: ['x@example.test'], subject: 'Hi', body: 'Hello' })).draftFolder).toBe('INBOX.Drafts');
  });

  it('fails clearly without a Drafts folder or with an unknown reply target', async () => {
    await expect(createTestCore({ withDraftsFolder: false }).core.createDraft({ to: ['x@example.test'], subject: 'Hi', body: 'x' })).rejects.toMatchObject({
      code: 'NO_DRAFTS_FOLDER',
      message: expect.stringContaining('set "drafts.folder" in ~/.sea-mail/config.json'),
    });
    await expect(createTestCore().core.createDraft({ body: 'x', replyToId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
