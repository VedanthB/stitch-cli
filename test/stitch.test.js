import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Module under test (imported after helpers so fetch mock is ready)
// ---------------------------------------------------------------------------
import {
  listProjects,
  getProject,
  listScreens,
  getScreen,
  generateScreen,
  editScreens,
  generateVariants,
  downloadScreen,
} from '../lib/stitch.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let originalFetch;
let originalEnvUrl;

/** Save / restore fetch and env between tests */
beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalEnvUrl = process.env.STITCH_MCP_URL;
  delete process.env.STITCH_MCP_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnvUrl !== undefined) {
    process.env.STITCH_MCP_URL = originalEnvUrl;
  } else {
    delete process.env.STITCH_MCP_URL;
  }
});

/** Default options that bypass ADC (nonexistent path) and use API key */
const AUTH_OPTS = { apiKey: 'test-key', _adcPath: '/nonexistent' };

/** Build a standard JSON Response */
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Standard initialize result */
function initResult(id) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'stitch-mcp', version: '0.1.0' },
      capabilities: {},
    },
  };
}

/**
 * Create a mock fetch that handles the MCP lifecycle:
 *   1. initialize → 200 JSON with session
 *   2. notifications/initialized → 200 empty
 *   3. tools/call → 200 JSON with provided toolResult
 *
 * Also captures the tools/call args for assertion.
 *
 * Returns { getCaptured } to retrieve what was sent to tools/call.
 */
