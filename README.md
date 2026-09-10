# Steam Reviews MCP Server

[![npm](https://img.shields.io/npm/v/@jhomen368/steam-reviews-mcp)](https://www.npmjs.com/package/@jhomen368/steam-reviews-mcp)
[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/jhomen368/steam-reviews-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Give your AI assistant access to Steam reviews, game details, patch notes, and
community discussions. This [MCP](https://modelcontextprotocol.io) server reads
public Steam data. No API key or Steam login is needed.

Once connected, try asking:

- "What are players saying about Cyberpunk 2077's performance in the last month?"
- "Compare Elden Ring and Baldur's Gate 3 for Steam Deck. Include prices in Germany."
- "What changed in the latest Baldur's Gate 3 patch?"
- "Search Portal 2 discussions for co-op connection problems and read a few threads."

## Setup

### Run with npx

Use a current Node.js LTS release. Node.js 24 or newer is recommended.
Your MCP client can start the server with `npx`, so there is no separate install step.

For Claude Desktop, add this entry to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "steam-reviews": {
      "command": "npx",
      "args": ["-y", "@jhomen368/steam-reviews-mcp"]
    }
  }
}
```

The config file is at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop after saving. For other MCP clients, use the same command
and arguments with the stdio transport in that client's configuration format.

### Run with Docker

The container starts in HTTP mode:

```bash
docker run -d \
  --name steam-reviews-mcp \
  -p 8086:8086 \
  ghcr.io/jhomen368/steam-reviews-mcp:latest
```

Connect an SSE-capable MCP client to `http://localhost:8086/mcp`.
Choose SSE as the transport, rather than Streamable HTTP.

For Docker Compose:

```yaml
services:
  steam-reviews-mcp:
    image: ghcr.io/jhomen368/steam-reviews-mcp:latest
    ports:
      - "8086:8086"
    restart: unless-stopped
```

Check that the server is running with `curl http://localhost:8086/health`.

## Available tools

Your assistant handles the tool arguments. Ask for a country, language, date range,
or topic in your question.

| Tool | What it does |
| --- | --- |
| `search_steam_games` | Find games by name. |
| `get_game_info` | Get regional prices, review scores, Steam Deck ratings, requirements, and Store details. |
| `fetch_reviews` | Read player reviews with filters for date, language, and recommendation. |
| `analyze_reviews` | Summarize a review sample, with themes and linked quotes. |
| `fetch_app_announcements` | Read official app announcements, patch notes, and hotfixes. |
| `search_app_discussions` | Search a game's public community discussions. |
| `fetch_discussion_thread` | Read a discussion thread and its replies. |

Review summaries cover a sample, and discussion threads are read one page at a time.
Community posts reflect player claims, not official announcements. The discussion
tools and Steam Deck review filter are experimental and may not always return results.

## Configuration

These environment variables are optional. Set them in your MCP client's server
environment or pass them to Docker with `-e`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CACHE_ENABLED` | `true` | Cache Steam responses. |
| `CACHE_MAX_SIZE` | `1000` | Maximum cached entries. |
| `RATE_LIMIT_ENABLED` | `true` | Limit outgoing Steam requests. |
| `MAX_REQUESTS_PER_MINUTE` | `30` | Request limit. |
| `HTTP_MODE` | `false` | Use HTTP/SSE instead of stdio. The Docker image sets this to `true`. |
| `PORT` | `8086` | HTTP listening port. |

## Troubleshooting

If your client cannot start the server, check `node --version` and confirm it can
find `npx`. The stdio server writes logs to stderr and reserves stdout for MCP
messages. You do not need to set `DOTENV_CONFIG_QUIET`.

For Docker, check `docker logs steam-reviews-mcp` and the `/health` endpoint.
If health succeeds but the MCP client cannot connect, check that it supports SSE
and uses `/mcp`.

Steam timeouts and HTTP 429 responses can mean requests are being rate-limited.
Keep caching enabled and reduce `MAX_REQUESTS_PER_MINUTE` if these persist.

## Development

```bash
git clone https://github.com/jhomen368/steam-reviews-mcp.git
cd steam-reviews-mcp
npm ci
npm test
npm run lint
```

`npm test` builds the server and runs offline tests. To run the built server over
stdio, use `node build/index.js`. See
[CONTRIBUTING.md](https://github.com/jhomen368/steam-reviews-mcp/blob/main/CONTRIBUTING.md)
for contribution guidelines and
[CHANGELOG.md](https://github.com/jhomen368/steam-reviews-mcp/blob/main/CHANGELOG.md)
for release history.

Licensed under [MIT](LICENSE). You can
[support the project via PayPal](https://www.paypal.com/donate?hosted_button_id=PBRD7FXKSKAD2).
