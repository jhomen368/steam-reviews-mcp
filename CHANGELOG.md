# Changelog

All notable changes to steam-reviews-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-08-29

### Fixed

- **Generated client compatibility**: Accepted empty batch queries alongside a valid single query, treated zero-valued criteria as inactive, and interpreted `dayRange: 0` as an all-time review query
- **Search validation**: Rejected blank search terms and published the single-or-batch query requirement in the tool schema

### Changed

- **Tool documentation**: Clarified empty, zero, cursor, and pre-fetched review semantics for MCP clients
- **Regression coverage**: Added tests for generated-client payloads and all active game information criteria

## [1.0.2] - 2026-08-28

### Changed

- **Tool execution**: Consolidated tool definitions, validation, execution, and error mapping into one module shared by the stdio and HTTP transports
- **Automated tests**: Added Node test coverage for all four tools and their validation and failure paths
- **Maintenance**: Updated runtime dependencies, development tooling, container images, and GitHub Actions

### Fixed

- **Build compatibility**: Aligned TypeScript and ESLint tooling and migrated TypeScript to Node16 module resolution
- **CI reliability**: Synchronized the npm lockfile before clean installs and removed unnecessary CodeQL build steps

### Security

- **Production image**: Removed npm from the runtime Docker image to reduce its installed package and CVE footprint
- **Dependencies**: Updated vulnerable transitive packages reported by npm audit; the release lockfile reports zero known vulnerabilities

## [1.0.1] - 2026-03-06

### Fixed

- Corrected Steam review URL generation in `generateReviewUrl()` in `src/utils/analysis.ts` - fixed URL format from incorrect `profiles/recommended/[appid]/[recommendationid]` to correct `profiles/[steamid64]/recommended/[appid]/`

### Security

- Upgraded Alpine base image packages to remediate CVE-2026-22184 (CRITICAL): buffer overflow in zlib 1.3.1-r2; patched to 1.3.2-r0 via apk upgrade in Dockerfile

## [1.0.0] - 2026-02-23

### Added

#### Core Tools (4 MCP Tools)
- `search_steam_games` tool - Search for games by name with batch support (up to 5 queries)
- `get_game_info` tool - Detailed game information with criteria filtering
- `fetch_reviews` tool - Fetch reviews with advanced filtering options
- `analyze_reviews` tool - Sentiment analysis with topic drill-down

#### Search Features
- Single and batch game search (up to 5 queries, 25 results each)
- Returns AppID, name, price, and preview image
- Efficient parallel query execution

#### Game Info Features
- Comprehensive game details (description, developers, publishers, platforms)
- Optional system requirements (PC minimum/recommended specs)
- Optional DLC list with AppIDs
- Current player count support
- Review statistics integration

#### Criteria Filtering
- `minReviewScore` - Filter by minimum review score percentage (0-100)
- `minReviews` - Filter by minimum number of reviews
- `maxPrice` - Filter by maximum price in cents
- `requireFree` - Only include free games
- `requireMetacritic` - Only games with Metacritic scores
- `minMetacritic` - Minimum Metacritic score (0-100)

#### Review Fetching Features
- Advanced filtering: `all`, `recent`, `updated`
- Review type filter: `all`, `positive`, `negative`
- Purchase type filter: `all`, `steam`, `non_steam_purchase`
- Language support (e.g., "english", "schinese")
- Pagination with cursor support
- Time-bounded queries (`dayRange` parameter)
- Review bomb filtering (`filterOfftopicActivity`)
- Steam Deck reviews support (experimental)

#### Sentiment Analysis Features
- NLP-powered sentiment analysis using natural library
- Sentiment score (-1 to 1) with confidence
- Common theme extraction
- Positive/negative keyword identification
- Topic-focused drill-down analysis
- Example quotes with clickable Steam community links
- Pre-fetched review support to avoid duplicate API calls

#### Infrastructure
- LRU cache with variable TTL support
  - Reviews: 5 minutes
  - Game info: 1 hour
  - Statistics: 30 minutes
  - Analysis: 10 minutes
- Rate limiting (30 requests/minute default)
- Retry logic with exponential backoff
- Graceful shutdown handling
- Comprehensive error handling with Zod validation

#### Developer Experience
- Full TypeScript implementation
- Zod schema validation for all inputs
- ESLint and Prettier configuration
- Docker support with multi-stage builds
- Non-root container user for security

### Features Summary
- 4 powerful MCP tools with 30+ combined parameters
- Aggressive caching (70-85% API call reduction)
- Topic-focused review analysis
- Batch operations for efficiency
- Time-bounded queries (recent reviews)
- Review bomb filtering
- Criteria-based game filtering
- Multi-platform support (Windows, Mac, Linux detection)

### Technical Details
- Built on @modelcontextprotocol/sdk v1.0.4
- Uses axios for HTTP requests
- Uses cheerio for HTML parsing
- Uses natural for NLP/sentiment analysis
- Node.js 18+ required
- ES modules (ESM) architecture
