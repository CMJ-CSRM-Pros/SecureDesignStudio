import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../../api/package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../../api/package-lock.json", import.meta.url), "utf8"));

test("API dependencies: Identity resolves patched MSAL Node for GHSA-xcx6-jx8p-x3h5", () => {
  const pinnedVersion = manifest.overrides["@azure/identity"]["@azure/msal-node"];
  assert.equal(pinnedVersion, "7.1.0");
  const resolutions = Object.entries(lock.packages)
    .filter(([path]) => path.endsWith("node_modules/@azure/msal-node"));
  assert.ok(resolutions.length > 0, "MSAL Node must be present in the API lockfile");
  for (const [path, dependency] of resolutions) {
    assert.equal(dependency.version, pinnedVersion, `${path} must use the patched version`);
  }
});
