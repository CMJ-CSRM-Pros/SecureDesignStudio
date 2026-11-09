import type { AzureFunction, Context, HttpRequest } from "@azure/functions";
// @azure/identity 4.x reads globalThis.crypto. On older Node minors
// the global isn't present; on Node 19+ it's defined as a
// non-writable getter, so we install our own only when missing and
// guard the assignment so we never fail the module load.
import { webcrypto } from "crypto";
try {
  if (typeof (globalThis as { crypto?: unknown }).crypto === "undefined") {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      writable: false,
      configurable: true,
    });
  }
} catch {
  // Some hosts make globalThis.crypto a non-writable, non-configurable
  // accessor — in which case it's already defined and we don't need
  // to do anything.
}
import { DefaultAzureCredential } from "@azure/identity";
import { WebPubSubServiceClient } from "@azure/web-pubsub";

// We authenticate to Web Pub/Sub via Azure AD using the SWA's
// system-assigned managed identity (granted "Web PubSub Service
// Owner" on the resource). The subscription policy disables
// access-key-based auth ("disableLocalAuth: true"), so JWTs signed
// with the connection-string access key are silently rejected at the
// WebSocket upgrade. AAD tokens are not subject to that restriction.
//
// In local dev (e.g. `func start` outside Azure), DefaultAzureCredential
// falls back to az-cli credentials, environment variables, etc.
//
// WEB_PUBSUB_ENDPOINT must be the resource URL, e.g.
//   https://<name>.webpubsub.azure.com
const endpoint = process.env.WEB_PUBSUB_ENDPOINT;
// The deployed hub still uses the pre-rename identifier. Keep it as the
// compatibility default until that Azure resource is migrated explicitly.
const hub =
  process.env.SECURE_DESIGN_STUDIO_WEB_PUBSUB_HUB ||
  process.env.WEB_PUBSUB_HUB ||
  "privsec";
const connectionString = process.env.WEB_PUBSUB_CONNECTION_STRING;

// Lazily construct the service client and reuse it across warm
// invocations. Falling back to the connection string only when
// WEB_PUBSUB_ENDPOINT isn't set lets us migrate environments
// individually without breaking either path.
let service: WebPubSubServiceClient | null = null;
function getService(): WebPubSubServiceClient | null {
  if (service) return service;
  if (endpoint) {
    service = new WebPubSubServiceClient(
      endpoint,
      new DefaultAzureCredential(),
      hub
    );
  } else if (connectionString) {
    service = new WebPubSubServiceClient(connectionString, hub);
  }
  return service;
}

// Room ids must look like ours (uid("room") -> room_xxxxxxxxxxxx). We
// intentionally allow [A-Za-z0-9_-]{6,64} so callers picking their own
// names still work, but we never echo arbitrary input back into the
// Web Pub/Sub roles list without validation.
const ROOM_RE = /^[A-Za-z0-9_-]{6,64}$/;

// Headers we emit on every response (success or error) so that the
// single-file build of the diagrammer (origin: file://) and any other
// origin can call the endpoint cross-origin. The endpoint never reads
// cookies — it only ever returns short-lived, group-scoped tokens —
// so wildcard CORS is appropriate. We deliberately omit
// Access-Control-Allow-Credentials for the same reason.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  // Some clients/proxies may issue a CORS preflight even for simple
  // GETs. Respond cheaply.
  if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }

  const svc = getService();
  if (!svc) {
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: {
        error:
          "Server is not configured for collaboration. Set WEB_PUBSUB_ENDPOINT (and grant the SWA's managed identity 'Web PubSub Service Owner') in the application settings.",
      },
    };
    return;
  }

  const room = String(req.query.room ?? "").trim();
  if (!ROOM_RE.test(room)) {
    context.res = {
      status: 400,
      headers: CORS_HEADERS,
      body: { error: "Invalid room id." },
    };
    return;
  }

  // Identify the caller from the SWA-managed principal header when
  // available so messages from this connection are attributable. Falls
  // back to a random userId for anonymous SWAs and for cross-origin
  // callers (single-file build, third-party hosts) that don't have
  // access to the SWA principal cookie.
  let userId: string | undefined;
  const principalHeader = req.headers["x-ms-client-principal"];
  if (typeof principalHeader === "string" && principalHeader.length > 0) {
    try {
      const decoded = Buffer.from(principalHeader, "base64").toString("utf8");
      const parsed = JSON.parse(decoded) as {
        userDetails?: string;
        userId?: string;
      };
      userId = parsed.userId || parsed.userDetails;
    } catch {
      // Ignore — we'll just issue an anonymous token.
    }
  }

  try {
    const token = await svc.getClientAccessToken({
      userId,
      roles: [
        `webpubsub.joinLeaveGroup.${room}`,
        `webpubsub.sendToGroup.${room}`,
      ],
      expirationTimeInMinutes: 60,
    });
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { url: token.url, room },
    };
  } catch (err) {
    context.log.error("Failed to issue Web Pub/Sub token", err);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: {
        error: "Failed to issue token.",
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      },
    };
  }
};

export default httpTrigger;
