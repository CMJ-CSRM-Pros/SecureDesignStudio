import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { distributionLicensePlugin } from "../../scripts/distribution-license.mjs";

const notices = JSON.parse(await readFile(new URL("../../src/data/runtimeDependencyNotices.json", import.meta.url), "utf8"));
test("dependency notices: every locked runtime dependency has complete versioned attribution", async () => {
  const expected = new Map();
  for (const scope of [".", "api"]) {
    const lock = JSON.parse(await readFile(resolve(scope, "package-lock.json"), "utf8"));
    for (const [path, pkg] of Object.entries(lock.packages)) {
      if (!path || pkg.dev) continue;
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const key = `${name}@${pkg.version}`;
      const record = expected.get(key) ?? { license: pkg.license, integrity: pkg.integrity, sourceUrl: pkg.resolved, scopes: [] };
      record.scopes.push(scope === "." ? "Frontend" : "API");
      expected.set(key, record);
    }
  }
  assert.equal(notices.packages.length, expected.size);
  for (const pkg of notices.packages) {
    const entry = expected.get(`${pkg.name}@${pkg.version}`);
    assert.ok(entry);
    assert.equal(pkg.license, entry.license);
    assert.equal(pkg.integrity, entry.integrity);
    assert.equal(pkg.sourceUrl, entry.sourceUrl);
    assert.deepEqual(pkg.scopes, entry.scopes);
    assert.ok(pkg.notices.length);
    for (const notice of pkg.notices) {
      assert.ok(notice.text.trim().length > 0);
      if (/^licen[cs]e/i.test(notice.file)) assert.ok(notice.text.length > 100);
    }
  }
});

test("distribution license: explicit license travels as escaped inert HTML data; absent licensing is not inferred", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "sds-license-"));
  try {
    const absent = await distributionLicensePlugin(directory, {});
    assert.equal(absent.transformIndexHtml, undefined);
    await assert.rejects(distributionLicensePlugin(directory, { license: "MIT" }), /ENOENT/);
    const text = 'Synthetic license </script><b>literal</b>';
    await writeFile(resolve(directory, "LICENSE"), text);
    const configured = await distributionLicensePlugin(directory, { license: "MIT" });
    const [tag] = configured.transformIndexHtml();
    assert.equal(tag.attrs.type, "application/json");
    assert.equal(tag.children.includes("</script>"), false);
    assert.deepEqual(JSON.parse(tag.children), { license: "MIT", text });
  } finally {
    await unlink(resolve(directory, "LICENSE"));
    await rmdir(directory);
  }
});
