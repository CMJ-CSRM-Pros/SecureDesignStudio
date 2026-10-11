import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as Y from "yjs";
import { publicPowerPlatformPrompt as question, publicPowerPlatformDesignFixture } from "../browser/fixture.mjs";

const { resolveLibraries } = await import("../../src/libraries/registry.ts");
const { buildDesignerContext, applyDesignerResult } = await import("../../src/threatModelDesigner.ts");
const { emptyDocument, resolveNodeTypeDef } = await import("../../src/types.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { buildDfdReviewContext } = await import("../../src/dfdReviewContext.ts");
const { validateAiDesignGuidance, assertAiRequestBudget } = await import("../../shared/aiDesignGuidance.ts");
const { designCatalogChoices, validateDesignCatalog } = await import("../../shared/designContract.ts");
const { withLibraryDefinitions, libraryNodeTypes } = await import("../../src/libraries/document.ts");
const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
const { buildStandaloneHtml, capturePristineHtml } = await import("../../src/embeddedDoc.ts");
const { diffDocuments } = await import("../../src/diff.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");

const requestedIds = ["PowerPages", "CopilotStudio", "Dataverse", "Dataverse Table", "Dataverse Plugin", "PowerPlatformConnectors"];
const powerPlatformGuidanceIds = [
  "D365BusinessCentral", "D365Commerce", "D365ContactCenter", "D365CustomerInsights", "D365CustomerService",
  "D365CustomerVoice", "Dynamics365", "D365FieldService", "D365Finance", "D365FinanceOperations",
  "D365HumanResources", "D365IntelligentOrderManagement", "D365ProjectOperations", "D365Sales",
  "D365SalesInsights", "D365SupplyChainManagement", "AIBuilder", "Agent365", "OnPremisesGateway",
  "PowerApps", "PowerAutomate", ...requestedIds,
];
const core = resolveLibraries([]);
const catalog = { nodeTypes: core.nodes, authentication: core.authentication, classifications: core.classifications };
const createModel = () => withLibraryDefinitions(normalizeDoc(
  applyDesignerResult(emptyDocument(), null, publicPowerPlatformDesignFixture(), catalog).doc,
), core);

test("public Power Platform: raw store-path capture is native-canonical before any normalization", () => {
  const before = emptyDocument();
  const applied = applyDesignerResult(before, null, publicPowerPlatformDesignFixture(), {
    ...catalog, nodeTypes: libraryNodeTypes(before, core),
  });
  // This is the real store capture path; the expected model is never normalized.
  const stored = withLibraryDefinitions(applied.doc, core);
  const saved = JSON.parse(JSON.stringify(stored));
  const reopened = JSON.parse(JSON.stringify(normalizeDoc(JSON.parse(JSON.stringify(stored)))));
  assert.deepEqual(reopened, saved, "Native Open must not add fields to freshly captured public definitions");
  for (const id of ["PowerPages", "CopilotStudio", "Dataverse"]) {
    const definition = saved.nodeTypes.find(type => type.id === id).definition;
    assert.deepEqual(definition.resourceProviders, []);
    assert.equal(definition.policyStatus, "Unspecified");
    assert.deepEqual(definition.allowedAuthMethods, []);
    assert.deepEqual(definition.allowedDataTypes, []);
    assert.equal(definition.defaultDfdRole, undefined);
  }
  assert.deepEqual(before, emptyDocument(), "Capture does not mutate the input document");
});

test("public Power Platform: the exact requested architecture has neutral default choices without optional libraries", () => {
  const context = buildDesignerContext(emptyDocument(), null, catalog);
  assert.deepEqual(core.statuses, []);
  const choices = new Set(context.catalog.nodeTypes.map(type => type.id));
  assert.deepEqual(requestedIds.filter(id => !choices.has(id)), [],
    `Missing public choices for "${question}"; Microsoft 365 Copilot must not be a required substitute.`);
  assert.equal(core.nodes.length, 169);
  const labels = { Dataverse: "Microsoft Dataverse", "Dataverse Table": "Dataverse Table", "Dataverse Plugin": "Dataverse Plugin",
    CopilotStudio: "Microsoft Copilot Studio", PowerPlatformConnectors: "Power Platform connectors" };
  for (const [id, label] of Object.entries(labels)) {
    const type = core.nodes.find(type => type.id === id);
    assert.equal(type.label, label);
    assert.equal(type.definition.serviceTreeId, "");
    assert.deepEqual(type.definition.allowedAuthMethods, []);
    assert.deepEqual(type.definition.allowedDataTypes, []);
    assert.equal(type.definition.policyStatus, "Unspecified");
    assert.equal(type.definition.defaultDfdRole, undefined);
    for (const field of ["defaultPrivacyBoundary", "geoBoundary", "postSubscriptionRetention", "gdprHandling"]) {
      assert.equal(type.definition[field], undefined, `${id} must not acquire private ${field}`);
    }
    assert.equal(type.definition.endpointRegex, "^$", "No private or misleading shared-host classifier");
  }
  assert.ok(choices.has("m365_copilot") && choices.has("Agent365"), "Distinct choices remain available");
  assert.equal(choices.has("Copilot Studio"), false);
  assert.equal(choices.has("Connectors"), false);
});

test("public Power Platform: the 27 reviewed products retain compact validated untrusted guidance", () => {
  assert.equal(new Set(powerPlatformGuidanceIds).size, 27);
  const withGuidance = new Set(core.nodes.filter(type => type.definition.aiDesignGuidance).map(type => type.id));
  for (const id of powerPlatformGuidanceIds) {
    assert.ok(withGuidance.has(id), `${id} remains in the reviewed guidance set`);
    const type = core.nodes.find(type => type.id === id);
    const value = type.definition.aiDesignGuidance;
    assert.deepEqual(validateAiDesignGuidance(value), value);
    assert.ok(value.content.length <= 1600);
    for (const heading of ["Context", "Dependencies", "Risks", "Uncertainty"]) assert.ok(value.content.includes(`${heading}\n`));
    assert.ok(value.sources.length && value.sources.every(url => url.startsWith("https://learn.microsoft.com/")));
    assert.equal(value.revision, 1);
    assert.equal(value.updatedOn, "2026-10-08");
    assert.equal(type.definition.policyStatus, "Unspecified");
    assert.deepEqual(type.definition.allowedAuthMethods, []);
    assert.deepEqual(type.definition.allowedDataTypes, []);
  }
  assert.deepEqual(JSON.parse(readFileSync(new URL("../../src/data/nodeTypes.json", import.meta.url))), [],
    "Neutral types must not repopulate the private curated array");
  assert.ok(resolveNodeTypeDef("azure.security.waf").aiDesignGuidance);
  for (const id of ["azure.compute.vm-infra", "azure.network.network-security", "azure.network.route"]) {
    assert.equal(resolveNodeTypeDef(id).aiDesignGuidance, undefined, `${id} remains owner-withheld`);
  }
  assert.ok(resolveNodeTypeDef("m365_copilot").aiDesignGuidance);
  assert.ok(resolveNodeTypeDef("PowerBI").aiDesignGuidance);
});

test("public Power Platform: product meanings, variants and unresolved lifecycle are explicit", () => {
  const def = id => resolveNodeTypeDef(id, core.nodes);
  const text = id => `${def(id).description}\n${def(id).aiDesignGuidance.content}`;
  assert.equal(def("Dynamics365").category, "Dynamics 365 / Suite");
  assert.equal(def("D365FinanceOperations").category, "Dynamics 365 / Platform");
  assert.equal(def("D365Finance").category, "Dynamics 365 / Application");
  assert.equal(def("D365SalesInsights").category, "Dynamics 365 / Capability");
  assert.equal(def("Agent365").category, "Microsoft 365 / Agent governance");
  assert.match(text("D365BusinessCentral"), /For Business Central online, Power Automate through the Business Central connector is optional\./);
  assert.match(text("D365BusinessCentral"), /Power BI reporting is also optional and has mode-specific requirements\./);
  assert.match(text("PowerApps"), /canvas.*model-driven/s);
  assert.match(text("PowerApps"), /not necessarily Dataverse/);
  assert.match(text("PowerAutomate"), /[Cc]loud flows.*desktop flows/s);
  assert.match(text("D365CustomerInsights"), /Data.*Journeys/s);
  assert.match(text("D365ProjectOperations"), /Core.*Integrated with ERP.*manufacturing/s);
  assert.match(text("D365ProjectOperations"), /dual-write.*conditional/s);
  assert.match(text("D365CustomerVoice"), /lifecycle.*confirmation|lifecycle.*confirmed/s);
  assert.match(text("D365IntelligentOrderManagement"), /In Support.*not production availability evidence/s);
  assert.match(text("Dataverse Table"), /parent Dataverse APIs/);
  assert.match(text("Dataverse Plugin"), /synchronous.*asynchronous/s);
  assert.match(text("Dataverse Plugin"), /not assume one shared operating-system process/);
  assert.match(text("CopilotStudio"), /Microsoft 365 Copilot.*Agent 365/s);
  assert.match(text("CopilotStudio"), /ask which product/);
  assert.match(text("PowerPlatformConnectors"), /selected connector and backend/);
  assert.match(text("PowerPages"), /not an instruction to deploy a separate customer/);
});

test("public catalog: source construction retains all provider values and canonicalizes only absent provider arrays", () => {
  const source = JSON.parse(readFileSync(new URL("../../src/data/microsoftCloudNodeTypes.json", import.meta.url)));
  for (const entry of source) {
    const effective = resolveNodeTypeDef(entry.id);
    assert.deepEqual(effective.resourceProviders, entry.resourceProviders ?? [], entry.id);
    for (const key of Object.keys(entry).filter(key => !["id", "label"].includes(key))) {
      assert.deepEqual(effective[key], entry[key], `${entry.id}: preserve ${key}`);
    }
  }
});

test("public Power Platform: exact prompt and proper IDs use actual no-library Designer/reviewer contexts", () => {
  const before = emptyDocument();
  const request = { mode: "design", question, history: [], context: buildDesignerContext(before, null, catalog) };
  const response = publicPowerPlatformDesignFixture();
  validateDesignCatalog(response, designCatalogChoices(request.context.catalog));
  assertAiRequestBudget(request);
  const { doc } = applyDesignerResult(before, null, response, catalog);
  assert.equal(before.nodes.length, 0, "Pure design application does not mutate its baseline");
  assert.deepEqual(doc.nodes.map(node => node.type), ["", "PowerPages", "CopilotStudio", "Dataverse"]);
  assert.deepEqual(doc.nodes.map(node => node.dfdRoleOverride), ["ExternalInteractor", "Process", "Process", "DataStore"]);
  assert.equal(doc.nodes.some(node => ["m365_copilot", "Agent365", "PowerPlatformConnectors", "Dataverse Table", "Dataverse Plugin"].includes(node.type)), false,
    "No forced product substitution or automatic dependency/component nodes");
  assert.deepEqual(doc.edges.map(edge => [doc.nodes.find(n => n.id === edge.source).type, doc.nodes.find(n => n.id === edge.target).type]),
    [["", "PowerPages"], ["PowerPages", "CopilotStudio"], ["CopilotStudio", "Dataverse"]]);
  const normalized = normalizeDoc(doc);
  const review = buildDfdReviewContext(normalized, normalized.scenarios[0], core.nodes);
  assert.equal(review.nodes.find(node => node.type === "").reviewContext, "endpoint-only");
  assert.deepEqual(review.aiDesignGuidance.map(entry => entry.typeId).sort(), ["CopilotStudio", "Dataverse", "PowerPages"]);
  for (const entry of review.aiDesignGuidance) {
    const authored = request.context.aiDesignGuidance.find(value => value.typeId === entry.typeId);
    for (const field of ["content", "sources", "revision", "updatedOn"]) assert.deepEqual(entry[field], authored[field]);
    assert.deepEqual(entry.appliesToNodeIds, doc.nodes.filter(node => node.type === entry.typeId).map(node => node.id));
  }
  assertAiRequestBudget({ mode: "analyze", question, context: review });
  normalized.scenarios[0].nodeScopeReasons = {
    [normalized.nodes.find(node => node.type === "Dataverse").id]: "External system boundary for this review",
  };
  assert.equal(buildDfdReviewContext(normalized, normalized.scenarios[0], core.nodes).aiDesignGuidance.some(entry => entry.typeId === "Dataverse"), false);
});

test("public Power Platform: saved definitions and explicit absence win over installed guidance and failed optional selections", () => {
  const doc = createModel();
  const saved = doc.nodeTypes.find(type => type.id === "Dataverse");
  saved.label = "Saved Dataverse name";
  saved.definition.description = "Saved owner meaning.";
  saved.definition.aiDesignGuidance = { content: "Saved unverified instruction reference.", sources: [], revision: 3, updatedOn: "2026-10-01" };
  for (const available of [core, resolveLibraries([{ source: "Missing", error: "Synthetic unavailable package" }]),
    resolveLibraries([{ source: "Rejected", value: { format: "invalid" } }])]) {
    const loaded = withLibraryDefinitions(normalizeDoc(doc, available.nodes), available);
    const selected = loaded.nodeTypes.find(type => type.id === "Dataverse");
    assert.equal(selected.label, saved.label);
    assert.deepEqual(selected.definition.aiDesignGuidance, saved.definition.aiDesignGuidance);
    const context = buildDesignerContext(loaded, loaded.scenarios[0].id, { ...catalog, nodeTypes: available.nodes });
    assert.equal(context.aiDesignGuidance.find(entry => entry.typeId === "Dataverse").revision, 3);
    delete selected.definition.aiDesignGuidance;
    assert.equal(buildDfdReviewContext(loaded, loaded.scenarios[0], available.nodes).aiDesignGuidance.some(entry => entry.typeId === "Dataverse"), false);
    assert.equal(buildDesignerContext(loaded, loaded.scenarios[0].id, { ...catalog, nodeTypes: available.nodes })
      .aiDesignGuidance.some(entry => entry.typeId === "Dataverse"), false);
  }
  const legacy = normalizeDoc({ ...emptyDocument(), nodeTypes: [{ id: "Unknown legacy product", label: "Legacy" }] });
  assert.equal(legacy.nodeTypes.find(type => type.id === "Unknown legacy product").definition, undefined);
});

test("public Power Platform: proposed model retains native, embedded, history and synthetic Yjs portability", t => {
  const doc = createModel();
  const before = emptyDocument();
  const cloned = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(cloned, doc);
  assert.deepEqual(diffDocuments(doc, cloned), []);
  for (const id of ["PowerPages", "CopilotStudio", "Dataverse"]) {
    assert.ok(doc.nodeTypes.find(type => type.id === id).definition.aiDesignGuidance, "Used public definitions are portable");
  }
  assert.equal(doc.nodeTypes.find(type => type.id === "Dataverse Plugin").definition, undefined, "Unused public definitions are not copied into the document");
  const storage = new Map(), oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  saveAutosave({ doc, past: [before], future: [doc], view: { activeScenarioId: doc.scenarios[0].id, filter: {} } });
  const restored = loadAutosaveRaw();
  assert.deepEqual(normalizeDoc(restored.doc), doc);
  assert.deepEqual(normalizeDoc(restored.past[0]), normalizeDoc(before));
  assert.deepEqual(normalizeDoc(restored.future[0]), doc);
  capturePristineHtml("<html><body></body></html>");
  const html = buildStandaloneHtml(JSON.stringify({ format: "secure-design-studio-diagram", version: 2, doc }));
  assert.deepEqual(normalizeDoc(JSON.parse(/id="ps-embedded-doc">([\s\S]*?)<\/script>/.exec(html)[1]).doc), doc);
  const a = createYShape(), b = createYShape();
  t.after(() => { a.ydoc.destroy(); b.ydoc.destroy(); });
  reconcileLocalToY(a, doc);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  const received = buildDocFromY(b);
  for (const id of ["PowerPages", "CopilotStudio", "Dataverse"]) {
    assert.deepEqual(received.nodeTypes.find(type => type.id === id).definition, doc.nodeTypes.find(type => type.id === id).definition);
  }
  assert.deepEqual([...received.nodes].sort((a, b) => a.id.localeCompare(b.id)), [...doc.nodes].sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(received.scenarios, doc.scenarios);
});
