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

- **Zero-Knowledge**: Notes are decrypted solely in ephemeral memory using ChaCha20-Poly1305. The upstream server only ever sees encrypted envelopes.
- **Zero-Token 1-Click Handshake**: When connecting through OAuth (Claude Web, ChatGPT, Grok), the user is seamlessly redirected to Scraps Cache where they are already logged in, clicks **"Allow access"**, and an ephemeral X25519 ECDH + XChaCha20-Poly1305 handshake securely delivers the sync key without typing or exposing secrets in URLs or logs.
- **Flexible Hosting**: Deploy via **Docker Compose** on your home server/VPS, or as a **Cloudflare Worker** on Cloudflare's free tier.
- **For You and Your Friends**: Host a single vault for yourself, or share the same server with friends who connect to their own vaults via 1-click OAuth or dedicated bearer tokens.

---

## MCP Tools Provided

| Tool                | Parameters                                                                                                                                                                                                                    | Description                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_notes`      | `query?: string`, `label?: string`, `pinnedOnly?: boolean`, `limit?: number`                                                                                                                                                  | Search encrypted notes by keyword, label, or pinned state. Returns note summaries with previews.                                                  |
| `list_notes`        | `limit?: number`                                                                                                                                                                                                              | List recently modified notes.                                                                                                                     |
| `list_recent_notes` | `limit?: number`                                                                                                                                                                                                              | Alias for `list_notes`.                                                                                                                           |
| `read_note`         | `id: string`                                                                                                                                                                                                                  | Fetch full note contents, including body text, checklist items with completion states, and labels.                                                |
| `open_note`         | `id: string`                                                                                                                                                                                                                  | Alias for `read_note`.                                                                                                                            |
| `create_note`       | `title?: string`, `body?: string`, `checklist?: string[]`, `labels?: string[]`, `pinned?: boolean`, `color?: string`                                                                                                          | Create a new note with optional checklist tasks, tags, and pin status.                                                                            |
| `update_note`       | `id: string`, `title?: string`, `body?: string`, `appendBody?: string`, `appendChecklistItems?: string[]`, `toggleChecklistItems?: string[]`, `labels?: string[]`, `color?: string`, `pinned?: boolean`, `archived?: boolean` | Update an existing note by ID. Supports replacing full body text, updating title/labels/color, appending text/tasks, or toggling checklist items. |
| `list_labels`       | _(none)_                                                                                                                                                                                                                      | List all tags/labels currently present in your note vault.                                                                                        |

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

# Optional default sync key for your own vault (if you want static bearer token access)
# SCRAPSCACHE_SYNC_KEY=your_base64url_sync_key

# Optional static bearer token for Claude Desktop / Cursor / Cline
# MCP_BEARER_TOKEN=my-secure-secret-token

PORT=3001
```

> [!TIP]
> If you omit `SCRAPSCACHE_SYNC_KEY` and `MCP_BEARER_TOKEN`, the server runs entirely in **zero-token OAuth mode**! You or your friends just connect via Claude/ChatGPT and click "Allow" in Scraps Cache.

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

```bash
cd recipes/mcp-server/cloudflare
npx wrangler deploy
```

Your MCP server will be live at `https://scrapscache-mcp.<your-subdomain>.workers.dev`.

### 3. Optional: Configure Static Keys

If you want a static bearer token for local IDEs (Cursor/Claude Desktop), set secrets via Wrangler:

```bash
# Optional: Set your default sync key
wrangler secret put SCRAPSCACHE_SYNC_KEY

# Optional: Set static Bearer token
wrangler secret put MCP_BEARER_TOKEN
```

OAuth clients, handshake sessions, and access tokens are sealed with `MCP_SECRET` so any Worker isolate can finish a login started on another isolate. Set one before connecting Claude, ChatGPT, or Grok:

```bash
wrangler secret put MCP_SECRET --env dev
```

If the Worker is deployed by this repository's GitHub Actions workflow, add
`MCP_SECRET` as a repository secret; the workflow forwards it to both the
development and production MCP Workers.

If `MCP_SECRET` is unset, the worker falls back to `SCRAPSCACHE_SYNC_KEY` or `MCP_BEARER_TOKEN`. With none of those set, OAuth state is isolated to one Worker instance and a login may fail with `Invalid client_id or unauthorized redirect_uri` or an expired session.

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
MCP_FRIENDS_TOKENS={"alice_secret_token":"alice_sync_key...","bob_secret_token":"bob_sync_key..."}
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
  - `Authorization`: `Bearer my-secure-secret-token`
