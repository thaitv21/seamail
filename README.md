# sea-mail

An AI assistant for an IMAP mailbox that works alongside Outlook. `sea-mail` keeps a local, searchable
copy of your mail and exposes it to Codex or Claude through MCP. You can then ask them to find emails,
summarize threads, answer questions across many emails, and draft replies. Drafts land in your Drafts
folder, and **you** review and send them from Outlook. sea-mail itself cannot send, delete, or move email.

## Why not an Outlook add-in?

Outlook add-ins don't run with IMAP/POP accounts (in new Outlook, classic Outlook, or Outlook for Mac),
and VSTO add-ins only run in classic Outlook for Windows. So sea-mail talks to the IMAP server directly.

## Install

On Windows without developer tools, use the installer: see [Windows (no developer tools)](#windows-no-developer-tools).

Otherwise this requires Node.js 22 or newer. From a checkout of this repository:

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
| `drafts.folder` | set by `sea-mail setup` | Folder where drafts are saved |
| `drafts.signature` | `null` | Text appended to every draft before the quoted original |
| `sync.excludeFolders` | `[]` | Folder paths not to index (Trash and Junk are always skipped) |
| `sync.staleAfterMinutes` | `5` | Refresh from the server before answering if the index is older than this |

## Connect Codex or Claude Desktop

```bash
sea-mail connect --client codex     # adds [mcp_servers.sea-mail] to ~/.codex/config.toml
sea-mail connect --client claude    # adds mcpServers["sea-mail"] to claude_desktop_config.json
```

`connect` registers the sea-mail you ran it from, by absolute paths to its Node.js and its CLI, so GUI
apps that don't see your shell's PATH still find it. It prints the file it changed and what it wrote,
then you restart Codex, or quit Claude Desktop completely and reopen it. It is safe to run again: it
only rewrites the `command` and `args` of the sea-mail entry, keeps everything else in the file as it
was, and refuses to write a file it cannot parse. Run it again after you upgrade Node.js or move the
checkout. `--remove` takes the entry out again, but only when it runs this same sea-mail.

| Client | File |
|---|---|
| Codex | `~/.codex/config.toml` (`$CODEX_HOME/config.toml` when set; `%USERPROFILE%\.codex\config.toml` on Windows) |
| Claude Desktop, macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop, Windows | `%APPDATA%\Claude\claude_desktop_config.json`, and for the Microsoft Store build also `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude\claude_desktop_config.json` |

To edit the files by hand instead, use absolute paths from `which node` and `which sea-mail`:

```toml
[mcp_servers.sea-mail]
command = "/Users/you/.nvm/versions/node/v22.22.0/bin/node"
args = ["/Users/you/.nvm/versions/node/v22.22.0/bin/sea-mail", "serve"]
```

```json
{
  "mcpServers": {
    "sea-mail": { "command": "/absolute/path/to/node", "args": ["/absolute/path/to/sea-mail", "serve"] }
  }
}
```

## Windows (no developer tools)

The installer brings its own copy of Node.js, so there is nothing else to install and no terminal to use.

1. **Download** `sea-mail-setup-<version>.exe` from the
   [Releases page](https://github.com/thaitv21/seamail/releases) and double-click it.
2. **Windows protected your PC.** The installer is not code-signed, so SmartScreen warns about it.
   Click **More info**, check that the file name is `sea-mail-setup-<version>.exe`, then click **Run anyway**.
   It installs for your Windows account only (into `%LOCALAPPDATA%\Programs\sea-mail`) and needs no
   administrator rights.
3. **Finish page.** Leave **Set up sea-mail now** ticked, and tick **Connect Claude Desktop** and/or
   **Connect Codex** for the apps you use (they are ticked already when the app is found). Click **Finish**.
   Each connect step opens a small window that says which file it changed; press any key to close it.
4. **Set up.** A console window asks for your IMAP server, username and password, plus the name and
   address to put on drafts (your mail administrator or Outlook's account settings have the server
   details). The password goes into Windows Credential Manager. sea-mail then downloads your mail, which
   takes a few minutes; press any key to close the window when it is done.
5. **Restart Claude Desktop or Codex.** Quit Claude Desktop completely (right-click its icon by the clock →
   Quit) and open it again, or restart Codex. Then try one of the [things to ask](#things-to-ask).

Later on, the Start menu has a **sea-mail** folder with:

- **Set up sea-mail**: change the account or password (it runs the same questions again).
- **Sync mail now**: fetch new mail right away. You rarely need it: when you ask Claude or Codex and
  sea-mail's copy is more than five minutes old, it fetches new mail first.
- **Uninstall sea-mail**.

The installer also puts `sea-mail` on your PATH, so a new Command Prompt can run `sea-mail search …` or
`sea-mail connect --client codex`. To upgrade, run a newer installer; your settings and mail are kept.

**Uninstall** from Start → sea-mail → Uninstall sea-mail, or Settings → Apps → Installed apps →
sea-mail → Uninstall. Quit Claude Desktop and Codex first. The uninstaller removes the program, its
PATH entry, and the sea-mail entries it added to Claude Desktop and Codex. It then asks whether to
delete your settings and local copy of your mail in `%USERPROFILE%\.sea-mail` too (the default is to
keep them). Your mailbox on the server is never touched. The IMAP password stays in Windows Credential
Manager; to remove it, open Credential Manager → Windows Credentials and remove the entry whose name
contains `sea-mail`.

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
| `NO_DRAFTS_FOLDER` | Set `drafts.folder` in `~/.sea-mail/config.json` to the path of your Drafts folder (for example `"Drafts"`). |
| Results marked `"stale": true` | The server was unreachable; answers come from the last sync |
| Windows: `'sea-mail' is not recognized` | Open a new Command Prompt: the installer's PATH change only reaches windows opened after it |
| Claude Desktop or Codex doesn't list sea-mail's tools | Run `sea-mail connect --client claude` (or `codex`) again, read which file it changed, and fully restart the app |

`sea-mail search "bao gia" --after 2026-08-01` checks the index without an AI client. Server logs go to stderr.
Run a command with `DEBUG=1` to see the stack trace of an unexpected error.

## Development

```bash
npm run typecheck
npm test                    # unit, MCP and CLI end-to-end tests
npm run test:integration    # needs Docker: starts GreenMail on port 3143 (override with GREENMAIL_IMAP_PORT)
```

The Windows installer is built by the **Windows installer** workflow
(`.github/workflows/windows-installer.yml`) on every `v*` tag, which also attaches it to that tag's
GitHub Release, and on demand from the Actions tab. The tag must match the `version` in package.json.
To build it on a Windows x64 machine with Node 22 and [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```bash
node scripts/package-windows.mjs            # build/windows/sea-mail: bundled Node.js, app, bin\sea-mail.cmd
npm run test:package                        # smoke-tests that folder with its own node.exe
iscc /DAppVersion=0.1.0 installer\sea-mail.iss   # build/windows/sea-mail-setup-0.1.0.exe
```
