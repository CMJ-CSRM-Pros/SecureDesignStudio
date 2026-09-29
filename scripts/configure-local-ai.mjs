import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const settingsPath = path.join(root, "api", "local.settings.json");

function validSettings(settings) {
  const values = settings?.Values;
  return Boolean(
    values &&
      (values.AZURE_OPENAI_ENDPOINT || values.AZURE_AI_ENDPOINT) &&
      values.MODEL_DEPLOYMENT_NAME,
  );
}

async function useExistingSettings() {
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    if (validSettings(settings)) {
      console.log("Using existing ignored api/local.settings.json.");
      return true;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error("api/local.settings.json is not valid JSON.");
    }
  }
  return false;
}

const endpoint =
  process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
  process.env.AZURE_AI_ENDPOINT?.trim();
const deploymentName = process.env.MODEL_DEPLOYMENT_NAME?.trim();
const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim();

if (!endpoint && !deploymentName && (await useExistingSettings())) {
  process.exit(0);
}

if (!endpoint || !deploymentName) {
  throw new Error(
    "Set AZURE_OPENAI_ENDPOINT (or AZURE_AI_ENDPOINT) and MODEL_DEPLOYMENT_NAME before running npm run dev:ai.",
  );
}

const endpointUrl = new URL(endpoint);
if (endpointUrl.protocol !== "https:") {
  throw new Error("The Azure AI endpoint must use HTTPS.");
}

const values = {
  AzureWebJobsStorage: "",
  FUNCTIONS_WORKER_RUNTIME: "node",
  AZURE_OPENAI_ENDPOINT: endpointUrl.toString().replace(/\/$/, ""),
  MODEL_DEPLOYMENT_NAME: deploymentName,
};
if (apiVersion) values.AZURE_OPENAI_API_VERSION = apiVersion;

await writeFile(
  settingsPath,
  `${JSON.stringify(
    {
      IsEncrypted: false,
      Values: values,
      Host: {
        CORS: "http://localhost:5173",
        CORSCredentials: false,
      },
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);

console.log("Created ignored api/local.settings.json from environment variables.");