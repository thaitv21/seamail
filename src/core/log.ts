/** All diagnostics go to stderr: stdout carries the MCP protocol. */
export function log(message: string): void {
  process.stderr.write(`[sea-mail] ${message}\n`);
}
