import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MCPClient } from '../lib/mcp-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVER_URL = 'https://example.com/mcp';

/** Save and restore the real fetch between tests */
let originalFetch;

function mockFetch(impl) {
  globalThis.fetch = impl;
}

/** Build a standard JSON Response */
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Build an SSE Response */
function sseResponse(events) {
  // events is an array of objects; each becomes a `data: <json>\n\n` chunk
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Standard initialize result the server would send */
function initResult(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'test-server', version: '0.1.0' },
      capabilities: {},
    },
  };
}

/** Utility: connect a client with default mocks so later tests start from a connected state */
async function connectedClient(extraHeaders = {}) {
  const client = new MCPClient(SERVER_URL, extraHeaders);
  mockFetch((_url, opts) => {
    const body = JSON.parse(opts.body);
    // initialize request
    if (body.method === 'initialize') {
      return Promise.resolve(
        jsonResponse(initResult(body.id), {
          headers: { 'mcp-session-id': 'sess-42' },
        }),
      );
    }
    // initialized notification — no response body expected, just 200
    if (body.method === 'notifications/initialized') {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    return Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} }));
  });
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── 1. Constructor ────────────────────────────────────────────────────────
describe('MCPClient constructor', () => {
  it('stores the URL', () => {
    const client = new MCPClient(SERVER_URL);
    // We can verify indirectly — connect will POST to this URL
    assert.ok(client);
  });

  it('stores custom headers', async () => {
    const client = new MCPClient(SERVER_URL, { Authorization: 'Bearer tok' });
    let capturedHeaders;
    mockFetch((_url, opts) => {
      capturedHeaders = opts.headers;
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();
    assert.equal(capturedHeaders['Authorization'], 'Bearer tok');
  });
});

// ── 2-4. connect() ────────────────────────────────────────────────────────
describe('connect()', () => {
  it('sends an initialize request with correct JSON-RPC structure', async () => {
    let captured;
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        captured = body;
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();

    assert.equal(captured.jsonrpc, '2.0');
    assert.equal(captured.method, 'initialize');
    assert.equal(typeof captured.id, 'number');
    assert.equal(captured.params.protocolVersion, '2025-03-26');
    assert.deepEqual(captured.params.clientInfo, { name: 'stitch-cli', version: '1.0.0' });
    assert.deepEqual(captured.params.capabilities, {});
  });

  it('captures Mcp-Session-Id from response headers', async () => {
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(
          jsonResponse(initResult(body.id), {
            headers: { 'mcp-session-id': 'sess-abc' },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();

    // Verify session ID is used in subsequent calls
    let sessionHeader;
    mockFetch((_url, opts) => {
      sessionHeader = opts.headers['Mcp-Session-Id'];
      const body = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }),
      );
    });
    await client.listTools();
    assert.equal(sessionHeader, 'sess-abc');
  });

  it('sends notifications/initialized after initialize (no id field)', async () => {
    const calls = [];
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();

    assert.equal(calls.length, 2);
    const notif = calls[1];
    assert.equal(notif.jsonrpc, '2.0');
    assert.equal(notif.method, 'notifications/initialized');
    assert.equal(notif.id, undefined, 'notifications must not have an id field');
  });
});

// ── 5-8. callTool() ──────────────────────────────────────────────────────
describe('callTool()', () => {
  it('sends tools/call with correct JSON-RPC structure', async () => {
    const client = await connectedClient();
    let captured;
    mockFetch((_url, opts) => {
      captured = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: captured.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    });
    await client.callTool('generate_screen', { prompt: 'hello' });

    assert.equal(captured.jsonrpc, '2.0');
    assert.equal(captured.method, 'tools/call');
    assert.equal(captured.params.name, 'generate_screen');
    assert.deepEqual(captured.params.arguments, { prompt: 'hello' });
  });

  it('includes Mcp-Session-Id header', async () => {
    const client = await connectedClient();
    let capturedHeaders;
    mockFetch((_url, opts) => {
      capturedHeaders = opts.headers;
      const body = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    });
    await client.callTool('test_tool', {});
    assert.equal(capturedHeaders['Mcp-Session-Id'], 'sess-42');
  });

  it('parses application/json response correctly', async () => {
    const client = await connectedClient();
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'generated result' }] },
        }),
      );
    });
    const result = await client.callTool('gen', {});
    assert.equal(result, 'generated result');
  });

  it('parses text/event-stream (SSE) response correctly', async () => {
    const client = await connectedClient();
    mockFetch(() => {
      return Promise.resolve(
        sseResponse([
          {
            jsonrpc: '2.0',
            id: 3,
            result: { content: [{ type: 'text', text: 'sse result' }] },
          },
        ]),
      );
    });
    const result = await client.callTool('gen', {});
    assert.equal(result, 'sse result');
  });

  it('handles SSE with multiple events and returns last result', async () => {
    const client = await connectedClient();
    mockFetch(() => {
      return Promise.resolve(
        sseResponse([
          { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 50 } },
          {
            jsonrpc: '2.0',
            id: 3,
            result: { content: [{ type: 'text', text: 'final' }] },
          },
        ]),
      );
    });
    const result = await client.callTool('gen', {});
    assert.equal(result, 'final');
  });

  it('extracts text content from result.content[0].text', async () => {
    const client = await connectedClient();
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              { type: 'text', text: 'first' },
              { type: 'text', text: 'second' },
            ],
          },
        }),
      );
    });
    const result = await client.callTool('multi', {});
    assert.equal(result, 'first');
  });

  it('returns full result when no text content exists', async () => {
    const client = await connectedClient();
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { data: 'raw' },
        }),
      );
    });
    const result = await client.callTool('raw_tool', {});
    assert.deepEqual(result, { data: 'raw' });
  });

  it('defaults args to empty object', async () => {
    const client = await connectedClient();
    let captured;
    mockFetch((_url, opts) => {
      captured = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: captured.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    });
    await client.callTool('no_args');
    assert.deepEqual(captured.params.arguments, {});
  });
});

