# Model Context Protocol (MCP) Self-Hosting

Scraps Cache provides dedicated self-hosted recipes for running a private **Model Context Protocol (MCP)** server.

This allows AI assistants such as **Claude Desktop**, **Claude Web**, **ChatGPT**, **Grok**, **Hermes Agent**, **Perplexity**, **Cursor**, **Windsurf**, and **Cline** to search, read, create, and update notes in your private Scraps Cache vault, while keeping your data end-to-end encrypted.

## Available Recipes

- **Docker Compose Recipe**: Run with Docker on your home server or VPS. See [`recipes/mcp-server/docker/compose.yaml`](../recipes/mcp-server/docker/compose.yaml).
- **Cloudflare Worker Recipe**: Deploy directly to Cloudflare Workers on the free tier. See [`recipes/mcp-server/cloudflare/wrangler.jsonc`](../recipes/mcp-server/cloudflare/wrangler.jsonc).

For the full setup instructions, privacy guarantees, multi-friend hosting, and client configuration examples, see the [MCP Server Recipe Guide](../recipes/mcp-server/README.md).
