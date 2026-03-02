/**
 * Output formatters for stitch-cli.
 * Pure functions — no side effects, no dependencies.
 */

/**
 * Format a list of projects for terminal display or JSON output.
 * @param {Array} projects
 * @param {boolean} json - return JSON string when true
 * @returns {string}
 */
export function formatProjects(projects, json = false) {
  if (json) return JSON.stringify(projects, null, 2)
  if (!projects.length) return 'No projects found.'
  return projects
    .map(p => {
      const id = p.id || p.name?.split('/').pop() || '?'
      const screens = p.screenCount ?? p.screenInstances?.length ?? 0
      return `${id}  ${p.title || 'Untitled'}  (${screens} screens)`
    })
    .join('\n')
}

/**
 * Format a list of screens for terminal display or JSON output.
 * @param {Array} screens
 * @param {boolean} json - return JSON string when true
 * @returns {string}
 */
export function formatScreens(screens, json = false) {
  if (json) return JSON.stringify(screens, null, 2)
  if (!screens.length) return 'No screens found.'
  return screens
    .map(s => {
      const id = s.id || s.name?.split('/').pop() || '?'
      return `${id}  ${s.title || 'Untitled'}  [${s.deviceType || 'Unknown'}]`
    })
    .join('\n')
}

/**
 * Format a single screen — outputs raw HTML content or JSON.
 * Prefers screen.html over screen.content.
 * @param {Object} screen
 * @param {boolean} json - return JSON string when true
 * @returns {string}
 */
export function formatScreen(screen, json = false) {
  if (json) return JSON.stringify(screen, null, 2)
  return screen.html || screen.content || ''
}
