import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

for (const [scenario, dotenvEnv] of [
  ['without a dotenv quiet setting', {}],
  ['with noisy dotenv settings', { DOTENV_CONFIG_QUIET: 'false', DOTENV_CONFIG_DEBUG: 'true' }],
]) {
  test(`stdio startup emits only JSON-RPC ${scenario}`, { timeout: 15000 }, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), 'steam-reviews-stdio-'));
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../build/index.js', import.meta.url))],
      {
        cwd,
        env: { ...getDefaultEnvironment(), HTTP_MODE: 'false', ...dotenvEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
        killSignal: 'SIGKILL',
      }
    );
    const closed = once(child, 'close');
    t.after(async () => {
      try {
        if (child.exitCode === null) child.kill('SIGKILL');
        await closed;
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const responses = [];
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'stdio-regression-test', version: '1.0.0' },
        },
      }) + '\n'
    );

    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      const message = JSONRPCMessageSchema.parse(JSON.parse(line));
      responses.push(message);
      if (message.id === 1) {
        assert.equal(message.result.serverInfo.name, 'steam-reviews-mcp');
        child.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
        );
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
      } else if (message.id === 2) {
        const names = message.result.tools.map((tool) => tool.name);
        assert.ok(names.includes('search_app_discussions'));
        assert.ok(names.includes('fetch_discussion_thread'));
        child.stdin.end();
      }
    }

    const [code, signal] = await closed;
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    assert.deepEqual(
      responses.map((message) => message.id),
      [1, 2]
    );
    assert.match(stderr, /running on stdio/);
  });
}
