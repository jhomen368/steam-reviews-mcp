#!/usr/bin/env node

/**
 * Steam Reviews MCP Server
 *
 * Provides AI agents access to Steam game review data and analysis.
 * This server implements the Model Context Protocol (MCP) for seamless
 * integration with AI assistants like Claude.
 *
 * @module steam-reviews-mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.js';
import { createToolModule } from './tools.js';
import { SteamAPIClient } from './utils/steam-api.js';
import { VERSION } from './version.js';

const steamClient = new SteamAPIClient(config);
const toolModule = createToolModule(steamClient);

/** Create an MCP server connected to the shared tool module. */
function createServer(): Server {
  const server = new Server(
    {
      name: 'steam-reviews-mcp',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolModule.tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return toolModule.execute(name, args);
  });

  return server;
}

/** Start the server with the stdio transport. */
async function main(): Promise<void> {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  const shutdown = () => {
    console.error('Shutting down gracefully...');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Steam Reviews MCP Server v${VERSION} running on stdio`);
  console.error(
    `Cache: ${config.cacheEnabled ? 'enabled' : 'disabled'}, Rate limiting: ${config.rateLimitEnabled ? 'enabled' : 'disabled'}`
  );
}

/** Start the server with the HTTP/SSE transport. */
async function runHttp(port: number): Promise<void> {
  const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
  const express = (await import('express')).default;

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'steam-reviews-mcp',
      version: VERSION,
      cache: config.cacheEnabled ? 'enabled' : 'disabled',
      rateLimit: config.rateLimitEnabled ? 'enabled' : 'disabled',
    });
  });

  app.get('/mcp', async (req, res) => {
    console.error('New MCP SSE connection established');

    const transport = new SSEServerTransport('/message', res);
    const server = createServer();
    await server.connect(transport);

    req.on('close', () => {
      console.error('MCP SSE connection closed');
    });
  });

  app.post('/message', async (_req, res) => {
    res.status(200).end();
  });

  app.listen(port, () => {
    console.error(`Steam Reviews MCP Server v${VERSION} running on HTTP port ${port}`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`Health check: http://localhost:${port}/health`);
    console.error(
      `Cache: ${config.cacheEnabled ? 'enabled' : 'disabled'}, Rate limiting: ${config.rateLimitEnabled ? 'enabled' : 'disabled'}`
    );
  });
}

const httpMode = process.env.HTTP_MODE === 'true' || process.argv.includes('--http');
const port = process.env.PORT ? parseInt(process.env.PORT) : config.port;

if (httpMode) {
  runHttp(port).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
