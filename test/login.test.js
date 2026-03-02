import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  saveCredentials,
  loadCredentials,
  logout,
} from '../lib/login.js'

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------
describe('generateCodeVerifier', () => {
  it('returns a string of at least 43 characters', () => {
    const verifier = generateCodeVerifier()
    assert.ok(typeof verifier === 'string')
    assert.ok(verifier.length >= 43, `expected >= 43 chars, got ${verifier.length}`)
  })

  it('returns a URL-safe string (base64url charset)', () => {
    const verifier = generateCodeVerifier()
    assert.match(verifier, /^[A-Za-z0-9_-]+$/)
  })
})

describe('generateCodeChallenge', () => {
  it('returns a base64url-encoded SHA256 hash of the verifier', () => {
    const verifier = 'test-verifier-value'
    const challenge = generateCodeChallenge(verifier)
    const expected = createHash('sha256').update(verifier).digest('base64url')
    assert.equal(challenge, expected)
  })

  it('matches a known test vector', () => {
    // RFC 7636 Appendix B — well-known PKCE test vector
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = generateCodeChallenge(verifier)
    const expected = createHash('sha256').update(verifier).digest('base64url')
    assert.equal(challenge, expected)
    // The challenge must be non-empty and URL-safe
    assert.ok(challenge.length > 0)
    assert.match(challenge, /^[A-Za-z0-9_-]+$/)
  })
})

// ---------------------------------------------------------------------------
// buildAuthUrl
// ---------------------------------------------------------------------------
describe('buildAuthUrl', () => {
  const port = 12345
  const state = 'test-state-abc'
  const codeChallenge = 'test-challenge-xyz'
  const clientId = 'test-client-id'

  it('returns a URL string starting with the Google auth endpoint', () => {
    const url = buildAuthUrl(port, state, codeChallenge, clientId)
    assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'))
  })

  it('includes all required OAuth parameters', () => {
    const url = buildAuthUrl(port, state, codeChallenge, clientId)
    const parsed = new URL(url)
    const params = parsed.searchParams

    assert.equal(params.get('client_id'), clientId)
    assert.equal(params.get('redirect_uri'), `http://localhost:${port}/callback`)
    assert.equal(params.get('response_type'), 'code')
    assert.equal(params.get('scope'), 'openid email https://www.googleapis.com/auth/cloud-platform')
    assert.equal(params.get('code_challenge'), codeChallenge)
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.equal(params.get('state'), state)
    assert.equal(params.get('access_type'), 'offline')
    assert.equal(params.get('prompt'), 'consent')
  })

  it('redirect_uri uses http://localhost:<port>/callback', () => {
    const url = buildAuthUrl(9999, state, codeChallenge, clientId)
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:9999/callback')
  })
})

// ---------------------------------------------------------------------------
// exchangeCode (mock fetch)
// ---------------------------------------------------------------------------
describe('exchangeCode', () => {
  let originalFetch

  before(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends POST to token URL with correct body', async () => {
    let capturedUrl, capturedInit
    globalThis.fetch = async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return {
        ok: true,
        json: async () => ({ access_token: 'at', refresh_token: 'rt' }),
      }
    }

    await exchangeCode('auth-code', 'verifier', 'http://localhost:3000/callback', 'cid', 'csecret')

    assert.equal(capturedUrl, 'https://oauth2.googleapis.com/token')
    assert.equal(capturedInit.method, 'POST')

    const body = new URLSearchParams(capturedInit.body)
    assert.equal(body.get('code'), 'auth-code')
    assert.equal(body.get('client_id'), 'cid')
    assert.equal(body.get('client_secret'), 'csecret')
    assert.equal(body.get('redirect_uri'), 'http://localhost:3000/callback')
    assert.equal(body.get('grant_type'), 'authorization_code')
    assert.equal(body.get('code_verifier'), 'verifier')
  })

  it('returns { access_token, refresh_token } on success', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600 }),
    })

    const result = await exchangeCode('code', 'verifier', 'http://localhost:3000/callback', 'cid', 'cs')
    assert.equal(result.access_token, 'at-123')
    assert.equal(result.refresh_token, 'rt-456')
  })

  it('throws on non-200 response', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    })

    await assert.rejects(
      () => exchangeCode('code', 'verifier', 'http://localhost:3000/callback', 'cid', 'cs'),
      (err) => {
        assert.ok(err.message.includes('Token exchange failed'))
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// saveCredentials / loadCredentials
// ---------------------------------------------------------------------------
describe('saveCredentials', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stitch-test-'))
  })

  it('writes JSON to credentials file', () => {
    const creds = { refresh_token: 'rt', client_id: 'cid' }
    saveCredentials(creds, tmpDir)

    const written = JSON.parse(readFileSync(join(tmpDir, 'credentials.json'), 'utf8'))
    assert.deepEqual(written, creds)
  })

  it('creates config directory if it does not exist', () => {
    const nestedDir = join(tmpDir, 'nested', 'config')
    assert.ok(!existsSync(nestedDir))

    saveCredentials({ refresh_token: 'rt' }, nestedDir)

    assert.ok(existsSync(nestedDir))
    assert.ok(existsSync(join(nestedDir, 'credentials.json')))
  })
})

describe('loadCredentials', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stitch-test-'))
  })

  it('reads and parses the credentials file', () => {
    const creds = { refresh_token: 'rt', client_id: 'cid' }
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, 'credentials.json'), JSON.stringify(creds))

    const loaded = loadCredentials(tmpDir)
    assert.deepEqual(loaded, creds)
  })

  it('returns null if file does not exist', () => {
    const result = loadCredentials(join(tmpDir, 'nonexistent'))
    assert.equal(result, null)
  })
})

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------
describe('logout', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stitch-test-'))
  })

  it('deletes the credentials file', () => {
    writeFileSync(join(tmpDir, 'credentials.json'), '{}')
    assert.ok(existsSync(join(tmpDir, 'credentials.json')))

    logout(tmpDir)

    assert.ok(!existsSync(join(tmpDir, 'credentials.json')))
  })

  it('does nothing if credentials file does not exist', () => {
    // Should not throw
    assert.doesNotThrow(() => logout(tmpDir))
  })
})

// ---------------------------------------------------------------------------
// refreshAccessToken (mock fetch)
// ---------------------------------------------------------------------------
describe('refreshAccessToken', () => {
  let originalFetch

  before(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends correct POST to token URL with grant_type=refresh_token', async () => {
    let capturedUrl, capturedInit
    globalThis.fetch = async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return {
        ok: true,
        json: async () => ({ access_token: 'new-at' }),
      }
    }

    await refreshAccessToken('my-refresh-token', 'my-client-id', 'my-client-secret')

    assert.equal(capturedUrl, 'https://oauth2.googleapis.com/token')
    assert.equal(capturedInit.method, 'POST')

    const body = new URLSearchParams(capturedInit.body)
    assert.equal(body.get('grant_type'), 'refresh_token')
    assert.equal(body.get('refresh_token'), 'my-refresh-token')
    assert.equal(body.get('client_id'), 'my-client-id')
    assert.equal(body.get('client_secret'), 'my-client-secret')
  })

  it('returns the access_token string', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ access_token: 'fresh-token-abc' }),
    })

    const token = await refreshAccessToken('rt', 'cid', 'cs')
    assert.equal(token, 'fresh-token-abc')
  })
})
