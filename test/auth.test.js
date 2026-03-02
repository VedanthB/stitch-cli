import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuth } from '../lib/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let originalFetch;
let originalEnv;

function mockFetch(impl) {
  globalThis.fetch = impl;
}

/** Build a standard JSON Response */
function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Valid ADC credentials for testing */
const VALID_ADC = JSON.stringify({
  client_id: 'test-client-id.apps.googleusercontent.com',
  client_secret: 'test-client-secret',
  refresh_token: 'test-refresh-token',
  type: 'authorized_user',
});

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalEnv = process.env.STITCH_API_KEY;
  delete process.env.STITCH_API_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnv !== undefined) {
    process.env.STITCH_API_KEY = originalEnv;
  } else {
    delete process.env.STITCH_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ── API Key auth ──────────────────────────────────────────────────────────

describe('API key via options', () => {
  it('returns X-Goog-Api-Key header from options.apiKey', async () => {
    const headers = await resolveAuth({ apiKey: 'test-key', _adcPath: '/nonexistent' });
    assert.deepEqual(headers, { 'X-Goog-Api-Key': 'test-key' });
  });
});

describe('API key via env', () => {
  it('returns X-Goog-Api-Key header from STITCH_API_KEY', async () => {
    process.env.STITCH_API_KEY = 'env-key';
    const headers = await resolveAuth({ _adcPath: '/nonexistent' });
    assert.deepEqual(headers, { 'X-Goog-Api-Key': 'env-key' });
  });
});

describe('API key priority', () => {
  it('options.apiKey takes priority over STITCH_API_KEY env', async () => {
    process.env.STITCH_API_KEY = 'env-key';
    const headers = await resolveAuth({ apiKey: 'opts-key', _adcPath: '/nonexistent' });
    assert.deepEqual(headers, { 'X-Goog-Api-Key': 'opts-key' });
  });
});

// ── ADC auth ──────────────────────────────────────────────────────────────

describe('ADC reads credentials file', () => {
  it('reads and parses the ADC credentials file', async () => {
    // Write a temp ADC file
    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(import.meta.dirname, '.tmp-adc-test');
    const adcPath = join(tmpDir, 'adc.json');

    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(adcPath, VALID_ADC);

    mockFetch((_url, opts) => {
      return Promise.resolve(
        jsonResponse({ access_token: 'fresh-token', expires_in: 3600 }),
      );
    });

    try {
      const headers = await resolveAuth({ _adcPath: adcPath });
      assert.deepEqual(headers, { Authorization: 'Bearer fresh-token' });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('ADC token exchange', () => {
  it('sends correct POST to Google token endpoint', async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(import.meta.dirname, '.tmp-adc-exchange');
    const adcPath = join(tmpDir, 'adc.json');

    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(adcPath, VALID_ADC);

    let capturedUrl;
    let capturedOpts;

    mockFetch((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve(
        jsonResponse({ access_token: 'tok-123', expires_in: 3600 }),
      );
    });

    try {
      await resolveAuth({ _adcPath: adcPath });

      assert.equal(capturedUrl, 'https://oauth2.googleapis.com/token');
      assert.equal(capturedOpts.method, 'POST');
      assert.equal(
        capturedOpts.headers['Content-Type'],
        'application/x-www-form-urlencoded',
      );

      const body = new URLSearchParams(capturedOpts.body);
      assert.equal(body.get('client_id'), 'test-client-id.apps.googleusercontent.com');
      assert.equal(body.get('client_secret'), 'test-client-secret');
      assert.equal(body.get('refresh_token'), 'test-refresh-token');
      assert.equal(body.get('grant_type'), 'refresh_token');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('ADC returns Bearer token', () => {
  it('returns Authorization header with Bearer prefix', async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(import.meta.dirname, '.tmp-adc-bearer');
    const adcPath = join(tmpDir, 'adc.json');

    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(adcPath, VALID_ADC);

    mockFetch(() =>
      Promise.resolve(jsonResponse({ access_token: 'my-access-token', expires_in: 3600 })),
    );

    try {
      const headers = await resolveAuth({ _adcPath: adcPath });
      assert.equal(headers['Authorization'], 'Bearer my-access-token');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('ADC priority', () => {
  it('ADC is tried first, even when STITCH_API_KEY is set', async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(import.meta.dirname, '.tmp-adc-priority');
    const adcPath = join(tmpDir, 'adc.json');

    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(adcPath, VALID_ADC);

    process.env.STITCH_API_KEY = 'env-key';

    mockFetch(() =>
      Promise.resolve(jsonResponse({ access_token: 'adc-wins', expires_in: 3600 })),
    );

    try {
      const headers = await resolveAuth({ apiKey: 'opts-key', _adcPath: adcPath });
      assert.deepEqual(headers, { Authorization: 'Bearer adc-wins' });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── ADC fallthrough cases ─────────────────────────────────────────────────

describe('ADC file not found', () => {
  it('falls through to API key when ADC file does not exist', async () => {
    const headers = await resolveAuth({
      apiKey: 'fallback-key',
      _adcPath: '/nonexistent/path/adc.json',
    });
    assert.deepEqual(headers, { 'X-Goog-Api-Key': 'fallback-key' });
  });
});

describe('ADC token exchange fails', () => {
  it('falls through to API key when token exchange returns non-200', async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(import.meta.dirname, '.tmp-adc-fail');
    const adcPath = join(tmpDir, 'adc.json');

    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(adcPath, VALID_ADC);

    mockFetch(() =>
      Promise.resolve(new Response('Bad Request', { status: 400 })),
    );

    try {
      const headers = await resolveAuth({ apiKey: 'fallback-key', _adcPath: adcPath });
      assert.deepEqual(headers, { 'X-Goog-Api-Key': 'fallback-key' });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('ADC file has wrong format', () => {
  it('falls through to API key when ADC file is missing required fields', async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(import.meta.dirname, '.tmp-adc-bad-format');
    const adcPath = join(tmpDir, 'adc.json');

    mkdirSync(tmpDir, { recursive: true });
    // Missing client_secret and refresh_token
    writeFileSync(adcPath, JSON.stringify({ client_id: 'only-this' }));

    try {
      const headers = await resolveAuth({ apiKey: 'fallback-key', _adcPath: adcPath });
      assert.deepEqual(headers, { 'X-Goog-Api-Key': 'fallback-key' });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── No auth available ─────────────────────────────────────────────────────

describe('No auth available', () => {
  it('throws an error when no auth method succeeds', async () => {
    await assert.rejects(
      () => resolveAuth({ _adcPath: '/nonexistent' }),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });
});

describe('Error message is helpful', () => {
  it('mentions all three auth methods in the error message', async () => {
    await assert.rejects(
      () => resolveAuth({ _adcPath: '/nonexistent' }),
      (err) => {
        assert.ok(err.message.includes('gcloud auth application-default login'));
        assert.ok(err.message.includes('--api-key'));
        assert.ok(err.message.includes('STITCH_API_KEY'));
        return true;
      },
    );
  });
});
