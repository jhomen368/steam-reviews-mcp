import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Start the built HTTP server on an unused local port and register cleanup. */
async function startHttpServer(t) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));

  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../build/index.js', import.meta.url)), '--http'],
    {
      env: { ...getDefaultEnvironment(), PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 15000,
      killSignal: 'SIGKILL',
    }
  );
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGKILL');
    await closed;
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return baseUrl;
    } catch {
      // The child may still be importing dependencies.
    }
    assert.equal(child.exitCode, null, stderr);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`HTTP server did not become healthy: ${stderr}`);
}

test('HTTP/SSE initializes and dispatches MCP tool requests', { timeout: 15000 }, async (t) => {
  const baseUrl = await startHttpServer(t);
  const client = new Client({ name: 'http-regression-test', version: '1.0.0' });
  try {
    await client.connect(new SSEClientTransport(new URL(`${baseUrl}/mcp`)), { timeout: 3000 });
    const listed = await client.listTools({}, { timeout: 3000 });
    assert.ok(listed.tools.some((tool) => tool.name === 'search_steam_games'));
    assert.ok(listed.tools.some((tool) => tool.name === 'fetch_discussion_thread'));

    const result = await client.callTool(
      { name: 'search_steam_games', arguments: { query: ' ' } },
      undefined,
      { timeout: 3000 }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /validation|blank|query/i);
  } finally {
    await client.close();
  }
});

test('HTTP/SSE keeps concurrent clients separate and rejects unknown sessions', { timeout: 15000 }, async (t) => {
  const baseUrl = await startHttpServer(t);
  const clients = [
    new Client({ name: 'http-client-one', version: '1.0.0' }),
    new Client({ name: 'http-client-two', version: '1.0.0' }),
  ];
  try {
    await Promise.all(clients.map((client) =>
      client.connect(new SSEClientTransport(new URL(`${baseUrl}/mcp`)), { timeout: 3000 })
    ));
    const [listed, invalid] = await Promise.all([
      clients[0].listTools({}, { timeout: 3000 }),
      clients[1].callTool(
        { name: 'search_steam_games', arguments: { query: ' ' } },
        undefined,
        { timeout: 3000 }
      ),
    ]);
    assert.ok(Array.isArray(listed.tools));
    assert.equal(invalid.isError, true);
    await clients[0].close();
    assert.ok((await clients[1].listTools({}, { timeout: 3000 })).tools.length > 0);

    for (const suffix of ['', '?sessionId=unknown', '?sessionId=a&sessionId=b']) {
      const response = await fetch(`${baseUrl}/message${suffix}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /sessionId/);
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
  }
});
