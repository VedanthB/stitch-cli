#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as stitch from '../lib/stitch.js'
import { formatProjects, formatScreens, formatScreen } from '../lib/format.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

const HELP = `stitch v${pkg.version} — AI UI design from your terminal (Google Stitch)

Usage:
  stitch projects                          List all projects
  stitch project <id>                      Get project details
  stitch screens <project-id>              List screens in a project
  stitch screen <project-id> <screen-id>   Get screen details (HTML/CSS)
  stitch generate <project-id> "prompt"    Generate a new screen from text
  stitch edit <project-id> <screen-ids> "prompt"  Edit existing screens
  stitch variants <project-id> <screen-ids> "prompt"  Generate design variants
  stitch download <project-id> <screen-id> [-o file]  Download screen HTML to file

Options:
  --api-key <key>    Stitch API key (or STITCH_API_KEY env)
  --device <type>    Device type: mobile, desktop, tablet (default: desktop)
  --model <id>       Model: pro, flash (default: flash)
  --json             Output raw JSON
  -o, --output <file>  Output file path (for download)
  --help, -h         Show this help
  --version, -v      Show version

Examples:
  stitch projects
  stitch generate 123456 "A login page with Google OAuth"
  stitch download 123456 abc123 -o login.html
  stitch screens 123456 --json | jq '.[] | .id'`

/**
 * Parse CLI arguments into a structured command object.
 * @param {string[]} argv - Arguments (process.argv.slice(2))
 * @returns {{ command: string, args: string[], options: object }}
 */
export function parseArgs(argv) {
  const options = {}
  const positional = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { command: 'help', args: [], options }
    if (arg === '--version' || arg === '-v') return { command: 'version', args: [], options }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--api-key' && i + 1 < argv.length) { options.apiKey = argv[++i]; continue }
    if (arg === '--device' && i + 1 < argv.length) { options.device = argv[++i]; continue }
    if (arg === '--model' && i + 1 < argv.length) { options.model = argv[++i]; continue }
    if ((arg === '-o' || arg === '--output') && i + 1 < argv.length) { options.output = argv[++i]; continue }
    positional.push(arg)
  }

  const command = positional[0] || 'help'
  const args = positional.slice(1)
  return { command, args, options }
}

async function main() {
  const { command, args, options } = parseArgs(process.argv.slice(2))

  try {
    switch (command) {
      case 'help':
        console.log(HELP)
        break
      case 'version':
        console.log(pkg.version)
        break
      case 'projects': {
        const result = await stitch.listProjects(options)
        console.log(formatProjects(Array.isArray(result) ? result : [], options.json))
        break
      }
      case 'project': {
        if (!args[0]) { console.error('Error: project ID required'); process.exit(1) }
        const result = await stitch.getProject(args[0], options)
        console.log(options.json ? JSON.stringify(result, null, 2) : result)
        break
      }
      case 'screens': {
        if (!args[0]) { console.error('Error: project ID required'); process.exit(1) }
        const result = await stitch.listScreens(args[0], options)
        console.log(formatScreens(Array.isArray(result) ? result : [], options.json))
        break
      }
      case 'screen': {
        if (!args[0] || !args[1]) { console.error('Error: project ID and screen ID required'); process.exit(1) }
        const result = await stitch.getScreen(args[0], args[1], options)
        console.log(formatScreen(typeof result === 'string' ? { html: result } : result, options.json))
        break
      }
      case 'generate': {
        if (!args[0] || !args[1]) { console.error('Error: project ID and prompt required'); process.exit(1) }
        const isTTY = process.stderr.isTTY
        if (isTTY) process.stderr.write('Generating...')
        const result = await stitch.generateScreen(args[0], args[1], options)
        if (isTTY) process.stderr.write('\r\x1b[K')
        console.log(formatScreen(typeof result === 'string' ? { html: result } : result, options.json))
        break
      }
      case 'edit': {
        if (!args[0] || !args[1] || !args[2]) {
          console.error('Error: project ID, screen IDs (comma-separated), and prompt required')
          process.exit(1)
        }
        const screenIds = args[1].split(',')
        const isTTY = process.stderr.isTTY
        if (isTTY) process.stderr.write('Editing...')
        const result = await stitch.editScreens(args[0], screenIds, args[2], options)
        if (isTTY) process.stderr.write('\r\x1b[K')
        console.log(options.json ? JSON.stringify(result, null, 2) : result)
        break
      }
      case 'variants': {
        if (!args[0] || !args[1] || !args[2]) {
          console.error('Error: project ID, screen IDs (comma-separated), and prompt required')
          process.exit(1)
        }
        const screenIds = args[1].split(',')
        const result = await stitch.generateVariants(args[0], screenIds, args[2], options)
        console.log(options.json ? JSON.stringify(result, null, 2) : result)
        break
      }
      case 'download': {
        if (!args[0] || !args[1]) { console.error('Error: project ID and screen ID required'); process.exit(1) }
        const filepath = await stitch.downloadScreen(args[0], args[1], options.output || null, options)
        console.error(`Saved to ${filepath}`)
        break
      }
      default:
        console.error(`Unknown command: ${command}\nRun "stitch --help" for usage.`)
        process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

// Only run main when executed directly (not imported for testing)
const isMain = process.argv[1] && (process.argv[1].endsWith('/stitch.js') || process.argv[1].endsWith('\\stitch.js'))
if (isMain) {
  main()
}
