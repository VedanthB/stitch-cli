import { MCPClient } from './mcp-client.js';
import { resolveAuth } from './auth.js';
import { writeFileSync } from 'node:fs';

const DEFAULT_URL = 'https://stitch.googleapis.com/mcp';

const DEVICE_MAP = {
  desktop: 'DEVICE_TYPE_DESKTOP',
  mobile: 'DEVICE_TYPE_MOBILE',
  tablet: 'DEVICE_TYPE_TABLET',
};

const MODEL_MAP = {
  flash: 'MODEL_ID_FLASH',
  pro: 'MODEL_ID_PRO',
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
  return withClient(options, (c) => c.callTool('list_projects', {}));
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
  return withClient(options, (c) =>
    c.callTool('list_screens', { parent: `projects/${projectId}` }),
  );
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
      parent: `projects/${projectId}`,
      text_prompt: prompt,
      device_type: DEVICE_MAP[device] || device,
      model_id: MODEL_MAP[model] || model,
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
  const names = screenIds.map(
    (sid) => `projects/${projectId}/screens/${sid}`,
  );
  return withClient(options, (c) =>
    c.callTool('edit_screens', {
      parent: `projects/${projectId}`,
      screen_names: names,
      text_prompt: prompt,
      device_type: DEVICE_MAP[device] || device,
      model_id: MODEL_MAP[model] || model,
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
  const names = screenIds.map(
    (sid) => `projects/${projectId}/screens/${sid}`,
  );
  return withClient(options, (c) =>
    c.callTool('generate_variants', {
      parent: `projects/${projectId}`,
      screen_names: names,
      text_prompt: prompt,
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
  // result could be string (text content extracted by MCPClient) or object
  const html =
    typeof result === 'string'
      ? result
      : result?.html || result?.content || '';
  const title = result?.title || screenId;
  const filename =
    outputPath ||
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.html`;
  writeFileSync(filename, html);
  return filename;
}
