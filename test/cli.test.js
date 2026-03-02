import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN = join(__dirname, '..', 'bin', 'stitch.js')
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

// Import parseArgs for unit tests
const { parseArgs } = await import('../bin/stitch.js')

// ─── parseArgs unit tests ───────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses projects command', () => {
    const result = parseArgs(['projects'])
    assert.deepEqual(result, { command: 'projects', args: [], options: {} })
  })

  it('parses project <id>', () => {
    const result = parseArgs(['project', '123'])
    assert.deepEqual(result, { command: 'project', args: ['123'], options: {} })
  })

  it('parses screens <project-id>', () => {
    const result = parseArgs(['screens', '123'])
    assert.deepEqual(result, { command: 'screens', args: ['123'], options: {} })
  })

  it('parses screen <project-id> <screen-id>', () => {
    const result = parseArgs(['screen', '123', 'abc'])
    assert.deepEqual(result, { command: 'screen', args: ['123', 'abc'], options: {} })
  })

  it('parses generate <project-id> <prompt>', () => {
    const result = parseArgs(['generate', '123', 'A login page'])
    assert.deepEqual(result, { command: 'generate', args: ['123', 'A login page'], options: {} })
  })

  it('parses --api-key before command', () => {
    const result = parseArgs(['--api-key', 'mykey', 'projects'])
    assert.deepEqual(result, { command: 'projects', args: [], options: { apiKey: 'mykey' } })
  })

  it('parses --json flag', () => {
    const result = parseArgs(['projects', '--json'])
    assert.equal(result.command, 'projects')
    assert.equal(result.options.json, true)
  })

  it('parses --device and --model options', () => {
    const result = parseArgs(['generate', '123', 'test', '--device', 'mobile', '--model', 'pro'])
    assert.equal(result.command, 'generate')
    assert.equal(result.options.device, 'mobile')
    assert.equal(result.options.model, 'pro')
  })

  it('parses --help as help command', () => {
    const result = parseArgs(['--help'])
    assert.deepEqual(result, { command: 'help', args: [], options: {} })
  })

  it('parses -h as help command', () => {
    const result = parseArgs(['-h'])
    assert.deepEqual(result, { command: 'help', args: [], options: {} })
  })

  it('parses --version as version command', () => {
    const result = parseArgs(['--version'])
    assert.deepEqual(result, { command: 'version', args: [], options: {} })
  })

  it('parses -v as version command', () => {
    const result = parseArgs(['-v'])
    assert.deepEqual(result, { command: 'version', args: [], options: {} })
  })

  it('parses download with -o flag', () => {
    const result = parseArgs(['download', '123', 'abc', '-o', 'out.html'])
    assert.deepEqual(result, { command: 'download', args: ['123', 'abc'], options: { output: 'out.html' } })
  })

  it('defaults to help when no args given', () => {
    const result = parseArgs([])
    assert.deepEqual(result, { command: 'help', args: [], options: {} })
  })
})

// ─── spawnSync integration tests ────────────────────────────────────────

describe('CLI integration', () => {
  it('--version outputs version from package.json', () => {
    const result = spawnSync('node', [BIN, '--version'], { encoding: 'utf8' })
    assert.equal(result.stdout.trim(), pkg.version)
  })

  it('--help shows usage text', () => {
    const result = spawnSync('node', [BIN, '--help'], { encoding: 'utf8' })
    assert.ok(result.stdout.includes('stitch'), 'help should mention "stitch"')
    assert.ok(result.stdout.includes('Usage:'), 'help should include Usage section')
  })

  it('no args shows help text', () => {
    const result = spawnSync('node', [BIN], { encoding: 'utf8' })
    assert.ok(result.stdout.includes('stitch'), 'no-arg output should show help with "stitch"')
    assert.ok(result.stdout.includes('Usage:'), 'no-arg output should include Usage section')
  })

  it('unknown command shows error', () => {
    const result = spawnSync('node', [BIN, 'foobar'], { encoding: 'utf8' })
    assert.ok(result.stderr.includes('Unknown command'), 'should print unknown command error')
    assert.notEqual(result.status, 0, 'should exit with non-zero status')
  })
})
