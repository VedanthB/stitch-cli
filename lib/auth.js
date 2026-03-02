import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
 *   1. ADC (Application Default Credentials)
 *   2. options.apiKey  (passed as --api-key flag)
 *   3. STITCH_API_KEY  env var
 *   4. Error
 *
 * @param {object} options
 * @param {string} [options.apiKey]    — API key from CLI flag
 * @param {string} [options._adcPath]  — override ADC path (testing only)
 * @returns {Promise<Record<string, string>>} auth headers
 */
export async function resolveAuth(options = {}) {
  const adcPath = options._adcPath ?? DEFAULT_ADC_PATH;

  // 1. Try ADC
  const adcHeaders = await tryADC(adcPath);
  if (adcHeaders) return adcHeaders;

  // 2. Try API key from options
  if (options.apiKey) return { 'X-Goog-Api-Key': options.apiKey };

  // 3. Try API key from env
  if (process.env.STITCH_API_KEY) {
    return { 'X-Goog-Api-Key': process.env.STITCH_API_KEY };
  }

  // 4. Nothing worked — throw a helpful error
  throw new Error(
    'No authentication found. Use one of:\n' +
      '  1. gcloud auth application-default login\n' +
      '  2. --api-key <key>\n' +
      '  3. STITCH_API_KEY environment variable',
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
