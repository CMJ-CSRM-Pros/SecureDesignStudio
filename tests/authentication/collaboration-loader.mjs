import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Compile the real browser modules in memory; no generated build or browser.
const sourceRoot = new URL("../../src/", import.meta.url).href;
const sharedRoot = new URL("../../shared/", import.meta.url).href;
export const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && (context.parentURL?.startsWith(sourceRoot) || context.parentURL?.startsWith(sharedRoot))) {
      const url = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix)) {
          return { url: url.href + suffix, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) || url.startsWith(sharedRoot)) {
      if (url.endsWith(".json")) {
        return { format: "module", source: `export default ${readFileSync(new URL(url), "utf8")}`, shortCircuit: true };
      }
      if (/\.tsx?$/.test(url)) {
        const source = readFileSync(new URL(url), "utf8")
          .replace(/\b__PS_LOCAL_ONLY__\b/g, "true")
          .replace(/\b__PS_LOCAL_AI__\b/g, "false")
          .replace(/\b__PS_SINGLE_FILE__\b/g, "false")
          .replace(/\b__SDS_SERVICE_SELECTION__\b/g, '{"source":"Synthetic local test"}')
          .replace(/\b__PS_(TOKEN_ENDPOINT|PUBLIC_APP_URL|ASSISTANT_ENDPOINT)__\b/g, '""');
        return {
          format: "module",
          source: ts.transpileModule(source, {
            fileName: fileURLToPath(url),
            compilerOptions: {
              module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
              jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
            },
          }).outputText,
          shortCircuit: true,
        };
      }
    }
    return nextLoad(url, context);
  },
});
