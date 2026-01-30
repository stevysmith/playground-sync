import { startServer } from "./server.js";
import { startBurstMode } from "./burst.js";

const args = process.argv.slice(2);

const portIndex = args.indexOf("--port");
const burstMode = args.includes("--burst");
const defaultPort = 4242;
const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : defaultPort;
const verbose = args.includes("--verbose") || args.includes("-v");
const helpRequested = args.includes("--help") || args.includes("-h");

if (helpRequested) {
  console.log(`
Playground Sync Server

Usage:
  node dist/cli.js [options]

Options:
  --port <number>   HTTP server port (default: 4242)
  --verbose, -v     Enable verbose logging
  --burst           Auto-process prompts by spawning Claude CLI
  --help, -h        Show this help message

Modes:
  Default (MCP):    Runs as MCP server for Claude Code integration
  Burst mode:       Standalone loop that auto-invokes Claude
`);
  process.exit(0);
}

if (burstMode) {
  console.log(`
  PLAYGROUND SYNC — BURST MODE
  HTTP server: http://localhost:${port}
  Batch delay: 10 seconds
  Waiting for prompts... (Ctrl+C to stop)
`);

  startBurstMode({ httpPort: port, verbose }).catch((err) => {
    console.error("[playground-sync] Fatal error:", err);
    process.exit(1);
  });
} else {
  console.error(`[playground-sync] HTTP: http://localhost:${port} | MCP: stdio`);

  startServer({ httpPort: port, verbose }).catch((err) => {
    console.error("[playground-sync] Fatal error:", err);
    process.exit(1);
  });
}
