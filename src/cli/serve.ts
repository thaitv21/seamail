import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { PasswordStore } from '../core/config.js';
import { log } from '../core/log.js';
import { createMcpServer } from '../mcp/server.js';
import { createContext } from './context.js';

export async function runServe(home: string, passwords: PasswordStore, version: string): Promise<void> {
  const ctx = createContext(home, passwords);
  const server = createMcpServer(ctx.core, version);
  await server.connect(new StdioServerTransport());
  log(`MCP server ready (home: ${home})`);
}
