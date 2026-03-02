# stitch

AI UI design from your terminal. A zero-dependency CLI for [Google Stitch](https://stitch.withgoogle.com) via the official MCP server.

```
npm i -g stitch-terminal
```

Requires Node.js 18+ (uses built-in `fetch`). No dependencies.

## Quick start

```bash
# Set your API key (get one from stitch.withgoogle.com → Settings → API Keys)
export STITCH_API_KEY=your-key-here

# List your projects
stitch projects

# Generate a new screen
stitch generate 123456 "A login page with Google OAuth"

# Download it
stitch download 123456 abc123 -o login.html
```

## Authentication

Three methods, tried in order:

1. **Google ADC** (recommended for Google Cloud users)
   ```bash
   gcloud auth application-default login
   ```
2. **API key flag**
   ```bash
   stitch projects --api-key YOUR_KEY
   ```
3. **Environment variable**
   ```bash
   export STITCH_API_KEY=YOUR_KEY
   ```

## Commands

```
stitch projects                          List all projects
stitch project <id>                      Get project details
stitch screens <project-id>              List screens in a project
stitch screen <project-id> <screen-id>   Get screen details (HTML/CSS)
stitch generate <project-id> "prompt"    Generate a new screen from text
stitch edit <project-id> <screen-ids> "prompt"  Edit existing screens
stitch variants <project-id> <screen-ids> "prompt"  Generate design variants
stitch download <project-id> <screen-id> [-o file]  Download screen HTML to file
```

## Options

```
--api-key <key>      Stitch API key (or STITCH_API_KEY env)
--device <type>      Device type: mobile, desktop, tablet (default: desktop)
--model <id>         Model: pro, flash (default: flash)
--json               Output raw JSON
-o, --output <file>  Output file path (for download command)
--help, -h           Show this help
--version, -v        Show version
```

## Examples

```bash
# Generate a mobile dashboard
stitch generate 123456 "Dashboard with analytics charts" --device mobile --model pro

# Pipe screen HTML to a file
stitch screen 123456 abc123 > page.html

# Download to a specific file
stitch download 123456 abc123 -o dashboard.html

# Machine-readable output
stitch screens 123456 --json | jq '.[] | .id'

# Edit multiple screens
stitch edit 123456 screen1,screen2 "Make the buttons larger and blue"

# Generate variants
stitch variants 123456 screen1 "Try a darker color scheme"
```

## How it works

Stitch speaks [MCP](https://modelcontextprotocol.io) (Model Context Protocol) over Streamable HTTP. This CLI talks directly to `stitch.googleapis.com/mcp` using `fetch()` — no SDK, no bundler, no dependencies.

```
stitch CLI → JSON-RPC 2.0 → POST stitch.googleapis.com/mcp → result
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `STITCH_API_KEY` | Default API key |
| `STITCH_MCP_URL` | Override MCP endpoint (default: `https://stitch.googleapis.com/mcp`) |

## License

MIT
