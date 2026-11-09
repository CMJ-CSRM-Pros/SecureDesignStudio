import type { AzureFunction, Context, HttpRequest } from "@azure/functions";
import {
  ADO_ERROR_BODY_BYTES, ADO_LOCAL_ORIGIN, ADO_MAX_REQUEST_BYTES, adoEndpoint, adoErrorFieldNames,
  adoItemUrl, adoPatch, isAdoRecord, normalizeAdoConfiguration, normalizeAdoDraft, type WorkItemType,
} from "../../shared/adoContract";

const responseHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function respond(context: Context, status: number, body: unknown): void {
  context.res = { status, headers: responseHeaders, body };
}

function fail(context: Context, status: number, error: string, uncertain = false, fields?: string[]): void {
  respond(context, status, { error, uncertain, ...(fields ? { fields } : {}) });
}

async function validationFields(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ADO_ERROR_BODY_BYTES) {
        await reader.cancel();
        return [];
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return adoErrorFieldNames(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return [];
  } finally {
    reader.releaseLock();
  }
}

function header(req: HttpRequest, name: string): string | undefined {
  const value = Object.entries(req.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  return typeof value === "string" ? value : undefined;
}

function sameOrigin(req: HttpRequest, local: boolean): boolean {
  try {
    const origin = header(req, "origin");
    if (!origin) return false;
    const parsedOrigin = new URL(origin);
    if (local) {
      return origin === ADO_LOCAL_ORIGIN && new URL(req.url).origin === ADO_LOCAL_ORIGIN &&
        header(req, "host") === "localhost:5173" &&
        header(req, "x-forwarded-host") === undefined && header(req, "x-forwarded-proto") === undefined &&
        (!header(req, "sec-fetch-site") || header(req, "sec-fetch-site") === "same-origin");
    }
    if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin) return false;
    const requestUrl = new URL(req.url);
    const forwardedHost = header(req, "x-forwarded-host");
    const expectedHost = forwardedHost ?? requestUrl.host;
    if (!expectedHost || /[\/\\@?#,\s]/.test(expectedHost)) return false;
    const protocol = header(req, "x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
    if (protocol !== "https") return false;
    const site = header(req, "sec-fetch-site");
    // SWA supplies the external host through its proxy. These headers are only
    // compared to Origin, never used to route an outbound request or grant ADO access.
    return parsedOrigin.host === expectedHost.toLowerCase() && (!site || site === "same-origin");
  } catch {
    return false;
  }
}

async function handleAdoWorkItems(context: Context, req: HttpRequest, local: boolean): Promise<void> {
  if (!local && process.env.SDS_ADO_RELAY_ENABLED !== "1") {
    fail(context, 503, "ADO submission relay is unavailable. The host administrator must explicitly enable it.");
    return;
  }
  if (req.method !== "POST") {
    fail(context, 405, "Only POST is supported.");
    return;
  }
  if (!sameOrigin(req, local)) {
    fail(context, 403, local ? "Local ADO submission requires the exact localhost:5173 origin." :
      "ADO submission requires a same-origin HTTPS request.");
    return;
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(req, "content-type") ?? "")) {
    fail(context, 415, "Use application/json.");
    return;
  }
  const authorization = header(req, "authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization) || authorization.length > 32_768) {
    fail(context, 401, "A caller Azure DevOps bearer token is required.");
    return;
  }
  let configuration;
  let patch;
  let workItemType: WorkItemType;
  let validateOnly: boolean;
  try {
    const length = header(req, "content-length");
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > ADO_MAX_REQUEST_BYTES)) {
      fail(context, 413, "ADO request exceeds the size limit.");
      return;
    }
    const raw = typeof req.rawBody === "string" ? req.rawBody :
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (typeof raw !== "string") throw new Error();
    if (Buffer.byteLength(raw, "utf8") > ADO_MAX_REQUEST_BYTES) {
      fail(context, 413, "ADO request exceeds the size limit.");
      return;
    }
    const body: unknown = JSON.parse(raw);
    if (!isAdoRecord(body) || Object.keys(body).some(key =>
      !["configuration", "draft", "validateOnly"].includes(key)) || typeof body.validateOnly !== "boolean") {
      throw new Error();
    }
    configuration = normalizeAdoConfiguration(body.configuration);
    const draft = normalizeAdoDraft(body.draft);
    patch = adoPatch(draft, configuration);
    workItemType = draft.workItemType;
    validateOnly = body.validateOnly;
  } catch {
    fail(context, 400, "Invalid ADO destination, draft or field defaults.");
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    // The caller's token is forwarded only to this fixed ADO Services host.
    // There is no service identity, credential lookup, exchange, cookie or retry.
    const response = await fetch(adoEndpoint(configuration, workItemType, validateOnly), {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json-patch+json" },
      body: JSON.stringify(patch),
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      const definite = [400, 401, 403, 404, 405, 409, 410, 412, 413, 415, 422, 429].includes(response.status);
      const fields = validateOnly && [400, 422].includes(response.status) ?
        await validationFields(response) : undefined;
      fail(context, definite ? response.status : 502,
        definite ? `Azure DevOps rejected the request (HTTP ${response.status}).` :
          "Azure DevOps did not confirm the operation. Reconcile before retrying creation.",
        !validateOnly && !definite, fields);
      return;
    }
    if (response.status !== 200 && response.status !== 201) throw new Error();
    const payload: unknown = await response.json();
    if (validateOnly) {
      if (!isAdoRecord(payload) || !isAdoRecord(payload.fields) ||
        (payload.id !== undefined && !Number.isSafeInteger(payload.id)) ||
        (payload.rev !== undefined && (!Number.isSafeInteger(payload.rev) || (payload.rev as number) < 0))) {
        throw new Error();
      }
      respond(context, 200, { validated: true });
      return;
    }
    if (!isAdoRecord(payload) || !Number.isSafeInteger(payload.id) || (payload.id as number) <= 0) {
      throw new Error();
    }
    const id = payload.id as number;
    respond(context, 200, { id, url: adoItemUrl(configuration, id) });
  } catch {
    fail(context, 502,
      validateOnly ? "Azure DevOps validation could not be completed." :
        "Azure DevOps creation outcome is unknown. Reconcile in ADO before trying again.",
      !validateOnly);
  } finally {
    clearTimeout(timeout);
  }
}

// Only the opt-in loopback Vite adapter imports this entrypoint; no HTTP binding exposes it.
export const localAdoWorkItems: AzureFunction = (context: Context, req: HttpRequest) =>
  handleAdoWorkItems(context, req, true);

const adoWorkItems: AzureFunction = (context: Context, req: HttpRequest) =>
  handleAdoWorkItems(context, req, false);
export default adoWorkItems;
