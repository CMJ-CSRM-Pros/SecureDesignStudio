import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { distributionLicensePlugin } from "../../scripts/distribution-license.mjs";

const notices = JSON.parse(await readFile(new URL("../../src/data/runtimeDependencyNotices.json", import.meta.url), "utf8"));

test("API dependencies: the Identity SDK supports patched MSAL without a forced-major override", async () => {
  const manifest = JSON.parse(await readFile(resolve("api/package.json"), "utf8"));
  const lock = JSON.parse(await readFile(resolve("api/package-lock.json"), "utf8"));
  const config = JSON.parse(await readFile(resolve("staticwebapp.config.json"), "utf8"));
  const engine = /^>=(\d+)\./.exec(lock.packages["node_modules/@azure/identity"].engines.node);
  const runtime = /^node:(\d+)$/.exec(config.platform?.apiRuntime);
  assert.ok(engine && runtime, "An explicit supported API runtime is required");
  assert.ok(Number(runtime[1]) >= Number(engine[1]), "The deployed API runtime must support the SDK");
  assert.equal(manifest.overrides?.["@azure/identity"]?.["@azure/msal-node"], undefined);
  assert.equal(manifest.overrides?.["@azure/msal-node"], undefined);
  const declared = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(
    lock.packages["node_modules/@azure/identity"].dependencies["@azure/msal-node"],
  );
  assert.ok(declared, "Review changes to the SDK's declared MSAL range");
  const minimum = declared.slice(1).map(Number);
  const resolutions = Object.entries(lock.packages)
    .filter(([path]) => path.endsWith("node_modules/@azure/msal-node"));
  assert.ok(resolutions.length > 0);
  for (const [path, dependency] of resolutions) {
    const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(dependency.version);
    assert.ok(parsed, `${path} must resolve a stable release`);
    const [major, minor, patch] = parsed.slice(1).map(Number);
    assert.ok(major > 7 || (major === 7 && minor >= 1), `${path} must include the 7.1.0 security fix`);
    assert.equal(major, minimum[0], `${path} must remain in the SDK's supported major`);
    assert.ok(minor > minimum[1] || (minor === minimum[1] && patch >= minimum[2]),
      `${path} must meet the SDK's declared minimum`);
  }
});

test("build dependencies: standalone inlining removes vulnerable dependencies and escapes closing tags", async () => {
  const { singleFileBuildPlugin } = await import("../../scripts/single-file-build.mjs");
  const lock = JSON.parse(await readFile(resolve("package-lock.json"), "utf8"));
  assert.equal(Object.keys(lock.packages).some(path => /node_modules\/(?:braces|micromatch|vite-plugin-singlefile)$/.test(path)), false);
  const quotes = Object.entries(lock.packages).filter(([path]) => /node_modules\/shell-quote$/.test(path));
  assert.ok(quotes.length > 0);
  for (const [, pkg] of quotes) assert.equal(pkg.version, "1.12.0");
  for (const prefix of ["", "./"]) {
    const bundle = {
      "index.html": { type: "asset", fileName: "index.html", source: `<script type="module" src="${prefix}app.js"></script><link href="${prefix}app.css">` },
      "app.js": { type: "chunk", fileName: "app.js", code: 'console.log("</script></SCRIPT><!-- __VITE_PRELOAD__");' },
      "app.css": { type: "asset", fileName: "app.css", source: 'body{color:red}/* </style> */' },
    };
    const plugin = singleFileBuildPlugin();
    plugin.generateBundle.call({ error(message) { throw new Error(message); } }, {}, bundle);
    assert.match(bundle["index.html"].source, /console\.log/);
    assert.equal("app.js" in bundle, false);
    assert.equal("app.css" in bundle, false);
    assert.equal(bundle["index.html"].source.includes("<style>"), true);
    assert.equal((bundle["index.html"].source.match(/<\/script>/g) ?? []).length, 1);
    assert.equal(bundle["index.html"].source.includes("</SCRIPT>"), false);
    assert.equal((bundle["index.html"].source.match(/<\/style>/g) ?? []).length, 1);
    assert.equal(bundle["index.html"].source.includes("__VITE_PRELOAD__"), false);
  }
  const plugin = singleFileBuildPlugin();
  const context = { error(message) { throw new Error(message); } };
  assert.throws(() => plugin.generateBundle.call(context, {}, {}), /did not emit HTML/);
  assert.throws(() => plugin.generateBundle.call(context, {}, {
    "index.html": { type: "asset", fileName: "index.html", source: "<html></html>" },
    "app.js": { type: "chunk", fileName: "app.js", code: "void 0;" },
  }), /not inlined/);
  const config = {};
  plugin.config(config);
  assert.equal(config.build.rollupOptions.output.codeSplitting, false);
  assert.equal(config.build.assetsInlineLimit(), true);
});

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
