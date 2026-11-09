import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, unlink, rmdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readServiceConfiguration, validateServiceFile, NO_SERVICES,
  serviceBuildConfiguration, serviceBuildReceiptPlugin, verifyServiceBuild,
} from "../../scripts/service-configuration.mjs";

const example = JSON.parse(await readFile(new URL("../../examples/service-configuration/example.json", import.meta.url), "utf8"));
async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), "sds-service-file-"));
  const file = join(directory, "services.json");
  try { await writeFile(file, JSON.stringify(example)); await callback(directory, file); }
  finally { await unlink(file); await rmdir(directory); }
}

test("service file: no selection does not discover a present profile and environment settings remain explicit", async () => {
  await fixture(async directory => {
    assert.strictEqual(await readServiceConfiguration(undefined, {}, directory), NO_SERVICES);
    const env = await readServiceConfiguration("", { VITE_DESIGN_ASSISTANT_ENDPOINT: "/api/design-assistant" }, directory);
    assert.equal(env.source, "Environment settings");
    assert.equal(env.settings.collaboration.tokenEndpoint, "");
    assert.equal(serviceBuildConfiguration(env, false).assistantEndpoint, "/api/design-assistant");
    const empty = await readServiceConfiguration(undefined, { VITE_COLLAB_TOKEN_ENDPOINT: "" }, directory);
    assert.equal(empty.settings.collaboration.tokenEndpoint, "");
    assert.equal(empty.error, undefined);
  });
});

test("service file: explicit relative file is bounded, normalized and immutable with distinct delivery settings", async () => {
  await fixture(async (directory, file) => {
    const profile = { ...example, assistant: { hostedEndpoint: "/api/design-assistant", standaloneEndpoint: "" } };
    await writeFile(file, "\uFEFF" + JSON.stringify(profile));
    const selected = await readServiceConfiguration("services.json", {}, directory);
    assert.equal(selected.error, undefined);
    assert.equal(selected.source, "Example services (example)");
    assert.equal(serviceBuildConfiguration(selected, false).assistantEndpoint, "/api/design-assistant");
    assert.equal(serviceBuildConfiguration(selected, true).assistantEndpoint, "");
    assert.equal(Object.isFrozen(selected.settings.collaboration), true);
    assert.deepEqual(selected.settings, validateServiceFile(profile).settings);
  });
});

test("service file: conflicts, missing files, network paths and invalid JSON fail closed without exposing values", async () => {
  await fixture(async (directory, file) => {
    const cases = [
      ["services.json", { VITE_COLLAB_TOKEN_ENDPOINT: "" }],
      ["missing.json", {}], ["https://example.invalid/secret", {}],
      ["\\\\server\\share\\services.json", {}], ["x".repeat(4097), {}],
    ];
    for (const [selection, env] of cases) {
      const result = await readServiceConfiguration(selection, env, directory);
      assert.ok(result.error);
      assert.deepEqual(result.settings, NO_SERVICES.settings);
      assert.equal(JSON.stringify(result).includes(directory), false);
      assert.equal(JSON.stringify(result).includes("secret"), false);
    }
    for (const raw of ['{"PRIVATE_MARKER"', " ".repeat(16385), "null", "[]"]) {
      await writeFile(file, raw);
      const result = await readServiceConfiguration(file, {}, directory);
      assert.ok(result.error);
      assert.equal(JSON.stringify(result).includes("PRIVATE_MARKER"), false);
      assert.deepEqual(result.settings, NO_SERVICES.settings);
    }
  });
});

test("service file: complete schema and all URLs validate atomically, including inactive standalone values", () => {
  for (const candidate of [
    { ...example, format: "wrong" }, { ...example, version: 2 }, { ...example, id: "" },
    { ...example, name: "\n" }, { ...example, extra: true },
    { ...example, assistant: { hostedEndpoint: "/api/design-assistant" } },
    { ...example, collaboration: { ...example.collaboration, appUrl: "" } },
    { ...example, collaboration: { ...example.collaboration, tokenEndpoint: "https://host.invalid/?key=PRIVATE_MARKER" } },
    { ...example, assistant: { ...example.assistant, standaloneEndpoint: "/api/design-assistant" } },
    { ...example, assistant: { ...example.assistant, hostedEndpoint: "javascript:PRIVATE_MARKER" } },
  ]) assert.throws(() => validateServiceFile(candidate), error => !error.message.includes("PRIVATE_MARKER"));
});

test("service file: artifact receipt binds exact configuration and all bundle files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sds-service-receipt-"));
  const assets = join(directory, "assets");
  const html = join(directory, "index.html"), js = join(assets, "app.js"), receipt = join(directory, "service-build.json");
  await mkdir(assets);
  try {
    await writeFile(html, "<html>Synthetic artifact</html>");
    await writeFile(js, "const synthetic = true;");
    const selected = await readServiceConfiguration(undefined, { VITE_DESIGN_ASSISTANT_ENDPOINT: "/api/design-assistant" });
    const plugin = serviceBuildReceiptPlugin(serviceBuildConfiguration(selected, false), false, "test");
    await plugin.writeBundle({ dir: directory }, { "index.html": {}, "assets/app.js": {} });
    assert.equal((await verifyServiceBuild(directory, selected)).applicationVersion, "test");
    await assert.rejects(verifyServiceBuild(directory, NO_SERVICES), /does not match/);
    await writeFile(js, "const changed = true;");
    await assert.rejects(verifyServiceBuild(directory, selected), /do not match/);
    await writeFile(js, "const synthetic = true;");
    const extra = join(directory, "extra.txt");
    await writeFile(extra, "Unexpected artifact");
    await assert.rejects(verifyServiceBuild(directory, selected), /inventory/);
    await unlink(extra);
    const metadata = JSON.parse(await readFile(receipt, "utf8"));
    metadata.files["../outside"] = "0".repeat(64);
    await writeFile(receipt, JSON.stringify(metadata));
    await assert.rejects(verifyServiceBuild(directory, selected), /inventory|path/);
  } finally { await unlink(html); await unlink(js); await unlink(receipt); await rmdir(assets); await rmdir(directory); }
});
