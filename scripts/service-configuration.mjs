import { open, realpath, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceEndpoint } from "../src/serviceEndpoint.mjs";

export const SERVICE_CONFIGURATION_FORMAT = "secure-design-studio-service-configuration";
export const SERVICE_BUILD_FILE = "service-build.json";
const MAX_BYTES = 16384;
const ENV_KEYS = ["VITE_COLLAB_TOKEN_ENDPOINT", "VITE_COLLAB_APP_URL", "VITE_DESIGN_ASSISTANT_ENDPOINT"];
const emptySettings = () => ({
  collaboration: { tokenEndpoint: "", appUrl: "" },
  assistant: { hostedEndpoint: "", standaloneEndpoint: "" },
});

function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error("Service configuration has an invalid object or unsupported fields.");
  }
  return value;
}

function endpoint(value, allowRelative = false) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Service endpoint must be text of at most 2048 characters.");
  if (!value.trim()) return "";
  const valid = serviceEndpoint(value, allowRelative);
  if (!valid) throw new Error("Service configuration contains an invalid endpoint. Use HTTP(S) without credentials, queries or fragments; only the hosted Assistant permits a same-origin path.");
  return valid;
}

export function validateServiceFile(value) {
  const input = record(value, ["format", "version", "id", "name", "collaboration", "assistant"]);
  if (input.format !== SERVICE_CONFIGURATION_FORMAT || input.version !== 1) throw new Error("Unsupported service configuration format or version.");
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(input.id)
      || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120 || /[\u0000-\u001f\u007f]/.test(input.name)) {
    throw new Error("Service configuration requires a bounded id and display name.");
  }
  const collaboration = record(input.collaboration, ["tokenEndpoint", "appUrl"]);
  const assistant = record(input.assistant, ["hostedEndpoint", "standaloneEndpoint"]);
  const tokenEndpoint = endpoint(collaboration.tokenEndpoint);
  const appUrl = endpoint(collaboration.appUrl);
  if (tokenEndpoint && !appUrl) throw new Error("Service configuration requires a hosted app URL when collaboration is enabled.");
  return {
    id: input.id, name: input.name.trim(),
    settings: {
      collaboration: { tokenEndpoint, appUrl },
      assistant: { hostedEndpoint: endpoint(assistant.hostedEndpoint, true), standaloneEndpoint: endpoint(assistant.standaloneEndpoint) },
    },
  };
}

function freeze(result) {
  Object.freeze(result.settings.collaboration);
  Object.freeze(result.settings.assistant);
  Object.freeze(result.settings);
  return Object.freeze(result);
}

export const NO_SERVICES = freeze({ source: "No service configuration", settings: emptySettings() });

export async function readServiceConfiguration(selection, env = {}, root = process.cwd()) {
  const selected = typeof selection === "string" && selection.trim() !== "";
  const hasEnvironment = ENV_KEYS.some(key => Object.hasOwn(env, key));
  const invalid = message => freeze({ source: selected ? "Selected service configuration" : "Environment settings",
    error: message, settings: emptySettings() });
  if (selected && hasEnvironment) {
    return invalid("Service configuration file and endpoint environment overrides cannot be combined. Select one configuration source.");
  }
  if (!selected) {
    if (!hasEnvironment) return NO_SERVICES;
    try {
      const assistant = env.VITE_DESIGN_ASSISTANT_ENDPOINT ?? "";
      // Relative Assistant paths are valid in hosted output only; the runtime
      // rejects that same value in standalone output rather than guessing a host.
      return freeze({ source: "Environment settings", settings: {
        collaboration: { tokenEndpoint: endpoint(env.VITE_COLLAB_TOKEN_ENDPOINT ?? ""), appUrl: endpoint(env.VITE_COLLAB_APP_URL ?? "") },
        assistant: { hostedEndpoint: endpoint(assistant, true), standaloneEndpoint: endpoint(assistant, true) },
      } });
    } catch (error) { return invalid(error.message); }
  }
  if (selection.length > 4096 || /^[\\/]{2}|^[a-z][a-z0-9+.-]*:\/\//i.test(selection)) {
    return invalid("SDS_SERVICE_CONFIG must select one local JSON file, not a URL or network share.");
  }
  let timer;
  try {
    const load = async () => {
      const path = await realpath(resolve(root, selection));
      if (/^[\\/]{2}/.test(path)) throw new Error("Network service configuration files are unsupported.");
      const file = await open(path, "r");
      try {
        const stats = await file.stat();
        if (!stats.isFile() || stats.size > MAX_BYTES) throw new Error("Service configuration must be a regular file no larger than 16 KiB.");
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > MAX_BYTES) throw new Error("Service configuration exceeds 16 KiB.");
        let parsed;
        try { parsed = JSON.parse(buffer.subarray(0, length).toString("utf8").replace(/^\uFEFF/, "")); }
        catch { throw new Error("Selected service configuration is not valid JSON."); }
        const config = validateServiceFile(parsed);
        return freeze({ source: `${config.name} (${config.id})`, settings: config.settings });
      } finally { await file.close(); }
    };
    return await Promise.race([load(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Local service configuration read timed out.")), 2000);
    })]);
  } catch (error) {
    // Filesystem errors can contain private paths; only schema messages are public.
    return invalid(typeof error.code === "string"
      ? "Selected service configuration is missing or unreadable. Services are disabled."
      : error.message);
  } finally { clearTimeout(timer); }
}

