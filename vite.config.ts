import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import packageJson from "./package.json";
import { readLibraryCandidates, libraryBuildBridge } from "./scripts/custom-libraries.mjs";
import { readServiceConfiguration, serviceBuildConfiguration, serviceBuildReceiptPlugin } from "./scripts/service-configuration.mjs";
import { distributionLicensePlugin } from "./scripts/distribution-license.mjs";

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
    assistantEndpoint: localAi ? "http://localhost:7071/api/design-assistant" : "",
    selection: { source: localAi ? "Explicit local AI workflow" : "Credential-free local workflow" },
  } : serviceBuildConfiguration(await readServiceConfiguration(env.SDS_SERVICE_CONFIG, env, process.cwd()), singleFile);
  if (services.selection.error) console.warn(`[service-configuration] ${services.selection.error}`);

  return {
    plugins: [react(), libraries.plugin, await distributionLicensePlugin(process.cwd(), packageJson), ...(singleFile ? [viteSingleFile()] : []),
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
          // viteSingleFile recommendations: avoid chunk-splitting/asset
          // separation so everything lands in the one html file. The plugin
          // itself forces a single chunk, picking codeSplitting:false on
          // Vite 8+ (Rolldown) or inlineDynamicImports:true on older Vite,
          // so do not set either here — doing so triggers a Rolldown warning.
          assetsInlineLimit: 100_000_000,
          chunkSizeWarningLimit: 100_000_000,
          cssCodeSplit: false,
          reportCompressedSize: false,
        }
      : {},
  };
});
