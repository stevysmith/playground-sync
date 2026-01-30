# Playground Sync

Interactive HTML playgrounds with live sync to Claude Code. Generate visual explorers, tweak controls in the browser, and send prompts directly back to Claude — no copy-paste needed.

## What it does

1. Ask Claude to make a playground (e.g. "make a playground for card shadow styles")
2. Claude generates a self-contained HTML file and opens it in your browser
3. You adjust controls, see a live preview, and the prompt updates
4. Click **"Send to Claude"** — the prompt goes straight to Claude
5. Claude receives it and acts on it automatically

If the sync server isn't running, the button gracefully falls back — you can always copy-paste instead.

## Installation

```
/plugin marketplace add stevysmith/playground-sync
/plugin install playground-skill@playground-sync
/plugin install playground-sync@playground-sync
```

Both plugins are needed:
- **playground-skill** — the skill that gives Claude the templates to generate playgrounds
- **playground-sync** — the MCP server that transports prompts from browser to Claude

## Playground types

- **Design playground** — components, layouts, spacing, color, typography
- **Data explorer** — SQL builders, API designers, regex, pipelines
- **Concept map** — learning, knowledge gaps, relationship mapping
- **Document critique** — approve/reject/comment workflow for docs
- **Diff review** — git diffs with line-by-line commenting
- **Code map** — codebase architecture, component relationships

## How it works

```
Browser (playground HTML)
    │
    │  POST /prompt
    ▼
HTTP server (localhost:4242)
    │
    │  in-memory store
    │
    ▼
MCP server (stdio)  ◄──  Claude Code
```

The playground HTML posts prompts to a local HTTP server. Claude connects to that same server via MCP and calls `playground_watch` to wait for prompts. When one arrives, the tool returns it and Claude acts on it.

## Burst mode

For hands-free operation, run the server in burst mode:

```bash
cd plugins/playground-sync/server
node dist/cli.js --burst
```

This polls for incoming prompts, batches any that arrive within a 10-second window, and spawns `claude` to process them automatically.

## Development

```bash
cd plugins/playground-sync/server
npm install
npm run build
```
