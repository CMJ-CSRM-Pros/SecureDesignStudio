import { serviceEndpoint } from "./serviceEndpoint.mjs";
export { serviceEndpoint } from "./serviceEndpoint.mjs";

export interface ServiceAvailability {
  enabled: boolean;
  state: "available" | "disabled" | "invalid";
  message: string;
  endpoint: string;
}

export interface ServiceConfigurationInput {
  localOnly: boolean;
  localAi: boolean;
  singleFile: boolean;
  tokenEndpoint: string;
  publicAppUrl: string;
  assistantEndpoint: string;
  configurationError?: string;
  source?: string;
}

export const LOCAL_ASSISTANT_ENDPOINT = "http://localhost:5173/api/design-assistant";
export const LOCAL_ONLY_COLLAB_MESSAGE = "Collaboration is disabled in local-only mode.";

function unavailable(message: string, state: "disabled" | "invalid" = "disabled"): ServiceAvailability {
  return { enabled: false, state, message, endpoint: "" };
}

export function resolveServiceConfiguration(input: ServiceConfigurationInput) {
  let collaboration: ServiceAvailability;
  let shareAppUrl = "";
  if (input.localOnly) {
    collaboration = unavailable(LOCAL_ONLY_COLLAB_MESSAGE);
  } else if (input.configurationError) {
    collaboration = unavailable(input.configurationError, "invalid");
  } else if (!input.tokenEndpoint.trim()) {
    collaboration = unavailable("Collaboration is disabled because no token endpoint is configured.");
  } else {
    const endpoint = serviceEndpoint(input.tokenEndpoint);
    const appUrl = serviceEndpoint(input.publicAppUrl);
    if (!endpoint) {
      collaboration = unavailable("Collaboration token endpoint configuration is invalid. Use an absolute HTTP(S) URL without credentials, query parameters or a fragment.", "invalid");
    } else if (input.singleFile && !appUrl) {
      collaboration = unavailable("Standalone collaboration requires a valid hosted app URL without credentials, query parameters or a fragment.", "invalid");
    } else {
      collaboration = { enabled: true, state: "available", message: "Collaboration is configured; joining a room contacts the token service.", endpoint };
      shareAppUrl = input.singleFile && appUrl ? appUrl : "";
    }
  }

  let assistant: ServiceAvailability;
  if (input.localOnly && !input.localAi) {
    assistant = unavailable("Design Assistant is disabled in credential-free local mode. Use the explicit local AI workflow to configure it.");
  } else if (input.configurationError) {
    assistant = unavailable(input.configurationError, "invalid");
  } else if (!input.assistantEndpoint.trim()) {
    assistant = unavailable("Design Assistant is disabled because no endpoint is configured.");
  } else {
    const endpoint = serviceEndpoint(input.assistantEndpoint, !input.localOnly && !input.singleFile);
    if (!endpoint || (input.localOnly && endpoint !== LOCAL_ASSISTANT_ENDPOINT)) {
      assistant = unavailable(input.localOnly
        ? "Local Design Assistant must use the fixed localhost AI endpoint."
        : "Design Assistant endpoint configuration is invalid. Use an HTTP(S) URL without credentials, query parameters or a fragment; a same-origin path is supported only in hosted builds.", "invalid");
    } else {
      assistant = { enabled: true, state: "available", message: "Design Assistant is configured; requests send the included model context to this endpoint.", endpoint };
    }
  }
  return Object.freeze({
    source: input.source ?? "Build settings",
    collaboration: Object.freeze(collaboration),
    assistant: Object.freeze(assistant),
    shareAppUrl,
  });
}
