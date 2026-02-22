# Steam Reviews MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://github.com/jhomen368/steam-reviews-mcp)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/jhomen368/steam-reviews-mcp)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/donate?hosted_button_id=PBRD7FXKSKAD2)

> **A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for Steam game reviews and analysis. Search games, fetch reviews, and analyze sentiment with AI assistants like Claude.**

## 🎯 Key Features

- **🔍 Game Search** - Search Steam games by name with batch support (up to 5 queries)
- **📊 Detailed Game Info** - Get comprehensive game data with criteria filtering
- **💬 Review Fetching** - Advanced filtering (time-bounded, Steam Deck, review bombs)
- **🧠 Sentiment Analysis** - NLP-powered analysis with topic drill-down
- **⚡ Smart Caching** - 70-85% API call reduction with variable TTL
- **🔗 Example Quotes** - Clickable Steam community links for review quotes

## 🔒 Security

- **🐳 Hardened Docker Images**
  - Non-root user (mcpuser)
  - Multi-stage builds
  - Minimal Alpine base
  - dumb-init process management
- **✅ Input Validation**
  - Zod schema validation for all inputs
  - Type-safe TypeScript throughout

## 🛠️ Available Tools

| Tool | Purpose | Key Features |
|------|---------|--------------|
| **search_steam_games** | Search for games | Single/batch search, AppID lookup, price info |
| **get_game_info** | Get game details | Batch lookup, criteria filtering, system requirements, DLC |
| **fetch_reviews** | Fetch user reviews | Advanced filters, pagination, time-bounded queries |
| **analyze_reviews** | Analyze sentiment | NLP analysis, topic drill-down, example quotes with links |

## 📋 Prerequisites

- **Node.js** 18.0 or higher
- **npm** or compatible package manager
- No API key required! Uses public Steam Store API

## 🚀 Quick Start

### Option 1: NPM (Recommended)

```bash
npm install -g steam-reviews-mcp
```

**Configure with Claude Desktop:**

Add to your configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "steam-reviews": {
      "command": "npx",
      "args": ["-y", "steam-reviews-mcp"]
    }
  }
}
```

### Option 2: Docker (HTTP Mode)

```bash
docker run -d \
  --name steam-reviews-mcp \
  -p 8086:8086 \
  steam-reviews-mcp:latest
```

**Docker Compose:**

```yaml
services:
  steam-reviews-mcp:
    image: steam-reviews-mcp:latest
    container_name: steam-reviews-mcp
    ports:
      - "8086:8086"
    restart: unless-stopped
```

**Test the server:**
```bash
curl http://localhost:8086/health
```

**Connect MCP clients:**
- **Transport**: SSE (Server-Sent Events)
- **URL**: `http://localhost:8086/mcp`

### Option 3: From Source

```bash
git clone https://github.com/jhomen368/steam-reviews-mcp.git
cd steam-reviews-mcp
npm install
npm run build
node build/index.js
```

## 💡 Usage Examples

### Search for Games

```typescript
// Single search
search_steam_games({
  query: "Baldur's Gate 3",
  limit: 10
})

// Batch search (up to 5 queries)
search_steam_games({
  queries: ["Elden Ring", "Cyberpunk 2077", "Hades"],
  limit: 5
})
```

### Get Game Info with Criteria

```typescript
get_game_info({
  appIds: [1086940, 1245620],
  criteria: {
    minReviewScore: 80,
    minReviews: 1000,
    requireMetacritic: true
  },
  includeRequirements: true,
  includeDlc: true
})
```

### Fetch Reviews with Filters

```typescript
// Recent positive reviews
fetch_reviews({
  appId: 1086940,
  filter: "recent",
  reviewType: "positive",
  dayRange: 30
})

// Filter out review bombs
fetch_reviews({
  appId: 1086940,
  filterOfftopicActivity: true
})
```

### Analyze Sentiment

```typescript
// General analysis
analyze_reviews({
  appId: 1086940,
  sampleSize: 100
})

// Topic-focused analysis
analyze_reviews({
  appId: 1086940,
  topic: "performance"
})
```

### Natural Language Examples

Simply ask your AI assistant:

- "Search for Elden Ring on Steam"
- "Get info about Baldur's Gate 3 including system requirements"
- "What are people saying about Cyberpunk 2077 recently?"
- "Analyze negative reviews for No Man's Sky - what are the main complaints?"
- "Find free games with at least 90% positive reviews"

## ⚙️ Configuration

### Environment Variables

All configuration is optional with sensible defaults:

```bash
# Cache settings
CACHE_ENABLED=true                    # Enable caching (default: true)
CACHE_MAX_SIZE=1000                   # Max cache entries

# Rate limiting
RATE_LIMIT_ENABLED=true               # Enable rate limiting (default: true)
MAX_REQUESTS_PER_MINUTE=30           # Max API calls per minute

# HTTP mode (for Docker)
HTTP_MODE=false                       # Enable HTTP transport
PORT=8086                            # HTTP server port
```

## 📚 Documentation

- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines
- **[Steam Store API](https://steamapi.xpaw.me/)** - Steam API reference

## 🔧 Troubleshooting

### Docker Issues
```bash
# Check logs
docker logs steam-reviews-mcp

# Verify health
curl http://localhost:8086/health
```

### Build Issues
```bash
# Ensure Node.js 18+
node --version

# Clean rebuild
rm -rf node_modules build
npm install
npm run build
```

## 🤝 Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

## 🙏 Acknowledgments

- [Steam](https://store.steampowered.com/) - Gaming platform and API
- [Model Context Protocol](https://modelcontextprotocol.io) - Open protocol for AI integrations
- [Anthropic](https://www.anthropic.com/) - Creators of the MCP standard

---

**Support this project:** [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/donate?hosted_button_id=PBRD7FXKSKAD2)
