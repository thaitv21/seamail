# sea-mail

An AI assistant for an IMAP mailbox that works alongside Outlook. `sea-mail` keeps a local, searchable
copy of your mail and exposes it to Codex or Claude through MCP. You can then ask them to find emails,
summarize threads, answer questions across many emails, and draft replies. Drafts land in your Drafts
folder, and **you** review and send them from Outlook. sea-mail itself cannot send, delete, or move email.

## Why not an Outlook add-in?

Outlook add-ins don't run with IMAP/POP accounts (in new Outlook, classic Outlook, or Outlook for Mac),
and VSTO add-ins only run in classic Outlook for Windows. So sea-mail talks to the IMAP server directly.

## Install

Requires Node.js 22 or newer. From a checkout of this repository:

```bash
npm install
npm run build
npm link            # puts `sea-mail` on your PATH
```

## Set up

```bash
sea-mail setup
```

This asks for your IMAP server, username, and password, plus the name and address to use on drafts.
The password goes into the macOS Keychain (or Windows Credential Manager), never into a file. Setup
then downloads your mail into `~/.sea-mail/mail.db`, which takes a few minutes for ~10,000 emails.

Settings live in `~/.sea-mail/config.json`. Optional fields you can edit by hand:

| Field | Default | Meaning |
|---|---|---|
| `drafts.signature` | `null` | Text appended to every draft before the quoted original |
| `sync.excludeFolders` | `[]` | Folder paths not to index (Trash and Junk are always skipped) |
| `sync.staleAfterMinutes` | `5` | Refresh from the server before answering if the index is older than this |

## Connect Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.sea-mail]
command = "sea-mail"
args = ["serve"]
```

GUI apps (Codex app, Claude Desktop) may not see your shell's PATH. If the server doesn't start, use
absolute paths from `which node` and `which sea-mail`:

```toml
[mcp_servers.sea-mail]
command = "/Users/you/.nvm/versions/node/v22.22.0/bin/node"
args = ["/Users/you/.nvm/versions/node/v22.22.0/bin/sea-mail", "serve"]
```

## Connect Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sea-mail": { "command": "/absolute/path/to/node", "args": ["/absolute/path/to/sea-mail", "serve"] }
  }
}
```

## Things to ask

- "Find the email where Anh A sent the server quotation in August."
- "Summarize the thread about the Q4 contract."
- "What came in since yesterday that needs a reply from me?"
- "Draft a reply to that email agreeing to the new delivery date." The draft then appears in Outlook → Drafts.
- "What has been agreed with customer X so far? Cite the emails."

## Safety

- Email content is treated as untrusted. sea-mail has no send, delete, or move tool, so the worst that
  a malicious email can achieve through it is a bad draft, which you will see before sending.
- Your MCP client may have other powerful tools, such as shell or web access. Keep its approval prompts on for them.
- `~/.sea-mail/mail.db` contains your mail in plain text with file mode 600. Keep disk encryption
  (FileVault/BitLocker) on.

## Troubleshooting

| Message | Fix |
|---|---|
| `NOT_CONFIGURED` | Run `sea-mail setup` |
| `AUTH_FAILED` | Password changed or missing; run `sea-mail setup` again |
| `EMPTY_INDEX` | Run `sea-mail sync` |
| Results marked `"stale": true` | The server was unreachable; answers come from the last sync |

`sea-mail search "bao gia" --after 2026-08-01` checks the index without an AI client. Server logs go to stderr.

## Development

```bash
npm run typecheck
npm test                    # unit, MCP and CLI end-to-end tests
npm run test:integration    # needs Docker: starts GreenMail on port 3143 (override with GREENMAIL_IMAP_PORT)
```
