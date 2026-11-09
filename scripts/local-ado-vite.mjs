import { ADO_LOCAL_ORIGIN, ADO_MAX_REQUEST_BYTES } from "../shared/adoContract.ts";

const apiPath = "/api/ado-work-items";
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function sendJson(response, status, error) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify({ error }));
}

export function localAdoVitePlugin() {
  return {
    name: "secure-design-studio-local-ado",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        let url;
        try {
          url = new URL(request.url ?? "/", ADO_LOCAL_ORIGIN);
        } catch {
          sendJson(response, 400, "Invalid local ADO request URL.");
          return;
        }
        if (url.pathname !== apiPath) return next();
        if (url.origin !== ADO_LOCAL_ORIGIN ||
          !loopbackAddresses.has(request.socket?.remoteAddress) ||
          request.headers.host !== "localhost:5173" || request.headers.origin !== ADO_LOCAL_ORIGIN ||
          request.headers["x-forwarded-host"] !== undefined || request.headers["x-forwarded-proto"] !== undefined ||
          (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin")) {
          sendJson(response, 403, "Local ADO submission requires a same-origin loopback request.");
          return;
        }
        if (request.method !== "POST") {
          sendJson(response, 405, "Only POST is supported.");
          return;
        }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) {
          sendJson(response, 415, "Use application/json.");
          return;
        }
        try {
          const length = request.headers["content-length"];
          if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > ADO_MAX_REQUEST_BYTES)) {
            sendJson(response, 413, "ADO request exceeds the size limit.");
            return;
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += Buffer.byteLength(chunk);
            if (size > ADO_MAX_REQUEST_BYTES) {
              sendJson(response, 413, "ADO request exceeds the size limit.");
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const { localAdoWorkItems } = await server.ssrLoadModule("/api/ado-work-items/index.ts");
          const context = { res: undefined };
          await localAdoWorkItems(context, {
            method: request.method, url: `${ADO_LOCAL_ORIGIN}${apiPath}`,
            headers: request.headers, rawBody,
          });
          const result = context.res;
          if (!result || typeof result.status !== "number") throw new Error("Missing local ADO response.");
          response.statusCode = result.status;
          for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
          response.end(JSON.stringify(result.body));
        } catch {
          if (!response.headersSent) sendJson(response, 500, "Local ADO relay failed. Reconcile any creation attempt in ADO before retrying.");
          else response.end();
        }
      });
    },
  };
}
