import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { store } from "./store.js";
import type { ServerConfig } from "./types.js";

const DEFAULT_HTTP_PORT = 4242;

const sseClients = new Set<ServerResponse>();

function broadcastEvent(event: string, data: Record<string, unknown>) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

function createHttpServer(port: number, verbose: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", pending_prompts: store.count() }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ status: "ok" })}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "POST" && url.pathname === "/prompt") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            const { prompt, url: pageUrl, pathname: pagePath } = payload;

            if (!prompt || typeof prompt !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "prompt is required" }));
              return;
            }

            const entry = store.add({
              prompt,
              url: pageUrl || "",
              pathname: pagePath || "/",
            });

            if (verbose) {
              console.error(`[playground-sync] Received prompt from ${pagePath} (${prompt.length} chars)`);
            }

            broadcastEvent("status", { status: "received", id: entry.id });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, id: entry.id }));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[playground-sync] Port ${port} is already in use.`);
        resolve();
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      console.error(`[playground-sync] HTTP server listening on http://localhost:${port}`);
      resolve();
    });
  });
}

function createMcpServer(verbose: boolean): Server {
  const server = new Server(
    { name: "playground-sync", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "playground_get_prompt",
        description:
          "Get the oldest pending prompt from a playground. Returns the prompt text, source URL, and pathname. Use this when a playground has sent a prompt for processing.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "playground_list_pending",
        description:
          "List all pending prompts from playgrounds. Shows how many prompts are waiting and their source pages.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "playground_clear",
        description:
          "Clear all pending prompts after processing. Use this after you've acted on the prompts.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "playground_watch",
        description:
          "Watch for incoming prompts from a playground. Blocks until a prompt arrives or the timeout expires. Call this after generating and opening a playground so you automatically receive the user's prompt when they click 'Send to Claude'. Returns the prompt when it arrives.",
        inputSchema: {
          type: "object" as const,
          properties: {
            timeout_seconds: {
              type: "number",
              description: "How long to wait for a prompt (default: 300, max: 600).",
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case "playground_get_prompt": {
        const prompt = store.getOldest();

        if (!prompt) {
          return {
            content: [{ type: "text", text: "No pending prompts from playgrounds." }],
          };
        }

        broadcastEvent("status", { status: "processing" });

        if (verbose) {
          console.error(`[playground-sync] Delivering prompt ${prompt.id} from ${prompt.pathname}`);
        }

        return {
          content: [{
            type: "text",
            text: `# Playground Prompt\n\n**Source:** ${prompt.url || prompt.pathname}\n**Received:** ${new Date(prompt.timestamp).toLocaleTimeString()}\n\n---\n\n${prompt.prompt}`,
          }],
        };
      }

      case "playground_list_pending": {
        const all = store.getAll();

        if (all.length === 0) {
          return {
            content: [{ type: "text", text: "No pending prompts." }],
          };
        }

        const list = all
          .map((p, i) => `${i + 1}. ${p.pathname} (${p.prompt.length} chars, ${new Date(p.timestamp).toLocaleTimeString()})`)
          .join("\n");

        return {
          content: [{ type: "text", text: `Pending prompts:\n${list}` }],
        };
      }

      case "playground_clear": {
        const count = store.count();
        store.clear();
        broadcastEvent("status", { status: "done" });

        return {
          content: [{ type: "text", text: count > 0 ? `Cleared ${count} prompt(s).` : "No prompts to clear." }],
        };
      }

      case "playground_watch": {
        const toolArgs = request.params.arguments as Record<string, unknown> | undefined;
        const timeoutSec = Math.min(
          typeof toolArgs?.timeout_seconds === "number" ? toolArgs.timeout_seconds : 300,
          600
        );

        if (verbose) {
          console.error(`[playground-sync] Watching for prompts (timeout: ${timeoutSec}s)`);
        }

        // Poll every second until a prompt arrives or timeout
        const deadline = Date.now() + timeoutSec * 1000;
        while (Date.now() < deadline) {
          const prompt = store.getOldest();
          if (prompt) {
            broadcastEvent("status", { status: "processing" });
            store.removeOldest();

            if (verbose) {
              console.error(`[playground-sync] Watch: received prompt ${prompt.id} from ${prompt.pathname}`);
            }

            return {
              content: [{
                type: "text",
                text: `# Playground Prompt\n\n**Source:** ${prompt.url || prompt.pathname}\n**Received:** ${new Date(prompt.timestamp).toLocaleTimeString()}\n\n---\n\n${prompt.prompt}`,
              }],
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        return {
          content: [{ type: "text", text: "Watch timed out — no prompts received. The user may not have clicked 'Send to Claude' yet." }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

export async function startServer(config: Partial<ServerConfig> = {}): Promise<void> {
  const { httpPort = DEFAULT_HTTP_PORT, verbose = false } = config;

  await createHttpServer(httpPort, verbose);

  const mcpServer = createMcpServer(verbose);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error("[playground-sync] MCP server connected via stdio");
}

export { broadcastEvent };
