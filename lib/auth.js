import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadCredentials, refreshAccessToken } from './login.js';

const DEFAULT_ADC_PATH = join(
  homedir(),
  '.config',
  'gcloud',
  'application_default_credentials.json',
);
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Resolve authentication headers for the Stitch MCP server.
 *
 * Priority chain:
 *   1. Saved credentials (from `stitch login`)
 *   2. ADC (Application Default Credentials)
 *   3. options.apiKey  (passed as --api-key flag)
 *   4. STITCH_API_KEY  env var
 *   5. Error
 *
 * @param {object} options
 * @param {string}  [options.apiKey]      — API key from CLI flag
 * @param {string}  [options._adcPath]    — override ADC path (testing only)
 * @param {string}  [options._configDir]  — override config dir (testing only)
 * @returns {Promise<Record<string, string>>} auth headers
 */
export async function resolveAuth(options = {}) {
  const adcPath = options._adcPath ?? DEFAULT_ADC_PATH;

  // 1. Try saved credentials from `stitch login`
  const savedHeaders = await trySavedCredentials(options._configDir);
  if (savedHeaders) return savedHeaders;

  // 2. Try ADC
  const adcHeaders = await tryADC(adcPath);
  if (adcHeaders) return adcHeaders;

  // 3. Try API key from options
  if (options.apiKey) return { 'X-Goog-Api-Key': options.apiKey };

  // 4. Try API key from env
  if (process.env.STITCH_API_KEY) {
    return { 'X-Goog-Api-Key': process.env.STITCH_API_KEY };
  }

  // 5. Nothing worked — throw a helpful error
  throw new Error(
    'No authentication found. Use one of:\n' +
      '  1. stitch login\n' +
      '  2. gcloud auth application-default login\n' +
      '  3. --api-key <key>\n' +
      '  4. STITCH_API_KEY environment variable',
  );
}

/**
 * Attempt to obtain a Bearer token via Application Default Credentials.
 * Returns headers object on success, or null on any failure.
 */
async function tryADC(adcPath) {
  try {
    const raw = readFileSync(adcPath, 'utf8');
    const creds = JSON.parse(raw);

    if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
      return null;
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) return null;

    const { access_token } = await res.json();
    return { Authorization: `Bearer ${access_token}` };
  } catch {
    return null;
  }
}

/**
 * Attempt to obtain a Bearer token from saved credentials (`stitch login`).
 * Returns headers object on success, or null on any failure.
 */
async function trySavedCredentials(configDir) {
  try {
    const creds = loadCredentials(configDir);
    if (!creds?.refresh_token || !creds?.client_id) return null;
    const accessToken = await refreshAccessToken(creds.refresh_token, creds.client_id, creds.client_secret);
    return { Authorization: `Bearer ${accessToken}` };
  } catch {
    return null;
  }
}
