import { MCPClient } from './mcp-client.js';
import { resolveAuth } from './auth.js';
import { writeFileSync } from 'node:fs';

const DEFAULT_URL = 'https://stitch.googleapis.com/mcp';

const DEVICE_MAP = {
  desktop: 'DESKTOP',
  mobile: 'MOBILE',
  tablet: 'TABLET',
};

const MODEL_MAP = {
  flash: 'GEMINI_3_FLASH',
  pro: 'GEMINI_3_PRO',
};

/**
 * Run a function against a connected MCP client, handling the full lifecycle.
 * Creates client → connects → runs fn → closes.
 *
 * @param {object} options - Auth options passed to resolveAuth + MCP URL config
 * @param {function} fn - Async function receiving the connected MCPClient
 * @returns {Promise<*>} Result of fn
 */
async function withClient(options, fn) {
  const url = process.env.STITCH_MCP_URL || DEFAULT_URL;
  const authHeaders = await resolveAuth(options);
  const client = new MCPClient(url, authHeaders);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    client.close();
  }
}

/**
 * List all Stitch projects.
 * @param {object} [options] - Auth options
 * @returns {Promise<*>}
 */
export async function listProjects(options = {}) {
  const result = await withClient(options, (c) => c.callTool('list_projects', {}));
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  return parsed?.projects ?? parsed;
}

/**
 * Get a single Stitch project by ID.
 * @param {string} id - Project ID
 * @param {object} [options] - Auth options
 * @returns {Promise<*>}
 */
export async function getProject(id, options = {}) {
  return withClient(options, (c) =>
    c.callTool('get_project', { name: `projects/${id}` }),
  );
}

/**
 * List screens in a project.
 * @param {string} projectId - Project ID
 * @param {object} [options] - Auth options
 * @returns {Promise<*>}
 */
export async function listScreens(projectId, options = {}) {
  const result = await withClient(options, (c) =>
    c.callTool('list_screens', { projectId }),
  );
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  return parsed?.screens ?? parsed;
}

/**
 * Get a single screen.
 * @param {string} projectId - Project ID
 * @param {string} screenId - Screen ID
 * @param {object} [options] - Auth options
 * @returns {Promise<*>}
 */
export async function getScreen(projectId, screenId, options = {}) {
  return withClient(options, (c) =>
    c.callTool('get_screen', {
      name: `projects/${projectId}/screens/${screenId}`,
      projectId,
      screenId,
    }),
  );
}

/**
 * Generate a new screen from a text prompt.
 * @param {string} projectId - Project ID
 * @param {string} prompt - Text prompt describing the screen
 * @param {object} [options] - Auth options + device ('desktop'|'mobile'|'tablet') + model ('flash'|'pro')
 * @returns {Promise<*>}
 */
export async function generateScreen(projectId, prompt, options = {}) {
  const device = options.device || 'desktop';
  const model = options.model || 'flash';
  return withClient(options, (c) =>
    c.callTool('generate_screen_from_text', {
      projectId,
      prompt,
      deviceType: DEVICE_MAP[device] || device,
      modelId: MODEL_MAP[model] || model,
    }),
  );
}

/**
 * Edit existing screens with a text prompt.
 * @param {string} projectId - Project ID
 * @param {string[]} screenIds - Array of screen IDs
 * @param {string} prompt - Text prompt describing the edits
 * @param {object} [options] - Auth options + device + model
 * @returns {Promise<*>}
 */
export async function editScreens(projectId, screenIds, prompt, options = {}) {
  const device = options.device || 'desktop';
  const model = options.model || 'flash';
  return withClient(options, (c) =>
    c.callTool('edit_screens', {
      projectId,
      selectedScreenIds: screenIds,
      prompt,
      deviceType: DEVICE_MAP[device] || device,
      modelId: MODEL_MAP[model] || model,
    }),
  );
}

/**
 * Generate variants of existing screens.
 * @param {string} projectId - Project ID
 * @param {string[]} screenIds - Array of screen IDs
 * @param {string} prompt - Text prompt for variant generation
 * @param {object} [options] - Auth options
 * @returns {Promise<*>}
 */
export async function generateVariants(
  projectId,
  screenIds,
  prompt,
  options = {},
) {
  return withClient(options, (c) =>
    c.callTool('generate_variants', {
      projectId,
      selectedScreenIds: screenIds,
      prompt,
      variantOptions: {},
    }),
  );
}

/**
 * Download a screen's HTML to a local file.
 * @param {string} projectId - Project ID
 * @param {string} screenId - Screen ID
 * @param {string|null} outputPath - File path to write (null = auto from title)
 * @param {object} [options] - Auth options
 * @returns {Promise<string>} The output file path
 */
export async function downloadScreen(
  projectId,
  screenId,
  outputPath,
  options = {},
) {
  const result = await getScreen(projectId, screenId, options);
  let meta;
  if (typeof result === 'string') {
    try { meta = JSON.parse(result); } catch { meta = null; }
  } else {
    meta = result;
  }

  // The API returns metadata with htmlCode.downloadUrl — fetch the actual HTML
  const htmlUrl = meta?.htmlCode?.downloadUrl;
  let html;
  if (htmlUrl) {
    const res = await fetch(htmlUrl);
    if (!res.ok) throw new Error(`Failed to download HTML (${res.status})`);
    html = await res.text();
  } else if (!meta && typeof result === 'string') {
    // Result was raw HTML, not JSON metadata
    html = result;
  } else {
    html = meta?.html || meta?.content || '';
  }

  const title = meta?.title || screenId;
  const filename =
    outputPath ||
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.html`;
  writeFileSync(filename, html);
  return filename;
}
