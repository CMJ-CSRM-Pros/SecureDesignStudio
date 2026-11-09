import type { AccountInfo, PublicClientApplication } from "@azure/msal-browser";
import {
  ADO_ERROR_BODY_BYTES, ADO_LOCAL_ORIGIN, ADO_MAX_REQUEST_BYTES, AdoRequestError, adoItemUrl, adoPatch, isAdoRecord,
  normalizeAdoAuthentication, normalizeAdoConfiguration, normalizeAdoDraft, safeAdoFieldNames, type AdoConfiguration, type AdoDraft,
} from "../shared/adoContract";
export {
  AdoRequestError, destinationKey, normalizeAdoConfiguration,
  type AdoConfiguration, type AdoDraft,
} from "../shared/adoContract";

const scope = "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation";

function deploymentAuthentication() {
  return normalizeAdoAuthentication(typeof __SDS_ADO_AUTH__ === "undefined" ? null : __SDS_ADO_AUTH__);
}

export function adoAuthenticationConfigured(): boolean {
  try {
    deploymentAuthentication();
    return true;
  } catch (error) {
    if (error instanceof AdoRequestError) return false;
    throw error;
  }
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
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return safeAdoFieldNames(isAdoRecord(payload) ? payload.fields : undefined);
  } catch {
    return [];
  } finally {
    reader.releaseLock();
  }
}

function hostedLocation(): URL {
  if (typeof __PS_LOCAL_ONLY__ === "undefined" || typeof window === "undefined") {
    throw new AdoRequestError("ADO submission is disabled in local or offline mode.");
  }
  const location = new URL(window.location.href);
  if (__PS_LOCAL_ONLY__) {
    if (typeof __SDS_LOCAL_ADO__ !== "undefined" && __SDS_LOCAL_ADO__ &&
      location.origin === ADO_LOCAL_ORIGIN && !location.username && !location.password) return location;
    throw new AdoRequestError("ADO submission is disabled in ordinary local mode. Use the explicitly configured dev:ado workflow.");
  }
  if (location.protocol !== "https:" || location.username || location.password ||
    /^(localhost|.*\.localhost|127(?:\.\d+){3}|\[::1\])$/i.test(location.hostname)) {
    throw new AdoRequestError("ADO submission requires the hosted HTTPS application.");
  }
  return location;
}

export function adoConnectionAllowed(): boolean {
  try {
    hostedLocation();
    return true;
  } catch (error) {
    if (error instanceof AdoRequestError) return false;
    throw error;
  }
}

export class AdoClient {
  private readonly config: AdoConfiguration;
  private client?: Promise<PublicClientApplication>;
  private account?: AccountInfo;

  constructor(config: AdoConfiguration) {
    this.config = normalizeAdoConfiguration(config);
  }

  private async application(): Promise<PublicClientApplication> {
    const location = hostedLocation();
    const authentication = deploymentAuthentication();
    if (!this.client) {
      this.client = (async () => {
        const { PublicClientApplication, BrowserCacheLocation } = await import("@azure/msal-browser");
        hostedLocation();
        const application = new PublicClientApplication({
          auth: {
            clientId: authentication.clientId,
            authority: `https://login.microsoftonline.com/${authentication.tenantId}`,
            // Register this exact hosted origin + pathname as an Entra SPA redirect.
            // Never copy the diagram's search parameters or room/key fragment.
            redirectUri: `${location.origin}${location.pathname}`,
            originCheck: true,
          },
          cache: { cacheLocation: BrowserCacheLocation.MemoryStorage },
          system: {
            // MSAL 5 otherwise requires a separate redirect-bridge page. This app
            // does not authenticate on load or consume OAuth response fragments.
            // Hosting must preserve that callback and allow same-origin popup polling.
            enableLegacyPolling: true,
            loggerOptions: { loggerCallback: () => {}, piiLoggingEnabled: false },
          },
        });
        await application.initialize();
        return application;
      })();
    }
    try {
      return await this.client;
    } catch {
      this.client = undefined;
      throw new AdoRequestError("ADO sign-in initialization failed.");
    }
  }

