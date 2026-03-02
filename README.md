# stitch

**AI UI design from your terminal.**

A zero-dependency CLI for [Google Stitch](https://stitch.withgoogle.com) that generates production-ready HTML/CSS from text prompts via the official MCP server.

Website: [stitch.akarispeed.xyz](https://stitch.akarispeed.xyz)

---

## Install

```bash
npm install -g stitch-terminal
```

## Quick Start

```bash
# 1. Authenticate with Google
stitch login

# 2. Generate a screen from a text prompt
stitch generate PROJECT_ID "A dashboard with sidebar navigation and analytics charts"

# 3. Download the generated HTML
stitch download PROJECT_ID SCREEN_ID -o dashboard.html
```

## Commands

| Command | Description |
|---------|-------------|
| `stitch login` | Authenticate with Google OAuth (opens browser) |
| `stitch logout` | Remove saved credentials |
| `stitch projects` | List all projects |
| `stitch project <id>` | Get project details |
| `stitch screens <project-id>` | List screens in a project |
| `stitch screen <project-id> <screen-id>` | Get screen details (HTML/CSS) |
| `stitch generate <project-id> "prompt"` | Generate a new screen from a text prompt |
| `stitch edit <project-id> <screen-ids> "prompt"` | Edit existing screens (comma-separated IDs) |
| `stitch variants <project-id> <screen-ids> "prompt"` | Generate design variants of existing screens |
| `stitch download <project-id> <screen-id> [-o file]` | Download screen HTML to a local file |

### Options

| Flag | Description |
|------|-------------|
| `--api-key <key>` | Stitch API key (or set `STITCH_API_KEY` env var) |
| `--device <type>` | Target device: `desktop`, `mobile`, `tablet` (default: `desktop`) |
| `--model <id>` | AI model: `flash`, `pro` (default: `flash`) |
| `--json` | Output raw JSON instead of formatted text |
| `-o, --output <file>` | Output file path (for `download` command) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Authentication

Three methods are supported, resolved in this order:

### 1. OAuth Login (recommended)

```bash
stitch login
```

Opens your browser for Google sign-in using PKCE. Credentials are saved to `~/.config/stitch-cli/credentials.json` and automatically refreshed on subsequent commands. Log out with `stitch logout`.

### 2. API Key

Pass directly as a flag:

```bash
stitch projects --api-key YOUR_KEY
```

Or set it as an environment variable:

```bash
export STITCH_API_KEY=YOUR_KEY
stitch projects
```

### 3. Application Default Credentials

If you use Google Cloud, ADC is picked up automatically:

```bash
gcloud auth application-default login
stitch projects
```

## Examples

```bash
# Generate a mobile landing page with the pro model
stitch generate 123456 "A SaaS landing page with pricing table" --device mobile --model pro

# Pipe screen HTML directly to a file
stitch screen 123456 abc123 > page.html

# Get screen IDs as plain text for scripting
stitch screens 123456 --json | jq -r '.[].id'

# Edit multiple screens at once
stitch edit 123456 screen1,screen2 "Make the buttons larger and use a blue color scheme"

# Generate alternative designs for an existing screen
stitch variants 123456 abc123 "Try a dark theme with more whitespace"

# Download with an explicit filename
stitch download 123456 abc123 -o checkout.html
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `STITCH_API_KEY` | Default API key for authentication |
| `STITCH_MCP_URL` | Override the MCP endpoint (default: `https://stitch.googleapis.com/mcp`) |
| `STITCH_CLIENT_ID` | Custom OAuth client ID |
| `STITCH_CLIENT_SECRET` | Custom OAuth client secret |

## How It Works

Google Stitch exposes its API through [MCP](https://modelcontextprotocol.io) (Model Context Protocol) over Streamable HTTP. This CLI is a lightweight MCP client that sends JSON-RPC 2.0 requests directly to the Stitch server using the built-in `fetch()` API -- no SDK, no bundler, no dependencies.

```
stitch CLI  -->  JSON-RPC 2.0 over HTTP  -->  stitch.googleapis.com/mcp  -->  result
```

The entire client is plain ESM JavaScript. Status messages (progress indicators, "Saved to ..." confirmations) are written to stderr, keeping stdout clean for piping and scripting.

## Requirements

- Node.js >= 18

No runtime dependencies. The CLI uses only Node.js built-in modules (`node:fs`, `node:http`, `node:crypto`, `node:os`, `node:path`, `node:child_process`, `node:url`) and the global `fetch` API available in Node 18+.

## License

MIT