function mockMCPFetch(toolResult) {
  let captured = null;

  globalThis.fetch = (_url, opts) => {
    const body = JSON.parse(opts.body);

    if (body.method === 'initialize') {
      return Promise.resolve(
        jsonResponse(initResult(body.id), {
          headers: { 'mcp-session-id': 'sess-test' },
        }),
      );
    }

    if (body.method === 'notifications/initialized') {
      return Promise.resolve(new Response(null, { status: 200 }));
    }

    if (body.method === 'tools/call') {
      captured = body;
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: toolResult,
        }),
      );
    }

    // Fallback
    return Promise.resolve(
      jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} }),
    );
  };

  return {
    getCaptured: () => captured,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ── 1. listProjects ──────────────────────────────────────────────────────

describe('listProjects()', () => {
  it('calls list_projects tool with empty args and returns result', async () => {
    const toolResult = { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    const result = await listProjects(AUTH_OPTS);

    const captured = getCaptured();
    assert.equal(captured.params.name, 'list_projects');
    assert.deepEqual(captured.params.arguments, {});
    assert.equal(result, '["proj-1","proj-2"]');
  });
});

// ── 2. getProject ────────────────────────────────────────────────────────

describe('getProject()', () => {
  it('calls get_project with name: projects/<id>', async () => {
    const toolResult = { content: [{ type: 'text', text: '{"id":"abc"}' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    const result = await getProject('abc', AUTH_OPTS);

    const captured = getCaptured();
    assert.equal(captured.params.name, 'get_project');
    assert.deepEqual(captured.params.arguments, { name: 'projects/abc' });
    assert.equal(result, '{"id":"abc"}');
  });
});

// ── 3. listScreens ──────────────────────────────────────────────────────

describe('listScreens()', () => {
  it('calls list_screens with parent: projects/<projectId>', async () => {
    const toolResult = { content: [{ type: 'text', text: '[]' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    const result = await listScreens('proj-1', AUTH_OPTS);

    const captured = getCaptured();
    assert.equal(captured.params.name, 'list_screens');
    assert.deepEqual(captured.params.arguments, { parent: 'projects/proj-1' });
    assert.equal(result, '[]');
  });
});

// ── 4. getScreen ─────────────────────────────────────────────────────────

describe('getScreen()', () => {
  it('calls get_screen with name: projects/<pid>/screens/<sid>', async () => {
    const toolResult = { content: [{ type: 'text', text: '<html>hello</html>' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    const result = await getScreen('proj-1', 'scr-1', AUTH_OPTS);

    const captured = getCaptured();
    assert.equal(captured.params.name, 'get_screen');
    assert.deepEqual(captured.params.arguments, {
      name: 'projects/proj-1/screens/scr-1',
    });
    assert.equal(result, '<html>hello</html>');
  });
});

// ── 5. generateScreen — basic ────────────────────────────────────────────

describe('generateScreen()', () => {
  it('calls generate_screen_from_text with correct args', async () => {
    const toolResult = { content: [{ type: 'text', text: 'generated' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    const result = await generateScreen('proj-1', 'A landing page', AUTH_OPTS);

    const captured = getCaptured();
    assert.equal(captured.params.name, 'generate_screen_from_text');
    assert.deepEqual(captured.params.arguments, {
      parent: 'projects/proj-1',
      text_prompt: 'A landing page',
      device_type: 'DEVICE_TYPE_DESKTOP',
      model_id: 'MODEL_ID_FLASH',
    });
    assert.equal(result, 'generated');
  });

  // ── 6. device_type from options ──────────────────────────────────────

  it('passes device_type from options (default: DEVICE_TYPE_DESKTOP)', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', AUTH_OPTS);

    const captured = getCaptured();
    assert.equal(captured.params.arguments.device_type, 'DEVICE_TYPE_DESKTOP');
  });

  // ── 7. model_id from options ─────────────────────────────────────────

  it('passes model_id from options (default: MODEL_ID_FLASH)', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', AUTH_OPTS);

    const captured = getCaptured();
    assert.equal(captured.params.arguments.model_id, 'MODEL_ID_FLASH');
  });

  // ── 8. user-friendly device names ────────────────────────────────────

  it('maps desktop → DEVICE_TYPE_DESKTOP', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', { ...AUTH_OPTS, device: 'desktop' });

    assert.equal(getCaptured().params.arguments.device_type, 'DEVICE_TYPE_DESKTOP');
  });

  it('maps mobile → DEVICE_TYPE_MOBILE', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', { ...AUTH_OPTS, device: 'mobile' });

    assert.equal(getCaptured().params.arguments.device_type, 'DEVICE_TYPE_MOBILE');
  });

  it('maps tablet → DEVICE_TYPE_TABLET', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', { ...AUTH_OPTS, device: 'tablet' });

    assert.equal(getCaptured().params.arguments.device_type, 'DEVICE_TYPE_TABLET');
  });

  // ── 9. user-friendly model names ─────────────────────────────────────

  it('maps flash → MODEL_ID_FLASH', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', { ...AUTH_OPTS, model: 'flash' });

    assert.equal(getCaptured().params.arguments.model_id, 'MODEL_ID_FLASH');
  });

  it('maps pro → MODEL_ID_PRO', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', { ...AUTH_OPTS, model: 'pro' });

    assert.equal(getCaptured().params.arguments.model_id, 'MODEL_ID_PRO');
  });

  // ── pass-through for raw enum values ─────────────────────────────────

  it('passes through raw enum device_type if not in map', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await generateScreen('p1', 'prompt', { ...AUTH_OPTS, device: 'DEVICE_TYPE_WATCH' });

    assert.equal(getCaptured().params.arguments.device_type, 'DEVICE_TYPE_WATCH');
  });
});

// ── 10-11. editScreens ──────────────────────────────────────────────────

describe('editScreens()', () => {
  it('calls edit_screens tool with correct args', async () => {
    const toolResult = { content: [{ type: 'text', text: 'edited' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    const result = await editScreens(
      'proj-1',
      ['scr-a', 'scr-b'],
      'Make it blue',
      AUTH_OPTS,
    );

    const captured = getCaptured();
    assert.equal(captured.params.name, 'edit_screens');
    assert.deepEqual(captured.params.arguments, {
      parent: 'projects/proj-1',
      screen_names: [
        'projects/proj-1/screens/scr-a',
        'projects/proj-1/screens/scr-b',
      ],
      text_prompt: 'Make it blue',
      device_type: 'DEVICE_TYPE_DESKTOP',
      model_id: 'MODEL_ID_FLASH',
    });
    assert.equal(result, 'edited');
  });

  it('formats screenIds into projects/<pid>/screens/<sid> format', async () => {
    const toolResult = { content: [{ type: 'text', text: 'ok' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    await editScreens('my-proj', ['s1'], 'edit', AUTH_OPTS);

    const args = getCaptured().params.arguments;
    assert.deepEqual(args.screen_names, ['projects/my-proj/screens/s1']);
  });
});

// ── 12. generateVariants ────────────────────────────────────────────────

describe('generateVariants()', () => {
  it('calls generate_variants tool with correct args', async () => {
    const toolResult = { content: [{ type: 'text', text: 'variants' }] };
    const { getCaptured } = mockMCPFetch(toolResult);

    const result = await generateVariants(
      'proj-1',
      ['scr-1', 'scr-2'],
      'Try different colors',
      AUTH_OPTS,
    );

    const captured = getCaptured();
    assert.equal(captured.params.name, 'generate_variants');
    assert.deepEqual(captured.params.arguments, {
      parent: 'projects/proj-1',
      screen_names: [
        'projects/proj-1/screens/scr-1',
        'projects/proj-1/screens/scr-2',
      ],
      text_prompt: 'Try different colors',
    });
    assert.equal(result, 'variants');
  });
});

// ── 13. Default MCP URL ─────────────────────────────────────────────────

describe('default MCP URL', () => {
  it('uses https://stitch.googleapis.com/mcp by default', async () => {
    let capturedUrl;
    globalThis.fetch = (url, opts) => {
      capturedUrl = url;
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(
          jsonResponse(initResult(body.id), {
            headers: { 'mcp-session-id': 'sess' },
          }),
        );
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    };

    await listProjects(AUTH_OPTS);
    assert.equal(capturedUrl, 'https://stitch.googleapis.com/mcp');
  });
});

// ── 14. STITCH_MCP_URL env override ─────────────────────────────────────

describe('STITCH_MCP_URL env var', () => {
  it('overrides the default MCP URL', async () => {
    process.env.STITCH_MCP_URL = 'https://custom.example.com/mcp';

    let capturedUrl;
    globalThis.fetch = (url, opts) => {
      capturedUrl = url;
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(
          jsonResponse(initResult(body.id), {
            headers: { 'mcp-session-id': 'sess' },
          }),
        );
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    };

    await listProjects(AUTH_OPTS);
    assert.equal(capturedUrl, 'https://custom.example.com/mcp');
  });
});

// ── 15. Lifecycle: connect → call → close ───────────────────────────────

describe('MCP client lifecycle', () => {
  it('creates client, connects, calls tool, and closes', async () => {
    const callLog = [];

    globalThis.fetch = (_url, opts) => {
      const body = JSON.parse(opts.body);
      callLog.push(body.method);

      if (body.method === 'initialize') {
        return Promise.resolve(
          jsonResponse(initResult(body.id), {
            headers: { 'mcp-session-id': 'sess' },
          }),
        );
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    };

    await listProjects(AUTH_OPTS);

    // Verify the lifecycle: initialize → notification → tools/call
    assert.deepEqual(callLog, [
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
  });
});

// ── 16. API key passed through to auth headers ──────────────────────────

describe('auth headers passthrough', () => {
  it('API key is passed through to request headers', async () => {
    let capturedHeaders;
    globalThis.fetch = (_url, opts) => {
      capturedHeaders = opts.headers;
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(
          jsonResponse(initResult(body.id), {
            headers: { 'mcp-session-id': 'sess' },
          }),
        );
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    };

    await listProjects(AUTH_OPTS);

    assert.equal(capturedHeaders['X-Goog-Api-Key'], 'test-key');
  });
});

// ── 17. Error propagation ───────────────────────────────────────────────

describe('error propagation', () => {
  it('MCPClient error propagates from stitch functions', async () => {
    globalThis.fetch = (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'initialize') {
        return Promise.resolve(
          jsonResponse(initResult(body.id), {
            headers: { 'mcp-session-id': 'sess' },
          }),
        );
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      // tools/call returns an error
      return Promise.resolve(
        new Response('Forbidden', {
          status: 403,
          headers: { 'content-type': 'text/plain' },
        }),
      );
    };

    await assert.rejects(
      () => listProjects(AUTH_OPTS),
      (err) => {
        assert.ok(err.message.includes('403'));
        return true;
      },
    );
  });
});

// ── 18-20. downloadScreen ───────────────────────────────────────────────

describe('downloadScreen()', () => {
  const tmpDir = join(import.meta.dirname, '.tmp-download-test');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('gets screen HTML and writes to file', async () => {
    const toolResult = { content: [{ type: 'text', text: '<html><body>Hello</body></html>' }] };
    mockMCPFetch(toolResult);

    const outPath = join(tmpDir, 'screen.html');
    const returned = await downloadScreen('proj-1', 'scr-1', outPath, AUTH_OPTS);

    const written = readFileSync(outPath, 'utf8');
    assert.equal(written, '<html><body>Hello</body></html>');
    assert.equal(returned, outPath);
  });

  it('uses screen title as default filename when no outputPath', async () => {
    // When callTool returns a non-text result (object with title)
    // We need MCPClient to return a full result object (no text extraction)
    // MCPClient extracts text from content[0].text, so we need to simulate
    // a result that doesn't have content[0].text to get the full object
    const toolResult = {
      title: 'My Landing Page',
      html: '<html>landing</html>',
    };
    mockMCPFetch(toolResult);

    // Use tmpDir as working directory prefix
    const returned = await downloadScreen('proj-1', 'scr-1', null, AUTH_OPTS);

    // Should generate filename from title: "My Landing Page" → "my-landing-page.html"
    assert.equal(returned, 'my-landing-page.html');

    // Clean up the generated file
    try {
      rmSync(returned, { force: true });
    } catch {
      // Ignore if file was not created
    }
  });

  it('returns the output file path', async () => {
    const toolResult = { content: [{ type: 'text', text: '<html>test</html>' }] };
    mockMCPFetch(toolResult);

    const outPath = join(tmpDir, 'output.html');
    const returned = await downloadScreen('proj-1', 'scr-1', outPath, AUTH_OPTS);

    assert.equal(returned, outPath);
  });
});
