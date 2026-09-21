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
                                                  └─────────────────────────┘
```

- **Zero-Knowledge**: The MCP server uses your `SCRAPSCACHE_SYNC_KEY` to authenticate via cryptographic challenge-response (`ed25519`) and decrypts notes in ephemeral memory (`xchacha20poly1305`).
- **Flexible Hosting**: Deploy via **Docker Compose** on your home server/VPS, or as a **Cloudflare Worker** on Cloudflare's free tier.
- **For You and Your Friends**: Host a single vault for yourself, or configure multiple keys for friends with their own dedicated tokens or self-service OAuth login!

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

# Your 32-byte Base64URL sync key (from Scraps Cache -> Settings -> Sync)
SCRAPSCACHE_SYNC_KEY=your_base64url_sync_key

# Bearer token for client authentication
MCP_BEARER_TOKEN=my-secure-secret-token

PORT=3001
```

### 2. Start the Container

```bash
docker compose up -d
```

Check health:

```bash
curl http://localhost:3001/health
# {"status":"healthy","timestamp":"..."}
```

---

## Recipe 2: Cloudflare Worker

Deploy to Cloudflare Workers on the free tier:

### 1. Install Wrangler and Login

```bash
npm install -g wrangler
wrangler login
```

### 2. Configure Secrets

```bash
cd recipes/mcp-server/cloudflare

# Set upstream Scraps Cache URL (if self-hosted)
wrangler secret put SCRAPSCACHE_URL

# Set your private sync key
wrangler secret put SCRAPSCACHE_SYNC_KEY

# Set static Bearer token
wrangler secret put MCP_BEARER_TOKEN
```

### 3. Deploy

```bash
npx wrangler deploy
```

Your MCP server will be live at `https://scrapscache-mcp.<your-subdomain>.workers.dev`.

---

## Sharing With Friends (Multi-Vault Setup)

You can share your self-hosted MCP server with friends without them sharing your notes:

### Method A: Static Multi-Token Map

Configure `MCP_FRIENDS_TOKENS` in your `.env` or Worker secrets as a JSON dictionary mapping individual Bearer tokens to each friend's Sync Key:

```json
MCP_FRIENDS_TOKENS={"alice_secret_token":"alice_sync_key_here...","bob_secret_token":"bob_sync_key_here..."}
```

When Alice connects with `Authorization: Bearer alice_secret_token`, the server automatically accesses Alice's vault.

### Method B: Self-Service OAuth Consent

When your friends connect through OAuth (e.g. Claude Web or ChatGPT), the server displays an authorization page (`/oauth/authorize`). Friends can input their own Sync Key directly in their browser during the authorization prompt!

---

## Connecting AI Clients

### 1. Claude Desktop

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

### 2. Cursor / Windsurf / Cline

Configure an MCP server with Streamable HTTP:

- **Transport**: HTTP / SSE
- **URL**: `http://localhost:3001/mcp` (or your Cloudflare Worker URL)
- **Headers**:
  - `Authorization`: `Bearer my-secure-secret-token`

### 3. ChatGPT & Claude Web (OAuth 2.1)

- **Server URL**: `https://your-mcp-server-domain.com`
- **Authentication**: OAuth 2.1 (with PKCE S256)
- **Authorization URL**: `https://your-mcp-server-domain.com/oauth/authorize`
- **Token URL**: `https://your-mcp-server-domain.com/oauth/token`
- **Scope**: `mcp`

### 4. Hermes Agent / Grok / Perplexity

Connect using the pre-registered OAuth clients or Bearer token directly.
