import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { store } from "./store.js";
import type { ServerConfig } from "./types.js";

const BURST_POLL_INTERVAL_MS = 2000;

const sseClients = new Set<ServerResponse>();

function broadcastEvent(event: string, data: Record<string, unknown>) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

function findClaudePath(): string {
  const candidates = [
    process.env.CLAUDE_PATH,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "claude",
  ].filter(Boolean) as string[];
  return candidates[0];
}

function runClaudeCode(prompt: string): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    console.log("\nInvoking Claude Code...\n");

    const claudePath = findClaudePath();
    const child = spawn(claudePath, ["--print", "--continue", "--permission-mode", "bypassPermissions", prompt], {
      stdio: ["inherit", "inherit", "inherit"],
      env: process.env,
      cwd: process.cwd(),
      shell: claudePath === "claude",
    });

    child.on("close", (code) => {
      console.log(`\nClaude Code finished (exit code: ${code})\n`);
      resolve({ success: code === 0 });
    });

    child.on("error", (err) => {
      console.error("\nFailed to run Claude Code:", err.message);
      resolve({ success: false });
    });
  });
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
        res.end(JSON.stringify({ status: "ok", mode: "burst", pending_prompts: store.count() }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ status: "ok", mode: "burst" })}\n\n`);
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

            store.add({ prompt, url: pageUrl || "", pathname: pagePath || "/" });
            console.log(`Received prompt from ${pagePath} (${prompt.length} chars)`);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
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
        console.error(`Port ${port} is already in use.`);
        reject(new Error(`Port ${port} in use`));
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      if (verbose) {
        console.log(`HTTP server listening on port ${port}`);
      }
      resolve();
    });
  });
}

async function burstLoop(): Promise<void> {
  while (true) {
    const count = store.count();

    if (count > 0) {
      console.log(`\nFound ${count} prompt(s). Collecting batch...`);
      broadcastEvent("status", { status: "collecting" });

      // Wait for batch to accumulate
      for (let i = 10; i > 0; i--) {
        process.stdout.write(`\rProcessing in ${i}s... (${store.count()} prompt${store.count() !== 1 ? "s" : ""})  `);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      console.log("\rBatch window closed.                              ");

      const prompts = store.getAll();

      if (prompts.length > 0) {
        console.log(`\nProcessing ${prompts.length} prompt(s)`);

        broadcastEvent("status", { status: "processing" });

        // Combine all prompts
        const combined = prompts
          .map((p, i) => `## Prompt ${i + 1} (from ${p.pathname})\n\n${p.prompt}`)
          .join("\n\n---\n\n");

        const fullPrompt = `You have received ${prompts.length} prompt(s) from playground files. Process each one:\n\n${combined}`;

        const result = await runClaudeCode(fullPrompt);

        store.clear();
        broadcastEvent("status", { status: "done" });

        if (result.success) {
          console.log("Batch complete. Prompts cleared.\n");
        } else {
          console.log("Claude encountered an issue, but prompts have been cleared.\n");
        }

        broadcastEvent("status", { status: "ready" });
        console.log("Watching for more prompts...\n");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, BURST_POLL_INTERVAL_MS));
  }
}

export async function startBurstMode(config: Partial<ServerConfig> = {}): Promise<void> {
  const { httpPort = 4242, verbose = false } = config;
  await createHttpServer(httpPort, verbose);
  await burstLoop();
}