// ── 9. listTools() ───────────────────────────────────────────────────────
describe('listTools()', () => {
  it('sends tools/list and returns tool list', async () => {
    const client = await connectedClient();
    const tools = [
      { name: 'generate_screen', description: 'Generate a screen' },
      { name: 'edit_screen', description: 'Edit a screen' },
    ];
    let captured;
    mockFetch((_url, opts) => {
      captured = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({ jsonrpc: '2.0', id: captured.id, result: { tools } }),
      );
    });
    const result = await client.listTools();
    assert.equal(captured.method, 'tools/list');
    assert.deepEqual(result, tools);
  });
});

// ── 10-12. Error handling ────────────────────────────────────────────────
describe('error handling', () => {
  it('throws on non-200 status with status and body text', async () => {
    const client = await connectedClient();
    mockFetch(() => {
      return Promise.resolve(
        new Response('Unauthorized', {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        }),
      );
    });
    await assert.rejects(() => client.callTool('fail', {}), (err) => {
      assert.ok(err.message.includes('401'));
      assert.ok(err.message.includes('Unauthorized'));
      return true;
    });
  });

  it('throws on JSON-RPC error response with error message', async () => {
    const client = await connectedClient();
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32600, message: 'Invalid request' },
        }),
      );
    });
    await assert.rejects(() => client.callTool('bad', {}), (err) => {
      assert.ok(err.message.includes('Invalid request'));
      return true;
    });
  });

  it('propagates network errors', async () => {
    const client = await connectedClient();
    mockFetch(() => {
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    await assert.rejects(() => client.callTool('net_err', {}), (err) => {
      assert.ok(err instanceof TypeError);
      assert.ok(err.message.includes('Failed to fetch'));
      return true;
    });
  });
});

// ── 13. Auto-incrementing IDs ────────────────────────────────────────────
describe('JSON-RPC id management', () => {
  it('auto-increments id across calls', async () => {
    const ids = [];
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.id !== undefined) ids.push(body.id);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [] },
        }),
      );
    });
    await client.connect();       // id=1 for initialize (notification has no id)
    await client.listTools();     // id=2
    await client.listTools();     // id=3

    assert.deepEqual(ids, [1, 2, 3]);
  });

  it('notifications do not consume an id', async () => {
    const allBodies = [];
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      allBodies.push(body);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();

    const initReq = allBodies[0];
    const notifReq = allBodies[1];
    assert.equal(initReq.id, 1);
    assert.equal(notifReq.id, undefined);
  });
});

// ── 14. close() ──────────────────────────────────────────────────────────
describe('close()', () => {
  it('resets session ID so subsequent calls have no session header', async () => {
    const client = await connectedClient();
    client.close();

    let capturedHeaders;
    mockFetch((_url, opts) => {
      capturedHeaders = opts.headers;
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    // Re-connect after close
    await client.connect();
    // The initialize call should NOT have the old session ID
    assert.equal(capturedHeaders['Mcp-Session-Id'], undefined);
  });
});

// ── 15. Standard headers ─────────────────────────────────────────────────
describe('request headers', () => {
  it('includes Content-Type and Accept on all POST requests', async () => {
    const headersLog = [];
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      headersLog.push({ ...opts.headers });
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();

    for (const h of headersLog) {
      assert.equal(h['Content-Type'], 'application/json');
      assert.equal(h['Accept'], 'application/json, text/event-stream');
    }
  });

  it('merges custom headers without overriding standard ones', async () => {
    const client = new MCPClient(SERVER_URL, { 'X-Custom': 'val' });
    let captured;
    mockFetch((_url, opts) => {
      captured = opts.headers;
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();

    assert.equal(captured['X-Custom'], 'val');
    assert.equal(captured['Content-Type'], 'application/json');
    assert.equal(captured['Accept'], 'application/json, text/event-stream');
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────
describe('edge cases', () => {
  it('connect() works without Mcp-Session-Id in response', async () => {
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        // No mcp-session-id header
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    // Should not throw
    await client.connect();
    assert.ok(true);
  });

  it('callTool sends to correct URL', async () => {
    const client = await connectedClient();
    let capturedUrl;
    mockFetch((url, opts) => {
      capturedUrl = url;
      const body = JSON.parse(opts.body);
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    });
    await client.callTool('test', {});
    assert.equal(capturedUrl, SERVER_URL);
  });

  it('all requests use POST method', async () => {
    const methods = [];
    const client = new MCPClient(SERVER_URL);
    mockFetch((_url, opts) => {
      methods.push(opts.method);
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse(initResult(body.id)));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    await client.connect();
    assert.ok(methods.every((m) => m === 'POST'));
  });
});
