import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const settingsPath = path.join(root, "api", "local.settings.json");

export function localAiSettings(env, existing = {}) {
  const previous = existing.Values ?? {};
  const provider = env.SDS_AI_PROVIDER?.trim().toLowerCase() || "azure";
  if (!["azure", "claude", "codex"].includes(provider)) {
    throw new Error("SDS_AI_PROVIDER must be azure, claude, or codex. No fallback provider was selected.");
  }
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim() || env.AZURE_AI_ENDPOINT?.trim()
    || previous.AZURE_OPENAI_ENDPOINT || previous.AZURE_AI_ENDPOINT;
  const deployment = env.MODEL_DEPLOYMENT_NAME?.trim() || previous.MODEL_DEPLOYMENT_NAME;
  if (provider === "azure" && (!endpoint || !deployment)) {
    throw new Error("Set AZURE_OPENAI_ENDPOINT (or AZURE_AI_ENDPOINT) and MODEL_DEPLOYMENT_NAME for Azure, or choose SDS_AI_PROVIDER=claude or codex.");
  }
  const values = {
    AzureWebJobsStorage: "",
    FUNCTIONS_WORKER_RUNTIME: "node",
    SDS_LOCAL_AI: "1",
    SDS_AI_PROVIDER: provider,
  };
  if (endpoint) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("The Azure AI endpoint must use HTTPS without credentials, query parameters, or a fragment.");
    }
    values.AZURE_OPENAI_ENDPOINT = url.toString().replace(/\/$/, "");
  }
  if (deployment) values.MODEL_DEPLOYMENT_NAME = deployment;
  const version = env.AZURE_OPENAI_API_VERSION?.trim() || previous.AZURE_OPENAI_API_VERSION;
  if (version) values.AZURE_OPENAI_API_VERSION = version;
  return {
    IsEncrypted: false,
    Values: values,
    Host: { CORS: "http://localhost:5173", CORSCredentials: false },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let existing = {};
  try {
    existing = JSON.parse(await readFile(settingsPath, "utf8"));
    if (!existing || typeof existing !== "object" || Array.isArray(existing)
        || (existing.Values && (typeof existing.Values !== "object" || Array.isArray(existing.Values)))) {
      throw new Error("api/local.settings.json has an invalid settings object.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error("api/local.settings.json is not valid settings JSON.");
  }
  const settings = localAiSettings(process.env, existing);
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Configured the ignored local AI bridge with initial provider ${settings.Values.SDS_AI_PROVIDER}. No credentials were written.`);
}