  async signIn(): Promise<void> {
    hostedLocation();
    // Undocked inspectors must route this explicit action to their hosting main window.
    if (window.top !== window.self || window.opener) {
      throw new AdoRequestError("Sign in from the application's hosting main window, not a popup or frame.");
    }
    try {
      const application = await this.application();
      hostedLocation();
      const result = await application.loginPopup({ scopes: [scope] });
      if (!result.account) throw new Error();
      this.account = result.account;
      application.setActiveAccount(result.account);
    } catch (error) {
      if (error instanceof AdoRequestError) throw error;
      throw new AdoRequestError("ADO sign-in was not completed. Use Connect to Azure DevOps to try again.");
    }
  }

  private async token(): Promise<string> {
    try {
      const application = await this.application();
      hostedLocation();
      const account = this.account ?? application.getActiveAccount();
      if (!account) throw new Error();
      const result = await application.acquireTokenSilent({ account, scopes: [scope] });
      if (!result.accessToken) throw new Error();
      return result.accessToken;
    } catch (error) {
      if (error instanceof AdoRequestError) throw error;
      // Interaction is exclusively user-initiated through signIn, never a POST fallback.
      throw new AdoRequestError("ADO authorization is unavailable. Use Connect to Azure DevOps before submitting.");
    }
  }

  async validate(draft: AdoDraft): Promise<void> {
    hostedLocation();
    await this.post(draft, true);
  }

  async create(draft: AdoDraft): Promise<{ id: number; url: string }> {
    hostedLocation();
    const id = await this.post(draft, false);
    return {
      id: id!,
      url: adoItemUrl(this.config, id!),
    };
  }

  private async post(draft: AdoDraft, validateOnly: boolean): Promise<number | undefined> {
    const normalizedDraft = normalizeAdoDraft(draft);
    adoPatch(normalizedDraft, this.config);
    const body = JSON.stringify({ configuration: this.config, draft: normalizedDraft, validateOnly });
    if (new TextEncoder().encode(body).length > ADO_MAX_REQUEST_BYTES) {
      throw new AdoRequestError("ADO submission exceeds the request size limit.");
    }
    const token = await this.token();
    hostedLocation();
    const url = "/api/ado-work-items";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      // Never retry POST: a lost response may follow a successful external creation.
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store",
      });
      if (!response.ok) {
        const definite = [400, 401, 403, 404, 405, 409, 410, 412, 413, 415, 422, 429].includes(response.status);
        const uncertain = !validateOnly && !definite;
        if (validateOnly && [400, 422].includes(response.status)) {
          const fields = await validationFields(response);
          throw new AdoRequestError(
            `ADO validation was rejected (HTTP ${response.status}).` +
            (fields.length ? ` Fields: ${fields.join(", ")}.` : "") +
            " Check this Work item's fields and the configuration JSON defaults.",
          );
        }
        throw new AdoRequestError(
          uncertain ?
            `ADO creation outcome is unknown (HTTP ${response.status}). Reconcile in ADO before trying again.` :
            `ADO ${validateOnly ? "validation" : "creation"} was rejected (HTTP ${response.status}).`,
          uncertain,
        );
      }
      if (response.status !== 200 && response.status !== 201) throw new Error();
      const payload: unknown = await response.json();
      if (validateOnly) {
        if (!isAdoRecord(payload) || payload.validated !== true) throw new Error();
        return;
      }
      if (!isAdoRecord(payload) || !Number.isSafeInteger(payload.id) || (payload.id as number) <= 0) {
        throw new Error();
      }
      return payload.id as number;
    } catch (error) {
      if (error instanceof AdoRequestError) throw error;
      throw new AdoRequestError(
        validateOnly ? "ADO validation could not be completed." :
          "ADO creation outcome is unknown. Reconcile in ADO before trying again.",
        !validateOnly,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
