import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MailError } from '../core/errors.js';
import type { MailCore } from '../core/mail-core.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export function createMcpServer(core: MailCore, version: string): McpServer {
  const server = new McpServer({ name: 'sea-mail', version }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    'search_emails',
    {
      description:
        'Keyword search over the whole mailbox, accent-insensitive ("bao gia" matches "báo giá"). Terms are ANDed; ' +
        'put OR between terms and "double quotes" around phrases. Returns summaries; use get_email or get_thread for full text.',
      inputSchema: {
        query: z.string().optional().describe('Keywords. Omit to list by date using only the filters.'),
        from: z.string().optional().describe('Part of the sender name or address'),
        to: z.string().optional().describe('Part of a To or Cc name or address'),
        folder: z.string().optional().describe('Folder path, e.g. INBOX'),
        after: z.string().optional().describe('ISO date/time, inclusive'),
        before: z.string().optional().describe('ISO date/time, exclusive'),
        hasAttachment: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
      },
      annotations: READ_ONLY,
    },
    async (args) => respond(() => core.search(args)),
  );

  server.registerTool(
    'get_email',
    {
      description: 'One email in full: headers, body text and attachment names.',
      inputSchema: {
        id: z.string().describe('The id from search_emails, list_recent or get_thread'),
        maxChars: z.number().int().min(500).max(50_000).optional().describe('Body length limit, default 8000'),
      },
      annotations: READ_ONLY,
    },
    async ({ id, maxChars }) => respond(() => core.getEmail(id, maxChars)),
  );

  server.registerTool(
    'get_thread',
    {
      description: 'All emails of a conversation, oldest first, with repeated quoted history removed.',
      inputSchema: {
        id: z.string().optional().describe('Id of any email in the thread'),
        threadId: z.string().optional(),
        includeQuoted: z.boolean().optional().describe('Keep quoted history (default false)'),
        maxCharsPerMessage: z.number().int().min(200).max(20_000).optional().describe('Default 4000'),
      },
      annotations: READ_ONLY,
    },
    async (args) => respond(() => core.getThread(args)),
  );

  server.registerTool(
    'list_recent',
    {
      description: 'Newest emails in a folder since a point in time. Use for "what came in today/since yesterday".',
      inputSchema: {
        folder: z.string().optional().describe('Default INBOX'),
        since: z.string().optional().describe('ISO date/time; default 24 hours ago'),
        unreadOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
      },
      annotations: READ_ONLY,
    },
    async (args) => respond(() => core.listRecent(args)),
  );

  server.registerTool(
    'sync_mailbox',
    {
      description: 'Fetch new mail from the server now (normally automatic every few minutes).',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => respond(() => core.sync()),
  );

  server.registerTool(
    'create_draft',
    {
      description:
        'Save a draft in the Drafts folder for the user to review and send from Outlook. Cannot send. ' +
        'For a reply pass replyToId; recipients, "Re:" subject, threading headers, signature and quote are filled in.',
      inputSchema: {
        to: z.array(z.string()).optional().describe('Recipient addresses; defaults to the original sender when replying'),
        cc: z.array(z.string()).optional(),
        subject: z.string().optional().describe('Defaults to "Re: <original subject>" when replying'),
        body: z.string().min(1).describe('Plain text; separate paragraphs with a blank line'),
        replyToId: z.string().optional().describe('id of the email being answered'),
        replyAll: z.boolean().optional().describe('Also include the original To and Cc'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => respond(() => core.createDraft(args)),
  );

  return server;
}

async function respond(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await fn(), null, 2) }] };
  } catch (err) {
    const text =
      err instanceof MailError
        ? `${err.code}: ${err.message}`
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    return { isError: true, content: [{ type: 'text', text }] };
  }
}
