import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { singleFileBuildPlugin } from "./scripts/single-file-build.mjs";
import packageJson from "./package.json";
import { readLibraryCandidates, libraryBuildBridge } from "./scripts/custom-libraries.mjs";
import { readServiceConfiguration, serviceBuildConfiguration, serviceBuildReceiptPlugin } from "./scripts/service-configuration.mjs";
import { distributionLicensePlugin } from "./scripts/distribution-license.mjs";
import { localAiVitePlugin } from "./scripts/local-ai-vite.mjs";

// Set BUILD_SINGLE_FILE=1 to emit a single self-contained index.html (in
// dist-single/) with all JS/CSS inlined. The default `npm run build` runs
// vite twice — once for the normal multi-file dist/, then again with this
// flag set for dist-single/.
const singleFile = process.env.BUILD_SINGLE_FILE === "1";

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const localOnly = command === "serve";
  const libraries = libraryBuildBridge(
    await readLibraryCandidates(env.SDS_LIBRARY_PATHS, process.cwd()), localOnly || singleFile,
  );
  const localAi = localOnly && mode === "ai";
  const cliOnly = env.npm_lifecycle_event === "dev:ai:local" ||
    (env.npm_lifecycle_event !== "dev:ai" && env.SDS_LOCAL_AI_CLI_ONLY === "1");
  if (localAi) {
    process.env.SDS_LOCAL_AI = "1";
    process.env.SDS_LOCAL_AI_CLI_ONLY = cliOnly ? "1" : "0";
  }
  const hasLocalTokenOverride = Object.prototype.hasOwnProperty.call(
    env,
    "VITE_COLLAB_TOKEN_ENDPOINT",
  );
  const hasLocalAssistantOverride = Object.prototype.hasOwnProperty.call(
    env,
    "VITE_DESIGN_ASSISTANT_ENDPOINT",
  );

  if (localOnly && hasLocalTokenOverride) {
    throw new Error(
      "[local-only] VITE_COLLAB_TOKEN_ENDPOINT must be unset. Local Vite does not support collaboration.",
    );
  }
  if (localOnly && hasLocalAssistantOverride) {
    throw new Error(
      "[local-only] VITE_DESIGN_ASSISTANT_ENDPOINT must be unset. Use npm run dev:ai for the fixed localhost endpoint.",
    );
  }

  // Local serving never reads a deployment service file.
  const services = localOnly ? {
    tokenEndpoint: "", publicAppUrl: "http://localhost:5173/",
    assistantEndpoint: localAi ? "http://localhost:5173/api/design-assistant" : "",
    selection: { source: localAi ? "Explicit local AI workflow" : "Credential-free local workflow" },
  } : serviceBuildConfiguration(await readServiceConfiguration(env.SDS_SERVICE_CONFIG, env, process.cwd()), singleFile);
  if (services.selection.error) console.warn(`[service-configuration] ${services.selection.error}`);

  return {
    plugins: [react(), libraries.plugin, ...(localAi ? [localAiVitePlugin({ cliOnly })] : []),
      await distributionLicensePlugin(process.cwd(), packageJson), ...(singleFile ? [singleFileBuildPlugin()] : []),
      ...(!localOnly ? [serviceBuildReceiptPlugin(services, singleFile, packageJson.version)] : [])],
    define: {
      __PS_SINGLE_FILE__: JSON.stringify(singleFile),
      __PS_LOCAL_ONLY__: JSON.stringify(localOnly),
      __PS_LOCAL_AI__: JSON.stringify(localAi),
      __PS_TOKEN_ENDPOINT__: JSON.stringify(services.tokenEndpoint),
      __PS_ASSISTANT_ENDPOINT__: JSON.stringify(services.assistantEndpoint),
      __PS_PUBLIC_APP_URL__: JSON.stringify(services.publicAppUrl),
      __SDS_SERVICE_SELECTION__: JSON.stringify(services.selection),
      __PS_VERSION__: JSON.stringify(packageJson.version),
      __SDS_LIBRARY_DELIVERY__: JSON.stringify(libraries.delivery),
    },
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
    },
    build: singleFile
      ? {
          outDir: "dist-single",
          // The single-file plugin configures one Rolldown chunk and inlines
          // its script and stylesheet into the HTML.
          assetsInlineLimit: 100_000_000,
          chunkSizeWarningLimit: 100_000_000,
          cssCodeSplit: false,
          reportCompressedSize: false,
        }
      : {},
  };
});
