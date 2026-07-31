# Multi-stage build for Steam Reviews MCP Server
FROM node:26-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (dev + prod)
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Prune to production-only dependencies
RUN npm ci --omit=dev

# Production stage — pure Node.js runtime, no npm
FROM node:26-alpine

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling and security
# Upgrade all packages to fix CVEs in base image (e.g., CVE-2026-22184 in zlib)
RUN apk add --no-cache dumb-init && \
    apk upgrade --no-cache

# Remove npm to eliminate its bundled dependency CVE surface (not needed at runtime)
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

# Copy production node_modules and built output from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build

# Create a non-root user
RUN addgroup -g 1001 -S mcpuser && \
    adduser -S mcpuser -u 1001

# Change ownership
RUN chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Expose port
EXPOSE 8086

# Environment variables
ENV HTTP_MODE=true \
    PORT=8086 \
    NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8086/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# OCI labels for metadata
LABEL org.opencontainers.image.title="Steam Reviews MCP Server" \
      org.opencontainers.image.description="Model Context Protocol server for Steam game reviews and analysis" \
      org.opencontainers.image.source="https://github.com/jhomen368/steam-reviews-mcp" \
      org.opencontainers.image.licenses="MIT"

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Run the server
CMD ["node", "build/index.js"]
