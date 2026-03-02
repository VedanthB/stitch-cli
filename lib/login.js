import { randomBytes, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPES = 'openid email https://www.googleapis.com/auth/cloud-platform'
const DEFAULT_CLIENT_ID = '880155630235-oo1g8u2lh7csc91ehnct9slmcfevitq6.apps.googleusercontent.com'
const DEFAULT_CLIENT_SECRET = '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'
const CONFIG_DIR = join(homedir(), '.config', 'stitch-cli')

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------
export function generateCodeVerifier() {
  return randomBytes(32).toString('base64url')
}

export function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------
export function buildAuthUrl(port, state, codeChallenge, clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `http://localhost:${port}/callback`,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------
export async function exchangeCode(code, codeVerifier, redirectUri, clientId, clientSecret) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  return res.json()
}

export async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return data.access_token
}

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------
export function saveCredentials(credentials, configDir = CONFIG_DIR) {
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'credentials.json'), JSON.stringify(credentials, null, 2))
}

export function loadCredentials(configDir = CONFIG_DIR) {
  try {
    return JSON.parse(readFileSync(join(configDir, 'credentials.json'), 'utf8'))
  } catch {
    return null
  }
}

export function logout(configDir = CONFIG_DIR) {
  try {
    unlinkSync(join(configDir, 'credentials.json'))
  } catch {
    // File doesn't exist — nothing to do
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------
function startCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    let resolveCode
    const codePromise = new Promise((res) => { resolveCode = res })

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`)
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (state !== expectedState) {
        res.writeHead(400)
        res.end('State mismatch — possible CSRF attack.')
        return
      }

      if (!code) {
        res.writeHead(400)
        res.end('Missing authorization code.')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h1>Login successful!</h1><p>You can close this tab.</p></body></html>')
      resolveCode(code)
    })

    server.listen(0, () => {
      const port = server.address().port
      resolve({ port, codePromise, server })
    })

    server.on('error', reject)
  })
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' :
    'xdg-open'
  execFile(cmd, [url])
}

// ---------------------------------------------------------------------------
// Full login flow (orchestrator)
// ---------------------------------------------------------------------------
export async function login(options = {}) {
  const clientId = options.clientId || process.env.STITCH_CLIENT_ID || DEFAULT_CLIENT_ID
  const clientSecret = options.clientSecret || process.env.STITCH_CLIENT_SECRET || DEFAULT_CLIENT_SECRET
  if (!clientId || clientId === 'YOUR_CLIENT_ID_HERE') {
    throw new Error(
      'No OAuth client ID configured.\n' +
      'Set STITCH_CLIENT_ID env var or register one at:\n' +
      'https://console.cloud.google.com/apis/credentials',
    )
  }

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = randomBytes(16).toString('hex')

  // Start local HTTP server
  const { port, codePromise, server } = await startCallbackServer(state)
  const redirectUri = `http://localhost:${port}/callback`

  // Open browser
  const authUrl = buildAuthUrl(port, state, codeChallenge, clientId)
  openBrowser(authUrl)
  console.error('Opening browser for Google sign-in...')
  console.error("If the browser doesn't open, visit:")
  console.error(authUrl)

  // Wait for callback
  const code = await codePromise
  server.close()

  // Exchange code for tokens
  const tokens = await exchangeCode(code, codeVerifier, redirectUri, clientId, clientSecret)
  saveCredentials({ refresh_token: tokens.refresh_token, client_id: clientId, client_secret: clientSecret })
  console.error('Logged in successfully!')
  return tokens
}
