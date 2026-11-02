import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Only a distribution with an explicit package license embeds that grant.
export async function distributionLicensePlugin(root, packageMetadata) {
  if (!packageMetadata.license) return { name: "secure-design-studio-distribution-license" };
  const text = await readFile(resolve(root, "LICENSE"), "utf8");
  if (!text.trim() || Buffer.byteLength(text) > 100000) throw new Error("Distribution LICENSE is empty or too large.");
  return {
    name: "secure-design-studio-distribution-license",
    transformIndexHtml() {
      return [{ tag: "script", attrs: { type: "application/json", id: "sds-distribution-license" },
        children: JSON.stringify({ license: packageMetadata.license, text }).replace(/</g, "\\u003c"), injectTo: "head" }];
    },
  };
}
