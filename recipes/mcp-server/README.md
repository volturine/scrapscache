# Self-Hosted MCP Server for Scraps Cache

A lightweight, private Model Context Protocol (MCP) server recipe for **Scraps Cache**.

Connect AI assistants (**Claude Desktop**, **Claude Web**, **ChatGPT**, **Grok**, **Hermes Agent**, **Perplexity**, **Cursor**, **Windsurf**, and **Cline**) directly to your encrypted personal notes vault.

---

## Architecture & Privacy Model

Scraps Cache is end-to-end encrypted and zero-knowledge. This MCP server acts as an authenticated zero-knowledge client:

```
┌─────────────────┐       MCP (HTTP / SSE)        ┌─────────────────────────┐
│ AI Client       │ ────────────────────────────> │ Self-Hosted MCP Server  │
│ (Claude,        │   Authorization: Bearer       │ (Docker or CF Worker)   │
│  ChatGPT, etc.) │   or OAuth 2.1 (PKCE S256)    └────────────┬────────────┘
└─────────────────┘                                            │
                                               E2E Encrypted   │ /api/sync/delta
                                               Sync Protocol   │ (ChaCha20-Poly1305)
                                                               v
                                                  ┌─────────────────────────┐
                                                  │ Scraps Cache Server     │
                                                  │ (Self-hosted or Public) │
                                                  │ (e.g. scrapscache.com)  │
                                                  └─────────────────────────┘
```

- **Zero-Knowledge**: Notes are decrypted only in bounded, idle-expiring MCP session memory using ChaCha20-Poly1305. The upstream server only ever sees encrypted envelopes.
- **Zero-Token 1-Click Handshake**: When connecting through OAuth (Claude Web, ChatGPT, Grok), the user is seamlessly redirected to Scraps Cache where they are already logged in, clicks **"Allow access"**, and an ephemeral X25519 ECDH + XChaCha20-Poly1305 handshake securely delivers the sync key without typing or exposing secrets in URLs or logs.
- **Flexible Hosting**: Deploy via **Docker Compose** on your home server/VPS, or as a **Cloudflare Worker** on Cloudflare's free tier.
- **For You and Your Friends**: Host a single vault for yourself, or share the same server with friends who connect to their own vaults via 1-click OAuth or dedicated bearer tokens.

---

## MCP Tools Provided

| Tool              | Parameters                                                                                                                                                                                                                    | Description                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_notes`    | `query?: string`, `label?: string`, `pinnedOnly?: boolean`, `limit?: number`                                                                                                                                                  | Find notes by keyword, label, or pinned state. Returns IDs and previews around matching text; use `open_note` for the full note.                  |
| `list_notes`      | `limit?: number`                                                                                                                                                                                                              | List recently modified notes with IDs and previews.                                                                                               |
| `list_workspaces` | _(none)_                                                                                                                                                                                                                      | List the workspaces granted to this connection.                                                                                                   |
| `open_note`       | `id: string`                                                                                                                                                                                                                  | Fetch full note contents, including body text, checklist items with completion states, and labels.                                                |
| `create_note`     | `title?: string`, `body?: string`, `checklist?: string[]`, `labels?: string[]`, `pinned?: boolean`, `color?: string`                                                                                                          | Create a new note with optional checklist tasks, tags, and pin status.                                                                            |
| `update_note`     | `id: string`, `title?: string`, `body?: string`, `appendBody?: string`, `appendChecklistItems?: string[]`, `toggleChecklistItems?: string[]`, `labels?: string[]`, `color?: string`, `pinned?: boolean`, `archived?: boolean` | Update an existing note by ID. Supports replacing full body text, updating title/labels/color, appending text/tasks, or toggling checklist items. |
| `list_labels`     | _(none)_                                                                                                                                                                                                                      | List all tags/labels currently present in your note vault.                                                                                        |

Use `search_notes` or `list_notes` to find a note ID, then `open_note` when its full contents are needed. Search results include matching-text previews, the total number of matches, and `hasMore`. Tool results include structured JSON and a text fallback. The optional `workspace` argument appears only when a connection has multiple workspaces.

`create_note` and `update_note` accept a `reminder` date and time as a timezone-aware ISO 8601 timestamp, such as `2026-09-24T14:00:00+02:00`. `update_note` accepts `reminder: null` to remove an existing reminder. `open_note`, `create_note`, and `update_note` return the reminder as an ISO 8601 timestamp or `null`.

---

## Recipe 1: Docker Compose

### 1. Configure Environment

Copy the recipe directory:

```bash
cd recipes/mcp-server/docker
cp .env.example .env
```

Edit `.env`:

```ini
# URL of the Scraps Cache instance
SCRAPSCACHE_URL=https://scrapscache.com

# Required independent OAuth sealing secret (32+ random characters)
MCP_SECRET=generate-with-openssl-rand-hex-32

# Optional static sync key for direct bearer-token access to one vault
# SCRAPSCACHE_SYNC_KEY=your_base64url_32_byte_sync_key

# Optional static bearer token for Claude Desktop / Cursor / Cline (32+ random characters)
# MCP_BEARER_TOKEN=generate-a-long-random-token

# Optional when a reverse proxy publishes the server at a stable HTTPS origin
# MCP_PUBLIC_ORIGIN=https://mcp.example.com

