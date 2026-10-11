import assert from "node:assert/strict";
import { test } from "node:test";
import { localAiSettings } from "../../scripts/configure-local-ai.mjs";

test("local AI setup: subscription providers need no Azure configuration or stored credentials", () => {
  for (const provider of ["claude", "codex"]) {
    const result = localAiSettings({ SDS_AI_PROVIDER: provider, ANTHROPIC_API_KEY: "synthetic-secret", OPENAI_API_KEY: "synthetic-secret" });
    assert.equal(result.Values.SDS_AI_PROVIDER, provider);
    assert.equal(result.Values.SDS_LOCAL_AI, "1");
    assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
    assert.deepEqual(result.Host, { CORS: "http://localhost:5173", CORSCredentials: false });
  }
});

test("local AI setup: Azure remains the npm default and saved deployment survives provider switches", () => {
  const saved = { Values: { AZURE_OPENAI_ENDPOINT: "https://synthetic.openai.azure.com", MODEL_DEPLOYMENT_NAME: "synthetic-model" } };
  assert.equal(localAiSettings({}, saved).Values.SDS_AI_PROVIDER, "azure");
  const subscription = localAiSettings({ SDS_AI_PROVIDER: "claude" }, saved);
  assert.equal(subscription.Values.MODEL_DEPLOYMENT_NAME, "synthetic-model");
  assert.equal(localAiSettings({ SDS_AI_PROVIDER: "azure" }, subscription).Values.MODEL_DEPLOYMENT_NAME, "synthetic-model");
  const override = localAiSettings({ AZURE_AI_ENDPOINT: "https://override.example.invalid", MODEL_DEPLOYMENT_NAME: "override" }, saved);
  assert.equal(override.Values.AZURE_OPENAI_ENDPOINT, "https://override.example.invalid");
  assert.equal(override.Values.MODEL_DEPLOYMENT_NAME, "override");
});

test("local AI setup: invalid provider and unsafe endpoints fail without provider substitution", () => {
  assert.throws(() => localAiSettings({ SDS_AI_PROVIDER: "unknown" }), /No fallback/);
  assert.throws(() => localAiSettings({}), /Set AZURE_OPENAI_ENDPOINT/);
  for (const endpoint of ["http://example.invalid", "https://user:password@example.invalid", "https://example.invalid?key=secret", "https://example.invalid#secret"]) {
    assert.throws(() => localAiSettings({ AZURE_OPENAI_ENDPOINT: endpoint, MODEL_DEPLOYMENT_NAME: "synthetic" }), /HTTPS without credentials/);
  }
});
