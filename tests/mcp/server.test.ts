import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MailCore } from '../../src/core/mail-core.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { createTestCore } from '../helpers/core.js';

async function connect(core: MailCore): Promise<Client> {
  const server = createMcpServer(core, '0.0.0-test');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
}

describe('MCP server', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes six tools with accurate read-only hints', async () => {
    const client = await connect(createTestCore().core);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_draft', 'get_email', 'get_thread', 'list_recent', 'search_emails', 'sync_mailbox']);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(tool.name !== 'create_draft' && tool.name !== 'sync_mailbox');
  });

  it('sends safety instructions', async () => {
    const client = await connect(createTestCore().core);
    expect(client.getInstructions()).toContain('untrusted');
    expect(client.getInstructions()).toContain('cannot send');
  });

  it('searches and reads a thread', async () => {
    const client = await connect(createTestCore().core);
    const search = JSON.parse(textOf(await client.callTool({ name: 'search_emails', arguments: { query: 'bao gia' } })));
    expect(search.total).toBe(2);
    const thread = JSON.parse(textOf(await client.callTool({ name: 'get_thread', arguments: { id: 'k2' } })));
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual(['Gửi anh báo giá.', 'Đồng ý.']);
  });

  it('creates a draft', async () => {
    const { core, appended } = createTestCore();
    const client = await connect(core);
    const result = JSON.parse(textOf(await client.callTool({ name: 'create_draft', arguments: { body: 'Cảm ơn.', replyToId: 'k1' } })));
    expect(result.draftFolder).toBe('Drafts');
    expect(appended).toHaveLength(1);
  });

  it('runs a forced sync', async () => {
    const { core, sync } = createTestCore();
    const client = await connect(core);
    await client.callTool({ name: 'sync_mailbox', arguments: {} });
    expect(sync).toHaveBeenCalledOnce();
  });

  it('reports domain errors and invalid input as tool errors', async () => {
    const client = await connect(createTestCore().core);
    const missing = await client.callTool({ name: 'get_email', arguments: { id: 'nope' } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/^NOT_FOUND: /);
    const invalid = await client.callTool({ name: 'search_emails', arguments: { query: 'x', limit: 500 } });
    expect(invalid.isError).toBe(true);
  });

  it('logs unexpected errors to stderr and keeps the tool error terse', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const core = {
      search: async () => {
        throw new TypeError('boom');
      },
    } as unknown as MailCore;
    const result = await (await connect(core)).callTool({ name: 'search_emails', arguments: { query: 'x' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Unexpected error: boom');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unexpected tool error: TypeError: boom'));
  });

  it('does not log domain errors as unexpected', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await (await connect(createTestCore().core)).callTool({ name: 'get_email', arguments: { id: 'nope' } });
    expect(stderr).not.toHaveBeenCalled();
  });
});