PORT=3001
```

> [!TIP]
> If you omit `SCRAPSCACHE_SYNC_KEY` and `MCP_BEARER_TOKEN`, the server runs entirely in **zero-token OAuth mode**! You or your friends just connect via Claude/ChatGPT and click "Allow" in Scraps Cache.

The Docker port is bound to `127.0.0.1` on the host. Put it behind an HTTPS reverse
proxy before exposing it publicly, and set `MCP_PUBLIC_ORIGIN` to that HTTPS origin.
Configure rate limits and connection limits at that proxy or WAF for the public
OAuth endpoints and long-lived MCP/SSE connections; the server bounds memory, but
cannot replace edge-level abuse protection.
`MCP_SECRET` is never a sync key and must not be reused between development and
production.

### 2. Start the Container

Run directly using the prebuilt image or build locally:

```bash
docker compose up -d
```

Check health:

```bash
curl http://localhost:3001/health
# {"status":"healthy","version":"1.0.0"}
```

---

## Recipe 2: Cloudflare Worker

Deploy to Cloudflare Workers on the free tier:

### 1. Install Wrangler and Login

```bash
npm install -g wrangler
wrangler login
```

### 2. Deploy

The Worker bundles the app's shared note model (`src/lib/model`), so install
the repository's dependencies first:

```bash
npm ci
cd recipes/mcp-server/cloudflare
npx wrangler deploy
```

Your MCP server will be live at `https://scrapscache-mcp.<your-subdomain>.workers.dev`.

### 3. Optional: Configure Static Keys

If you want a static bearer token for local IDEs (Cursor/Claude Desktop), set secrets via Wrangler:

```bash
# Optional: enable direct static bearer-token access to one vault
wrangler secret put SCRAPSCACHE_SYNC_KEY

# Optional: Set static Bearer token
wrangler secret put MCP_BEARER_TOKEN

# Required: independent 32+ character secret, for example `openssl rand -hex 32`
wrangler secret put MCP_SECRET
```

OAuth values are sealed with `MCP_SECRET`, while one-time sessions, authorization
codes, refresh-token rotation, and access-token revocation are stored in a
Cloudflare Durable Object shared by Worker isolates. Set one independent
`MCP_SECRET` in each Cloudflare Worker environment before connecting Claude,
ChatGPT, or Grok:

```bash
wrangler secret put MCP_SECRET --env dev
```

The GitHub Actions workflow deploys code only and does not copy MCP secrets
through GitHub. Keep `MCP_SECRET` in Cloudflare as the runtime source of truth;
deploying a new Worker version does not require a GitHub copy of that secret.

Leave `SCRAPSCACHE_SYNC_KEY` and `MCP_BEARER_TOKEN` empty for the pure zero-token 1-click OAuth handshake. `MCP_SECRET` is still required.

---

## Sharing With Friends (Multi-Vault Setup)

You can easily share your self-hosted MCP server with friends without anyone sharing private notes:

### Method A: 1-Click Zero-Token OAuth (Recommended)

No tokens or keys need to be configured. When your friend connects their AI assistant (ChatGPT, Claude Web, etc.) to your MCP server URL:

1. The AI client opens the OAuth prompt.
2. The MCP server directs your friend to Scraps Cache (`/mcp/authorize`).
3. Since your friend is already logged into their own Scraps Cache account in their browser, they simply click **"Allow access"**.
4. An ephemeral, end-to-end encrypted ECDH handshake safely exchanges their sync key in ephemeral server memory.
5. Their AI assistant connects directly and exclusively to their personal vault.

### Method B: Static Multi-Token Map (For CLI / Local IDEs)

If your friends want to use Claude Desktop or Cursor which don't support browser OAuth prompts, configure `MCP_FRIENDS_TOKENS` in your `.env` or Worker secrets as a JSON dictionary mapping individual Bearer tokens to each friend's Sync Key:

```json
MCP_FRIENDS_TOKENS={"alice_token_with_32_random_chars":"alice_base64url_32_byte_sync_key","bob_token_with_32_random_chars":"bob_base64url_32_byte_sync_key"}
```

When Alice connects with `Authorization: Bearer alice_secret_token`, the server automatically accesses Alice's vault.

---

## Connecting AI Clients

### 1. ChatGPT & Claude Web (OAuth 2.1 Zero-Token Handshake)

In Claude Web or ChatGPT Custom Connectors:

- **Server URL**: `https://your-mcp-server-domain.com`
- **Authentication**: OAuth 2.1
- Complete the 1-click consent prompt in Scraps Cache. Done!

### 2. Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"scrapscache": {
			"command": "npx",
			"args": [
				"-y",
				"mcp-remote",
				"http://localhost:3001/mcp",
				"--header",
				"Authorization: Bearer my-secure-secret-token"
			]
		}
	}
}
```

### 3. Cursor / Windsurf / Cline

Configure an MCP server with Streamable HTTP:

- **Transport**: HTTP / SSE
- **URL**: `http://localhost:3001/mcp` (or your Cloudflare Worker URL)
- **Headers**:
  - `Authorization`: `Bearer your-32-plus-character-static-token`

Bearer tokens are accepted only in the `Authorization` header. Query-string
tokens are deliberately rejected because URLs can be copied into browser
history, proxy logs, monitoring systems, and referrer headers. OAuth access and
refresh token responses are marked `Cache-Control: no-store`.
