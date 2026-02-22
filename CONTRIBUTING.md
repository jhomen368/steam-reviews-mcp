# Contributing to Steam Reviews MCP Server

Thank you for your interest in contributing to Steam Reviews MCP Server! This document provides guidelines for contributing to the project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Environment details** (OS, Node.js version, Docker version if applicable)
- **Error messages or logs** if available

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear title and description**
- **Use case** - why this enhancement would be useful
- **Possible implementation** if you have ideas

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes**:
   - Follow the existing code style
   - Add tests if applicable
   - Update documentation as needed
3. **Test your changes**:
   - Ensure the code builds: `npm run build`
   - Test with real Steam data
4. **Commit your changes**:
   - Use clear, descriptive commit messages
   - Reference issue numbers if applicable
5. **Push to your fork** and submit a pull request

## Development Setup

### Prerequisites

- Node.js 18.0 or higher
- npm or yarn
- Basic familiarity with Steam Store API

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/jhomen368/steam-reviews-mcp.git
   cd steam-reviews-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Test locally:
   ```bash
   node build/index.js
   ```

### Development Workflow

- **Watch mode** for automatic rebuilds: `npm run dev`
- **Manual build**: `npm run build`
- **Linting**: `npm run lint`
- **Format check**: `npm run format:check`

## Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add JSDoc comments for public functions
- Keep functions focused and modular
- Use Zod for input validation

## Project Structure

```
steam-reviews-mcp/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── config.ts         # Configuration management
│   ├── types.ts          # TypeScript definitions
│   ├── version.ts        # Version constant
│   └── utils/
│       ├── steam-api.ts  # Steam API client
│       ├── cache.ts      # LRU cache with TTL
│       ├── rate-limit.ts # Rate limiting
│       ├── retry.ts      # Retry with backoff
│       └── analysis.ts   # NLP sentiment analysis
├── build/                # Compiled JavaScript
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Testing

Before submitting a pull request:

1. Build the project successfully
2. Test with real Steam AppIDs
3. Verify all existing functionality still works
4. Test your new features/fixes

### Test AppIDs

Here are some useful AppIDs for testing:

| Game | AppID | Notes |
|------|-------|-------|
| Baldur's Gate 3 | 1086940 | Popular, many reviews |
| Elden Ring | 1245620 | High review count |
| Cyberpunk 2077 | 1091500 | Mixed reviews |
| Counter-Strike 2 | 730 | Free, massive reviews |
| Hollow Knight | 367520 | Indie, very positive |

## Documentation

- Update README.md if you change functionality
- Add JSDoc comments for new functions/classes
- Include usage examples for new features
- Update CHANGELOG.md for notable changes

## Commit Message Guidelines

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters
- Reference issues and pull requests where appropriate

Example:
```
Add support for Steam Deck verified status

- Add deckCompatibility field to game info
- Update documentation with examples
- Fixes #123
```

## Release Process

Maintainers handle releases:

1. Update version in `package.json` and `src/version.ts`
2. Update CHANGELOG.md
3. Create git tag with version number
4. Push tag to trigger release workflow

## Questions?

Feel free to open an issue for questions or clarifications about contributing.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
