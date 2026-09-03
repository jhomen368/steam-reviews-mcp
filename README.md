# Steam Reviews MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://github.com/jhomen368/steam-reviews-mcp/pkgs/container/steam-reviews-mcp)
[![Version](https://img.shields.io/badge/version-1.0.3-blue.svg)](https://github.com/jhomen368/steam-reviews-mcp)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/donate?hosted_button_id=PBRD7FXKSKAD2)

> **A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for Steam game reviews and analysis. Search games, fetch reviews, and analyze sentiment through the Model Context Protocol.**

## 🎯 Key Features

- **🔍 Game Search** - Search Steam games by name with batch support (up to 5 queries)
- **📊 Detailed Game Info** - Get comprehensive game data with criteria filtering
- **💬 Review Fetching** - Advanced filtering (time-bounded, Steam Deck, review bombs)
- **🧠 Sentiment Analysis** - NLP-powered analysis with topic drill-down
- **⚡ Smart Caching** - 70-85% API call reduction with variable TTL
- **🔗 Example Quotes** - Clickable Steam community links for review quotes
- **📣 App Announcements** - Official Steam Community posts, patch notes, and hotfixes

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
| **get_game_info** | Get game details | Regional pricing, purchase notices, languages, Store features, Deck compatibility |
| **fetch_reviews** | Fetch user reviews | Advanced filters, pagination, time-bounded queries |
| **analyze_reviews** | Analyze sentiment | NLP analysis, topic drill-down, example quotes with links |
| **fetch_app_announcements** | Read official app announcements | Full available Steam markup, publication details, backward pagination |

## 📋 Prerequisites

- **Node.js** 18.0 or higher
- **npm** or compatible package manager
- No API key required! Uses public Steam Store API

## 🚀 Quick Start

### Option 1: NPM (Recommended)

```bash
npm install -g @jhomen368/steam-reviews-mcp
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
      "args": ["-y", "@jhomen368/steam-reviews-mcp"]
    }
  }
}
```

### Option 2: Docker (HTTP Mode)

```bash
docker run -d \
  --name steam-reviews-mcp \
  -p 8086:8086 \
  ghcr.io/jhomen368/steam-reviews-mcp:latest
```

**Docker Compose:**

```yaml
services:
  steam-reviews-mcp:
    image: ghcr.io/jhomen368/steam-reviews-mcp:latest
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

Search terms must not be blank. If a generated client sends `queries: []` alongside a valid
`query`, the empty batch field is ignored.

### Get Regional Game Info with Criteria

```typescript
get_game_info({
  appIds: [1086940, 1245620],
  country: "de",
  language: "german",
  criteria: {
    minReviewScore: 80,
    minReviews: 1000,
    requireMetacritic: true
  },
  includeRequirements: true,
  includeDlc: true
})
```

`country` accepts two-letter ISO 3166-1 store country codes and `language` accepts Steam's internal
language codes, such as `english`, `german`, and `schinese`. They default to `us` and `english`. ISO
language codes such as `en`, `de`, and `zh` are rejected before a Steam request.

Each game includes a `storefront` object identifying the requested country and language.
Its `priceStatus` distinguishes an `available` regional quote, a genuinely `free` game, an
`unreleased` game, and an `unavailable` quote. `currency` and `priceFormatted` preserve Steam's
current regional quote without conversion. Missing quote fields never imply that a game is free.
If Steam returns no usable app details, the AppID and storefront context remain in the result with
a `steam_store` warning instead of disappearing or being presented as a free game.
An `unavailable` quote does not infer whether the cause is delisting, package-only sale, regional
restriction, or another Store condition. Active criteria still exclude results that cannot satisfy
the requested filter.

Steam does not report which language it actually served and may silently fall back when a
translation is missing. For that reason, `storefront.languageStatus` is
`requested_not_verified`: it records the request context without claiming that returned text was
translated into the requested language.

`purchaseNotices` preserves Steam's raw third-party account and DRM or launcher notices. Each
notice has a `supplied`, `not_supplied`, or `malformed` status. `not_supplied` means only that Steam
omitted the notice; it does not prove that the game has no account requirement, launcher,
online-only behavior, activation limit, anti-cheat, or DRM. The server does not infer those claims
from notice text.

`languageSupport` contains structured language, full-audio, and subtitle declarations when Steam's
public Store service returns them. It also retains `rawDeclaration` from app details. If structured
retrieval fails, the status is `partial_raw_only` when that raw declaration exists, or `unavailable`
when it does not, and the game includes a `steam_language_support` warning.

`storeCategories.items` preserves Steam's category IDs and localized labels for declarations such
as controller support, co-op, multiplayer, achievements, and Steam Cloud. Unknown category IDs are
retained. These Store declarations are separate from tags and are not independently tested
behavior. When `includeRequirements` is true, Steam's localized minimum and recommended PC text is
returned without interpretation.

Omit `criteria` when no filtering is needed. Zero and `false` criteria values are inactive;
use `requireFree: true` to return only free games.

Each returned game includes Valve's Steam Deck compatibility evidence when available. Known
`category` values are `verified`, `playable`, `unsupported`, and `unknown`. The raw
`categoryCode` and Valve test-result `token` values are retained so new values are not discarded.
`categoryCode: null` means Valve has not published a result and is reported as `unknown`, not
`unsupported`. If Steam's Deck endpoint fails or returns malformed data, the game remains in the
result with a `steam_deck_compatibility` warning and no `deckCompatibility` claim.

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

// All-time reviews (`dayRange` may also be omitted)
fetch_reviews({
  appId: 1086940,
  dayRange: 0
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

### Fetch Official App Announcements

```typescript
// Latest announcements
const firstPage = await fetch_app_announcements({
  appId: 1086940,
  limit: 10
})

// Older announcements using the previous result's nextCursor
fetch_app_announcements({
  appId: 1086940,
  limit: 10,
  cursor: firstPage.nextCursor
})
```

Announcement bodies retain Steam's BBCode, HTML, and image placeholders. Check `bodyStatus`
before treating the text as full: it can be `full_requested`, `possibly_truncated`, or
`malformed`. `full_requested` means the client asked Steam not to shorten the body; it is not
independent proof that the source text is complete.
`authorLabel` is the label displayed by Steam and does not verify an employer or publisher role.

### Natural Language Examples

Simply ask your AI assistant:

- "Search for Elden Ring on Steam"
- "Get info about Baldur's Gate 3 including system requirements"
- "What are people saying about Cyberpunk 2077 recently?"
- "Analyze negative reviews for No Man's Sky - what are the main complaints?"
- "Find free games with at least 90% positive reviews"
- "Show me the latest official updates for Baldur's Gate 3"

## ⚙️ Configuration

### Environment Variables

All configuration is optional with sensible defaults:

```bash
# Cache settings
CACHE_ENABLED=true                    # Enable caching (default: true)
CACHE_MAX_SIZE=1000                   # Max cache entries

# Rate limiting
RATE_LIMIT_ENABLED=true               # Enable rate limiting (default: true)
MAX_REQUESTS_PER_MINUTE=30            # Max API calls per minute

# HTTP mode (for Docker)
HTTP_MODE=false                       # Enable HTTP transport
PORT=8086                             # HTTP server port
```

## 📚 Documentation

- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines
- **[Steam Store API](https://steamapi.xpaw.me/)** - Steam API reference

## 🔧 Troubleshooting

### Connection Issues

- Verify Steam Store API is accessible (no firewall blocks)
- Check rate limiting if receiving 429 errors
- Review logs for timeout errors

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