export function serviceBuildConfiguration(selection, singleFile) {
  return {
    tokenEndpoint: selection.settings.collaboration.tokenEndpoint,
    publicAppUrl: selection.settings.collaboration.appUrl,
    assistantEndpoint: singleFile ? selection.settings.assistant.standaloneEndpoint : selection.settings.assistant.hostedEndpoint,
    selection: { source: selection.source, ...(selection.error ? { error: selection.error } : {}) },
  };
}

export function serviceBuildReceiptPlugin(configuration, singleFile, version) {
  return {
    name: "secure-design-studio-service-build-receipt",
    async writeBundle(options, bundle) {
      const directory = resolve(options.dir);
      const files = {};
      for (const file of Object.keys(bundle).sort()) {
        files[file] = createHash("sha256").update(await readFile(resolve(directory, file))).digest("hex");
      }
      await writeFile(resolve(directory, SERVICE_BUILD_FILE), JSON.stringify({
        format: "secure-design-studio-service-build", version: 1, applicationVersion: version,
        singleFile, configuration, files,
      }, null, 2));
    },
  };
}

export async function verifyServiceBuild(directory, expected) {
  if (expected.error) throw new Error(expected.error);
  const raw = await readFile(resolve(directory, SERVICE_BUILD_FILE), "utf8");
  let metadata;
  try { metadata = JSON.parse(raw); }
  catch { throw new Error("Service build receipt is not valid JSON."); }
  if (!metadata || typeof metadata !== "object") throw new Error("Service build receipt is invalid.");
  if (metadata.format !== "secure-design-studio-service-build" || metadata.version !== 1 || typeof metadata.singleFile !== "boolean") {
    throw new Error("Missing or unsupported service build receipt.");
  }
  if (JSON.stringify(metadata.configuration) !== JSON.stringify(serviceBuildConfiguration(expected, metadata.singleFile))) {
    throw new Error("Built service configuration does not match the selected configuration. Rebuild before deploying.");
  }
  if (!metadata.files || typeof metadata.files !== "object" || Array.isArray(metadata.files)
      || !Object.hasOwn(metadata.files, "index.html") || Object.keys(metadata.files).length > 2000) {
    throw new Error("Service build receipt has an invalid artifact inventory.");
  }
  const found = [];
  const list = async (folder, prefix = "", depth = 0) => {
    if (depth > 20) throw new Error("Service artifact directory nesting limit exceeded.");
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("Service artifacts must not contain symbolic links.");
      if (entry.isDirectory()) await list(resolve(folder, entry.name), `${name}/`, depth + 1);
      else if (entry.isFile()) {
        if (name !== SERVICE_BUILD_FILE) found.push(name);
        if (found.length > 2000) throw new Error("Service artifact inventory limit exceeded.");
      } else throw new Error("Service artifacts must be regular files.");
    }
  };
  await list(directory);
  if (JSON.stringify(found.sort()) !== JSON.stringify(Object.keys(metadata.files).sort())) {
    throw new Error("Service artifact inventory does not match the build receipt.");
  }
  for (const [file, expectedHash] of Object.entries(metadata.files)) {
    if (/[\\:]/.test(file) || file.split("/").some(part => !part || part === "." || part === "..")
        || typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error("Service build receipt has an invalid artifact path or digest.");
    }
    const hash = createHash("sha256").update(await readFile(resolve(directory, file))).digest("hex");
    if (hash !== expectedHash) throw new Error("Built artifacts do not match their service configuration receipt.");
  }
  return metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--verify") throw new Error("Usage: node scripts/service-configuration.mjs --verify <build-directory>");
    const config = await readServiceConfiguration(process.env.SDS_SERVICE_CONFIG, process.env);
    const receipt = await verifyServiceBuild(process.argv[3], config);
    console.log(JSON.stringify({ verified: true, applicationVersion: receipt.applicationVersion, source: config.source, singleFile: receipt.singleFile }));
  } catch (error) {
    console.error(typeof error.code === "string" ? "Service build verification failed: a required artifact is missing or unreadable." : error.message);
    process.exitCode = 1;
  }
}
