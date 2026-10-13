import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";

const { resolveServiceConfiguration, serviceEndpoint, LOCAL_ASSISTANT_ENDPOINT } = await import("../../src/serviceConfiguration.ts");
const configured = {
  localOnly: false, localAi: false, singleFile: false,
  tokenEndpoint: "https://collaboration.example.invalid/api/collab-token",
  publicAppUrl: "https://diagram.example.invalid/",
  assistantEndpoint: "/api/design-assistant",
};

test("services: absent settings disable each service independently without substituting a destination", () => {
  const empty = resolveServiceConfiguration({ ...configured, tokenEndpoint: "", assistantEndpoint: "" });
  assert.equal(empty.collaboration.enabled, false);
  assert.equal(empty.assistant.enabled, false);
  assert.equal(empty.collaboration.endpoint, "");
  assert.equal(empty.assistant.endpoint, "");
  assert.match(empty.collaboration.message, /no token endpoint/);
  assert.match(empty.assistant.message, /no endpoint/);
  assert.equal(resolveServiceConfiguration({ ...configured, tokenEndpoint: "" }).assistant.enabled, true);
  assert.equal(resolveServiceConfiguration({ ...configured, assistantEndpoint: "" }).collaboration.enabled, true);
});

test("services: endpoint validation rejects credentials, queries, fragments, schemes and hidden characters without disclosure", () => {
  for (const value of [
    "", "not a url", "http:example.invalid", "javascript:secret", "data:secret", "file:///secret", "//other.example.invalid/api",
    "https://user:secret@example.invalid/api", "https://example.invalid/api?key=secret",
    "https://example.invalid/api#secret", "https://example.invalid/\nsecret", "https:\\\\example.invalid\\secret",
    "/api?secret", "/api#secret", "/\\other.example.invalid/api",
  ]) {
    assert.equal(serviceEndpoint(value), null, value);
    const state = resolveServiceConfiguration({ ...configured, tokenEndpoint: value, assistantEndpoint: value });
    assert.equal(state.collaboration.enabled, false, value);
    assert.equal(state.assistant.enabled, false, value);
    assert.equal(JSON.stringify(state).includes("secret"), false, "Diagnostics do not echo rejected configuration");
  }
  assert.equal(serviceEndpoint("/api/design-assistant", true), "/api/design-assistant");
  assert.equal(serviceEndpoint("/api/design-assistant"), null);
  assert.equal(serviceEndpoint(" https://example.invalid/api "), "https://example.invalid/api");
  assert.equal(serviceEndpoint("http://localhost:5173/api/design-assistant"), LOCAL_ASSISTANT_ENDPOINT);
  const wrongLocalPort = resolveServiceConfiguration({ ...configured, localOnly: true, localAi: true,
    assistantEndpoint: "http://localhost:7071/api/design-assistant" });
  assert.equal(wrongLocalPort.assistant.enabled, false);
});

test("services: local-only mode cannot be unlocked by endpoint values; local AI uses only the fixed endpoint", () => {
  const local = resolveServiceConfiguration({ ...configured, localOnly: true });
  assert.equal(local.collaboration.enabled, false);
  assert.equal(local.assistant.enabled, false);
  assert.equal(local.shareAppUrl, "");
  const ai = resolveServiceConfiguration({ ...configured, localOnly: true, localAi: true, assistantEndpoint: LOCAL_ASSISTANT_ENDPOINT });
  assert.equal(ai.assistant.enabled, true);
  assert.equal(ai.collaboration.enabled, false);
  assert.equal(ai.assistant.endpoint, LOCAL_ASSISTANT_ENDPOINT);
  assert.equal(resolveServiceConfiguration({ ...configured, localOnly: true, localAi: true }).assistant.state, "invalid");
});

test("services: standalone sharing requires a safe hosted destination and an absolute Assistant endpoint", () => {
  const standalone = resolveServiceConfiguration({ ...configured, singleFile: true,
    assistantEndpoint: "https://assistant.example.invalid/api/design-assistant" });
  assert.equal(standalone.collaboration.enabled, true);
  assert.equal(standalone.assistant.enabled, true);
  assert.equal(standalone.shareAppUrl, configured.publicAppUrl);
  for (const publicAppUrl of ["", "file:///model.html", "https://host.invalid/#key=secret"]) {
    const missing = resolveServiceConfiguration({ ...configured, singleFile: true, publicAppUrl });
    assert.equal(missing.collaboration.state, "invalid");
    assert.equal(missing.collaboration.endpoint, "");
    assert.equal(missing.shareAppUrl, "");
  }
  assert.equal(resolveServiceConfiguration({ ...configured, singleFile: true }).assistant.state, "invalid");
  assert.equal(resolveServiceConfiguration({ ...configured, publicAppUrl: "" }).collaboration.enabled, true,
    "Hosted sharing uses the current hosted page");
  assert.equal(Object.isFrozen(standalone), true);
  assert.equal(Object.isFrozen(standalone.collaboration), true);
});

test("services: runtime provider overrides and Assistant calls cannot bypass local disabled state", async () => {
  const { SERVICES } = await import("../../src/services.ts");
  const { WebPubSubProvider } = await import("../../src/collab/WebPubSubProvider.ts");
  const { askDesignAssistant, askThreatModelDesigner } = await import("../../src/designAssistant.ts");
  assert.equal(SERVICES.collaboration.enabled, false);
  assert.equal(SERVICES.assistant.enabled, false);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected network"); };
  const ydoc = new Y.Doc();
  try {
    assert.throws(() => new WebPubSubProvider({ ydoc, room: "synthetic-room", tokenEndpoint: configured.tokenEndpoint }), /local-only/);
    await assert.rejects(askDesignAssistant({ mode: "chat", question: "Synthetic", context: {} }), /credential-free local mode/);
    await assert.rejects(askThreatModelDesigner({ mode: "design", question: "Synthetic", context: {}, history: [] }), /credential-free local mode/);
    assert.equal(requests, 0);
  } finally { ydoc.destroy(); globalThis.fetch = originalFetch; }
});

test("services: a rejected selected file disables both capabilities without using supplied endpoint fallbacks", () => {
  const state = resolveServiceConfiguration({
    ...configured, configurationError: "Selected service configuration is unavailable.", source: "Selected service configuration",
  });
  assert.equal(state.collaboration.enabled, false);
  assert.equal(state.assistant.enabled, false);
  assert.equal(state.collaboration.endpoint, "");
  assert.equal(state.assistant.endpoint, "");
  assert.equal(state.shareAppUrl, "");
  assert.equal(state.source, "Selected service configuration");
});
