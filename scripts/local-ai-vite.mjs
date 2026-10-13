const AI_REQUEST_LIMIT = 500_000;
const API_PATH = "/api/design-assistant";

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export function localAiVitePlugin() {
  return {
    name: "secure-design-studio-local-ai",
    apply: "serve",
    configureServer(server) {
      let logPath;
      const writeLog = (...values) => {
        const content = values[0] === "AI interaction content";
        if (content && process.env.SDS_AI_DEBUG_CONTENT !== "1") return;
        if (process.env.SDS_AI_DEBUG === "1") {
          if (!logPath) {
            logPath = join(tmpdir(), `sds-ai-debug-${randomUUID()}.jsonl`);
            console.error(`AI debug log file: ${logPath}`);
          }
          appendFileSync(logPath, JSON.stringify({
            timestamp: new Date().toISOString(), kind: content ? "content" : "diagnostics", values,
          }) + "\n", { encoding: "utf8", mode: 0o600 });
        }
        if (!content) console.error(...values);
      };
      server.middlewares.use(async (request, response, next) => {
        let pathname;
        try {
          pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        } catch {
          return next();
        }
        if (pathname !== API_PATH) return next();

        try {
          let body;
          if (request.method === "POST") {
            const chunks = [];
            let size = 0;
            for await (const chunk of request) {
              size += chunk.length;
              if (size > AI_REQUEST_LIMIT) {
                sendJson(response, 413, { error: "The selected model context is too large to analyze." });
                return;
              }
              chunks.push(chunk);
            }
            const text = Buffer.concat(chunks).toString("utf8");
            try { body = JSON.parse(text); } catch { body = text; }
          }

          const { default: handler } = await server.ssrLoadModule("/api/design-assistant/index.ts");
          const context = {
            res: undefined,
            log: { error: writeLog },
          };
          await handler(context, {
            method: request.method,
            headers: request.headers,
            body,
          });
          const result = context.res;
          if (!result || typeof result.status !== "number") {
            sendJson(response, 500, { error: "Design Assistant could not process the request." });
            return;
          }
          response.statusCode = result.status;
          for (const [name, value] of Object.entries(result.headers ?? {})) {
            response.setHeader(name, value);
          }
          if (result.body === undefined) response.end();
          else if (typeof result.body === "string") response.end(result.body);
          else response.end(JSON.stringify(result.body));
        } catch {
          if (!response.headersSent) {
            sendJson(response, 500, { error: "Design Assistant could not process the request." });
          } else {
            response.end();
          }
        }
      });
    },
  };
}
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
