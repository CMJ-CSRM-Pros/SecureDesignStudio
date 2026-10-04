import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { documentFixture, IDS } from "./catalog-fixtures.mjs";

const { exportTm7, prepareTm7Export, Tm7ExportError } = await import("../../src/tm7Export.ts");
const { parseTm7, Tm7ImportError } = await import("../../src/tm7Import.ts");
const { resolveNodeReviewScope, resolveDfdRole } = await import("../../src/dfdSemantics.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { emptyNodeTypeDefinition } = await import("../../src/types.ts");

globalThis.DOMParser = class extends DOMParser {
  constructor() { super({ onError: level => { if (level !== "warning") throw new Error("Malformed XML"); } }); }
};
const readXml = xml => new globalThis.DOMParser().parseFromString(xml, "text/xml");
const all = (root, name) => [...root.getElementsByTagNameNS("*", name)];
const direct = (root, name) => [...root.childNodes].find(n => n.nodeType === 1 && n.localName === name);
const text = (root, name) => direct(root, name)?.textContent ?? "";
const property = (root, name) => all(direct(root, "Properties"), "anyType")
  .find(item => text(item, "DisplayName") === name);
const propText = (root, name) => text(property(root, name), "Value");
const objects = surface => all(surface, "KeyValueOfguidanyType").map(entry => direct(entry, "Value"));
const surfaces = root => all(root, "DrawingSurfaceModel");
const serialize = root => new XMLSerializer().serializeToString(root);

function sixNodes() {
  const doc = documentFixture();
  doc.nodes = Array.from({ length: 6 }, (_, i) => ({
    ...doc.nodes[0], id: `n_${i}`, title: i === 0 ? "SQL database" : `Browser ${i}`,
    type: i === 0 || i === 1 ? "sql" : "",
    position: { x: i * 150 - 200, y: i * -30 },
    ...(i === 0 ? { dfdRoleOverride: "Process" } : {}),
    ...(i === 2 ? { dfdRoleOverride: "ExternalInteractor" } : {}),
  }));
  doc.nodeTypes = [{ id: "sql", label: "SQL service", definition: { ...emptyNodeTypeDefinition(), defaultDfdRole: "DataStore" } }];
  doc.edges = Array.from({ length: 5 }, (_, i) => ({
    ...doc.edges[0], id: `e_${i}`, source: "n_0", target: "n_1",
    authenticationTypes: ["ApiKey", "ClientCertificateMtls"],
  }));
  doc.scenarios = [0, 1].map(i => ({
    ...doc.scenarios[0], id: `s_${i}`, name: "Duplicate tab title",
    nodeIds: doc.nodes.map(n => n.id), edgeIds: doc.edges.map(e => e.id),
    edgeNumbers: Object.fromEntries(doc.edges.map((e, j) => [e.id, j + 1])),
    nodeScopeReasons: i === 0 ? { n_1: "Owned <elsewhere> & reviewed separately", n_2: "Inactive external reason" } : {},
  }));
  return doc;
}

test("TM7 roles: six-node native declarations/instances use E2 semantics, not titles", () => {
  const source = sixNodes(), before = structuredClone(source);
  const result = prepareTm7Export(source), root = readXml(result.xml);
  assert.deepEqual(source, before);
  for (const surface of surfaces(root)) {
    const nodes = objects(surface).filter(n => text(n, "GenericTypeId") !== "GE.DF");
    assert.deepEqual(nodes.map(n => text(n, "GenericTypeId")), ["GE.P", "GE.DS", "GE.EI", "GE.P", "GE.P", "GE.P"]);
    assert.deepEqual(nodes.slice(0, 3).map(n => n.getAttribute("i:type")), ["StencilEllipse", "StencilParallelLines", "StencilRectangle"]);
  }
  const definitions = all(root, "ElementType");
  for (const [id, representation] of [["GE.P", "Ellipse"], ["GE.DS", "ParallelLines"], ["GE.EI", "Rectangle"]]) {
    assert.equal(text(definitions.find(n => text(n, "Id") === id), "Representation"), representation);
  }
  assert.match(result.diagnostics.join("\n"), /Service types.*provenance/);
});

test("TM7 scope: per-occurrence reason is effective only on that scenario and never external", () => {
  const result = prepareTm7Export(sixNodes()), root = readXml(result.xml);
  const a = objects(surfaces(root)[0]), b = objects(surfaces(root)[1]);
  assert.equal(propText(a[1], "Out Of Scope"), "true");
  assert.equal(propText(a[1], "Reason For Out Of Scope"), "Owned <elsewhere> & reviewed separately");
  assert.equal(propText(b[1], "Out Of Scope"), "false");
  assert.equal(propText(b[1], "Reason For Out Of Scope"), "");
  assert.equal(propText(a[2], "Out Of Scope"), "false");
  assert.equal(propText(a[2], "Reason For Out Of Scope"), "");
  assert.match(result.diagnostics.join("\n"), /External Interactors cannot be out of scope/);
  const imported = parseTm7(result.xml).doc;
  assert.equal(imported.nodes[0].type, "");
  assert.equal(imported.nodes[0].dfdRoleOverride, "Process");
  assert.equal(resolveNodeReviewScope(imported.nodes[1], imported.scenarios[0], imported.nodeTypes).disposition, "outOfScope");
  assert.equal(resolveNodeReviewScope(imported.nodes[1], imported.scenarios[1], imported.nodeTypes).disposition, "inScope");
  assert.equal(normalizeDoc(imported).nodes[1].dfdRoleOverride, "DataStore");
});

test("TM7 references: stable tabs, emitted occurrences and parallel flow endpoints are exact", () => {
  const source = sixNodes(), result = prepareTm7Export(source), root = readXml(result.xml);
  const renamed = structuredClone(source); renamed.scenarios[0].name = "Renamed";
  const next = prepareTm7Export(renamed);
  assert.deepEqual(result.references, next.references);
  assert.equal(result.references.length, 22);
  const ids = all(root, "*").map(el => el.getAttribute("z:Id")).filter(Boolean);
  assert.equal(ids.length, result.references.length + surfaces(root).length + 1);
  assert.equal(new Set(ids).size, ids.length);
  for (const surface of surfaces(root)) {
    const localObjects = objects(surface);
    const nodes = localObjects.filter(n => text(n, "GenericTypeId") !== "GE.DF");
    const flows = localObjects.filter(n => text(n, "GenericTypeId") === "GE.DF");
    assert.equal(new Set(flows.map(n => text(n, "Guid"))).size, 5);
    for (const flow of flows) {
      assert.equal(text(flow, "SourceGuid"), text(nodes[0], "Guid"));
      assert.equal(text(flow, "TargetGuid"), text(nodes[1], "Guid"));
    }
    for (const object of localObjects) {
      const ref = result.references.find(r => r.tabGuid === text(surface, "Guid") && r.objectGuid === text(object, "Guid"));
      assert.ok(ref);
      assert.equal(ref.serializationId, object.getAttribute("z:Id"));
    }
  }
  const imported = parseTm7(result.xml).doc;
  assert.equal(imported.edges.length, 5);
  assert.deepEqual(imported.scenarios.map(s => s.id), surfaces(root).map(s => text(s, "Guid")));
});

test("TM7 no-scenario fallback retains roles and exports no borrowed scope", () => {
  const source = sixNodes(); source.scenarios = [];
  const result = prepareTm7Export(source), root = readXml(result.xml);
  assert.equal(surfaces(root).length, 1);
  assert.ok(result.references.every(r => r.scenarioId === null));
  assert.ok(objects(surfaces(root)[0]).every(n => propText(n, "Out Of Scope") === "false"));
  assert.equal(parseTm7(result.xml).doc.nodes[1].dfdRoleOverride, "DataStore");
});

test("TM7 text: valid XML escaping and auth/inventory metadata survive, invalid XML text fails", () => {
  const source = documentFixture();
  source.nodes[0].title = `Node <&>"' \u{1F600}`;
  source.nodes[0].serviceTreeId = "ASSET-123";
  source.scenarios[0].nodeScopeReasons = { [IDS.source]: `Reason <&>"'\nsecond line` };
  source.edges[0].authenticationTypes = ["ApiKey", "ClientCertificateMtls"];
  const result = parseTm7(exportTm7(source));
  assert.equal(result.doc.nodes[0].title, source.nodes[0].title);
  assert.equal(result.doc.nodes[0].serviceTreeId, "ASSET-123");
  assert.deepEqual(result.doc.edges[0].authenticationTypes, source.edges[0].authenticationTypes);
  assert.equal(result.doc.scenarios[0].nodeScopeReasons[IDS.source], source.scenarios[0].nodeScopeReasons[IDS.source]);
  for (const invalid of ["\u0000", "\u0001", "\uD800", "\uFFFF"]) {
    source.nodes[0].title = invalid;
    assert.throws(() => exportTm7(source), Tm7ExportError);
  }
});

for (const [name, change] of [
  ["duplicate object IDs", d => { d.nodes[1].id = d.nodes[0].id; }],
  ["case-colliding GUIDs", d => { d.nodes[0].id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; d.nodes[1].id = d.nodes[0].id.toUpperCase(); }],
  ["deterministic mapping collision", d => {
    const previous = d.nodes[0].id;
    d.nodes[0].id = "n_opaque";
    d.edges[0].source = "n_opaque";
    d.scenarios[0].nodeIds = d.scenarios[0].nodeIds.map(id => id === previous ? "n_opaque" : id);
    const mapped = prepareTm7Export(d).references[0].objectGuid;
    d.nodes.push({ ...d.nodes[0], id: mapped });
  }],
  ["missing graph endpoint", d => { d.edges[0].source = "missing"; }],
  ["endpoint absent from tab", d => { d.scenarios[0].nodeIds.pop(); }],
  ["missing membership", d => { d.scenarios[0].nodeIds.push("missing"); }],
  ["duplicate membership", d => { d.scenarios[0].edgeIds.push(d.edges[0].id); }],
  ["invalid coordinate", d => { d.nodes[0].position.x = NaN; }],
  ["invalid sequence", d => { d.scenarios[0].edgeNumbers[d.edges[0].id] = Infinity; }],
  ["unknown role", d => { d.nodes[0].dfdRoleOverride = "UnknownRole"; }],
]) {
  test(`TM7 export rejects ${name} rather than producing a misleading file`, () => {
    const source = documentFixture(); change(source);
    assert.throws(() => exportTm7(source), Tm7ExportError);
  });
}

// Independent native-shaped fixture: not generated by the adapter under test.
const guid = i => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`;
function nativeNode(id, role, shape, flag = "false", reason = "") {
  return `<KeyValueOfguidanyType><Key>${id}</Key><Value i:type="${shape}">
    <GenericTypeId>${role}</GenericTypeId><Guid>${id}</Guid><TypeId>${role}</TypeId>
    <Properties>
      <anyType><DisplayName>Name</DisplayName><Value>Independent node</Value></anyType>
      <anyType><DisplayName>Out Of Scope</DisplayName><Value>${flag}</Value></anyType>
      <anyType><DisplayName>Reason For Out Of Scope</DisplayName><Value>${reason}</Value></anyType>
    </Properties><Left>100</Left><Top>100</Top><Width>100</Width><Height>100</Height>
  </Value></KeyValueOfguidanyType>`;
}
function nativeTab(id, borders, lines = "") {
  return `<DrawingSurfaceModel><Guid>${id}</Guid><Borders>${borders}</Borders><Lines>${lines}</Lines></DrawingSurfaceModel>`;
}
function nativeModel(tabs, tail = "") {
  return `<ThreatModel xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><DrawingSurfaceList>${tabs}</DrawingSurfaceList>${tail}</ThreatModel>`;
}

test("TM7 import independently recognizes all three native roles without service-type inference", () => {
  const xml = nativeModel(nativeTab(guid(10),
    nativeNode(guid(1), "GE.P", "StencilEllipse") +
    nativeNode(guid(2), "GE.DS", "StencilParallelLines", "true", "Different owner") +
    nativeNode(guid(3), "GE.EI", "StencilRectangle", "true", "External evidence")));
  const result = parseTm7(xml);
  assert.deepEqual(result.doc.nodes.map(n => n.dfdRoleOverride), ["Process", "DataStore", "ExternalInteractor"]);
  assert.ok(result.doc.nodes.every(n => n.type === ""));
  assert.equal(result.doc.scenarios[0].nodeScopeReasons[guid(2)], "Different owner");
  assert.equal(resolveNodeReviewScope(result.doc.nodes[2], result.doc.scenarios[0]).disposition, "external");
  assert.match(result.diagnostics.join("\n"), /inactive evidence/);
});

test("TM7 import diagnoses contradictory/empty scope without fabricating a reason", () => {
  for (const [flag, reason] of [["true", ""], ["false", "Contradiction"], ["unknown", "Value"]]) {
    const result = parseTm7(nativeModel(nativeTab(guid(10), nativeNode(guid(1), "GE.P", "StencilEllipse", flag, reason))));
    assert.deepEqual(result.doc.scenarios[0].nodeScopeReasons, {});
    assert.ok(result.diagnostics.length);
  }
  const oversized = parseTm7(nativeModel(nativeTab(guid(10), nativeNode(guid(1), "GE.P", "StencilEllipse", "true", "x".repeat(16001)))));
  assert.equal(typeof oversized.doc.scenarios[0].nodeScopeReasons[guid(1)], "object");
  assert.match(oversized.diagnostics.join("\n"), /truncated recovery evidence/);
  assert.equal(resolveNodeReviewScope(oversized.doc.nodes[0], oversized.doc.scenarios[0]).disposition, "inScope");
});

test("TM7 import retains unsupported roles as unresolved evidence, never guessed by geometry", () => {
  const result = parseTm7(nativeModel(nativeTab(guid(10), nativeNode(guid(1), "CUSTOM", "StencilEllipse"))));
  assert.equal(resolveDfdRole(result.doc.nodes[0]).confidence, "unresolved");
  assert.match(result.diagnostics.join("\n"), /Unsupported TM7 role CUSTOM/);
});

test("TM7 import rejects cross-tab role/endpoint conflicts and same-tab duplicate identities", () => {
  const p = nativeNode(guid(1), "GE.P", "StencilEllipse"), ds = nativeNode(guid(1), "GE.DS", "StencilParallelLines");
  assert.throws(() => parseTm7(nativeModel(nativeTab(guid(10), p) + nativeTab(guid(11), ds))), /conflicting DFD roles/);
  assert.throws(() => parseTm7(nativeModel(nativeTab(guid(10), p + p))), /Duplicate object GUID/);
  assert.throws(() => parseTm7(nativeModel(nativeTab(guid(10), p) + nativeTab(guid(10), p))), /Duplicate tab GUID/);
  assert.throws(() => parseTm7(nativeModel(nativeTab(guid(1), p))), /shared by a tab/);
  assert.throws(() => parseTm7(nativeModel(nativeTab(guid(10), nativeNode(guid(1), "GE.DS", "StencilEllipse")))), /conflicting native role/);
  const root = readXml(exportTm7(sixNodes()));
  const flow = objects(surfaces(root)[1]).find(n => text(n, "GenericTypeId") === "GE.DF");
  direct(flow, "SourceGuid").textContent = text(objects(surfaces(root)[1])[2], "Guid");
  assert.throws(() => parseTm7(serialize(root)), /conflicting endpoints/);
});

test("TM7 import refuses dangling, cross-tab-only and mismatched dictionary references", () => {
  const root = readXml(exportTm7(documentFixture()));
  const first = objects(surfaces(root)[0])[0];
  direct(first.parentNode, "Key").textContent = guid(50);
  assert.throws(() => parseTm7(serialize(root)), /key and object GUID disagree/);
  const missing = readXml(exportTm7(documentFixture()));
  const node = objects(surfaces(missing)[0])[1];
  node.parentNode.parentNode.removeChild(node.parentNode);
  assert.throws(() => parseTm7(serialize(missing)), /endpoint missing from that tab/);
  const crossTab = readXml(exportTm7(sixNodes()));
  const shared = objects(surfaces(crossTab)[0])[1];
  shared.parentNode.parentNode.removeChild(shared.parentNode);
  assert.throws(() => parseTm7(serialize(crossTab)), /endpoint missing from that tab/);
});

test("TM7 import reports unsupported threat/detail loss and preserves number-compaction disclosure", () => {
  const doc = documentFixture(); doc.issues = [{ id: "i_test" }];
  assert.match(prepareTm7Export(doc).diagnostics.join("\n"), /ordinary issues.*omitted/);
  const xml = exportTm7(doc).replace('<ThreatInstances xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />',
    "<ThreatInstances><UnsupportedThreat>Authored justification</UnsupportedThreat></ThreatInstances>");
  const result = parseTm7(xml);
  assert.match(result.diagnostics.join("\n"), /not a complete threat import/);
  assert.match(result.diagnostics.join("\n"), /compacted/);
  assert.equal(result.doc.issues.length, 0);
  assert.equal(result.doc.scenarios[0].edgeNumbers[IDS.edge], 1);
});

test("TM7 flow rights: nonblank exported flows get one loss notice without leaking or mapping text", () => {
  const doc = documentFixture();
  doc.edges[0].requiredAccessRights = "PRIVATE_RIGHTS\n  read/write/execute";
  doc.scenarios.push({ ...structuredClone(doc.scenarios[0]), id: "s_shared" });
  const before = structuredClone(doc), result = prepareTm7Export(doc);
  const notices = result.diagnostics.filter(message => /Required access-rights text/.test(message));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /1 exported flow is not included in TM7.*\.tma/);
  assert.equal(result.references.filter(ref => ref.kind === "edge").length, 2);
  assert.equal(result.xml.includes("PRIVATE_RIGHTS"), false);
  assert.equal(result.diagnostics.join("\n").includes("PRIVATE_RIGHTS"), false);
  assert.equal(parseTm7(result.xml).doc.edges[0].requiredAccessRights, undefined);
  assert.deepEqual(doc, before);
});

test("TM7 flow rights: absent, empty and whitespace-only text have no rights omission notice", () => {
  for (const value of [undefined, "", " \r\n\t "]) {
    const doc = documentFixture();
    doc.edges[0].requiredAccessRights = value;
    assert.equal(prepareTm7Export(doc).diagnostics.some(message => /Required access-rights text/.test(message)), false);
  }
});

test("TM7 flow rights: unrelated unassigned flows do not trigger the exported-flow notice", () => {
  const doc = documentFixture();
  doc.edges.push({ ...doc.edges[0], id: "e_unassigned", requiredAccessRights: "Not selected for export" });
  const result = prepareTm7Export(doc);
  assert.equal(result.references.some(ref => ref.entityId === "e_unassigned"), false);
  assert.equal(result.diagnostics.some(message => /Required access-rights text/.test(message)), false);
  assert.match(result.diagnostics.join("\n"), /Objects outside every scenario/);
});

test("TM7 flow rights: no-scenario fallback counts independently emitted parallel flows", () => {
  const doc = documentFixture();
  doc.scenarios = [];
  doc.edges[0].requiredAccessRights = "Read";
  doc.edges.push({ ...doc.edges[0], id: "e_parallel", requiredAccessRights: "Write" });
  const result = prepareTm7Export(doc);
  assert.match(result.diagnostics.join("\n"), /Required access-rights text on 2 exported flows is not included in TM7/);
  assert.equal(result.references.filter(ref => ref.kind === "edge").length, 2);
  assert.ok(result.references.every(ref => ref.scenarioId === null));
});

const networkFields = ["inboundAllow", "inboundDeny", "outboundAllow", "outboundDeny"];
const networkLosses = result => result.diagnostics.filter(message => /Boundary network text/.test(message));
function withNetworkBoundary() {
  const doc = documentFixture();
  doc.boundaries = [{
    id: "b_network", type: "security", title: "Network", nodeIds: [],
    position: { x: 0, y: 0 }, size: { width: 800, height: 400 },
  }];
  doc.scenarios[0].boundaryIds = ["b_network"];
  return doc;
}

test("TM7 boundary network: each nonblank field reports one emitted boundary without text or native fields", () => {
  for (const key of networkFields) {
    const doc = withNetworkBoundary();
    doc.boundaries[0][key] = "PRIVATE_NETWORK_TEXT\n  192.0.2.10:443";
    doc.scenarios.push({ ...structuredClone(doc.scenarios[0]), id: "s_network_shared" });
    doc.edges[0].requiredAccessRights = "PRIVATE_RIGHTS_TEXT";
    const before = structuredClone(doc), result = prepareTm7Export(doc);
    assert.equal(networkLosses(result).length, 1);
    assert.match(networkLosses(result)[0], /1 exported security boundary is not included in TM7.*\.tma/);
    assert.equal(result.references.filter(ref => ref.kind === "boundary").length, 2);
    assert.match(result.diagnostics.join("\n"), /Required access-rights text on 1 exported flow/);
    assert.doesNotMatch(result.diagnostics.join("\n"), /PRIVATE_NETWORK_TEXT|192\.0\.2\.10|PRIVATE_RIGHTS_TEXT/);
    assert.doesNotMatch(result.xml, /PRIVATE_NETWORK_TEXT|192\.0\.2\.10|PRIVATE_RIGHTS_TEXT/);
    for (const field of networkFields) {
      assert.equal(result.xml.includes(field), false);
      assert.equal(parseTm7(result.xml).doc.boundaries[0][field], undefined);
    }
    assert.deepEqual(doc, before);
  }
});

test("TM7 boundary network: absent, null, empty and whitespace-only values produce no network notice", () => {
  for (const value of [undefined, null, "", " \r\n\t "]) {
    const doc = withNetworkBoundary();
    for (const key of networkFields) doc.boundaries[0][key] = value;
    assert.deepEqual(networkLosses(prepareTm7Export(doc)), []);
  }
});

test("TM7 boundary network: inactive privacy and nonmember security notes do not count as emitted", () => {
  const doc = withNetworkBoundary();
  const original = structuredClone(doc.boundaries[0]);
  doc.boundaries[0].type = "privacy";
  doc.boundaries[0].inboundAllow = "INACTIVE_NETWORK";
  doc.boundaries.push({ ...original, id: "b_unassigned", outboundDeny: "UNASSIGNED_NETWORK" });
  const result = prepareTm7Export(doc);
  assert.deepEqual(networkLosses(result), []);
  assert.equal(result.references.some(ref => ref.kind === "boundary"), false);
  assert.match(result.diagnostics.join("\n"), /Privacy boundaries are omitted/);
  assert.match(result.diagnostics.join("\n"), /Objects outside every scenario/);
  assert.doesNotMatch(result.xml + result.diagnostics.join("\n"), /INACTIVE_NETWORK|UNASSIGNED_NETWORK/);
});

test("TM7 boundary network: no-scenario fallback counts distinct emitted security boundaries once", () => {
  const doc = withNetworkBoundary();
  doc.scenarios = [];
  for (const key of networkFields) doc.boundaries[0][key] = "One boundary, four notes";
  doc.boundaries.push({ ...doc.boundaries[0], id: "b_second" });
  doc.boundaries.push({ ...doc.boundaries[0], id: "b_inactive", type: "privacy" });
  const result = prepareTm7Export(doc);
  assert.equal(networkLosses(result).length, 1);
  assert.match(networkLosses(result)[0], /2 exported security boundaries is not included in TM7/);
  assert.equal(result.references.filter(ref => ref.kind === "boundary").length, 2);
  assert.ok(result.references.every(ref => ref.scenarioId === null));
});

test("TM7 import refuses malformed XML, DTD and unsupported serialization references", () => {
  assert.throws(() => parseTm7("<ThreatModel><unclosed></ThreatModel>"), Tm7ImportError);
  assert.throws(() => parseTm7('<!DOCTYPE ThreatModel [<!ENTITY e "value">]><ThreatModel/>'), /DTD/);
  const xml = exportTm7(documentFixture());
  assert.throws(() => parseTm7(xml.replace('z:Id="i2"', 'z:Id="i1"')), /Duplicate XML serialization/);
  assert.throws(() => parseTm7(xml.replace('z:Id="i2"', 'z:Ref="i1"')), /Serialization reference/);
});

test("TM7 import accepts namespace aliases and canonical scope property IDs, not display-name guesses", () => {
  const xml = nativeModel(nativeTab(guid(10), nativeNode(guid(1), "GE.DS", "StencilParallelLines", "true", "Owned elsewhere")))
    .replaceAll("xmlns:i=", "xmlns:x=").replaceAll("i:type=", "x:type=")
    .replace("<DisplayName>Out Of Scope</DisplayName>", "<DisplayName>Localized flag</DisplayName><Name>71f3d9aa-b8ef-4e54-8126-607a1d903103</Name>")
    .replace("<DisplayName>Reason For Out Of Scope</DisplayName>", "<DisplayName>Localized reason</DisplayName><Name>752473b6-52d4-4776-9a24-202153f7d579</Name>");
  const result = parseTm7(xml);
  assert.equal(result.doc.nodes[0].dfdRoleOverride, "DataStore");
  assert.equal(result.doc.scenarios[0].nodeScopeReasons[guid(1)], "Owned elsewhere");
});

test("TM7 import rejects duplicate scope properties and incompatible standard TypeId", () => {
  const xml = nativeModel(nativeTab(guid(10), nativeNode(guid(1), "GE.P", "StencilEllipse")));
  assert.throws(() => parseTm7(xml.replace("</Properties>", "<anyType><DisplayName>Out Of Scope</DisplayName><Value>true</Value></anyType></Properties>")),
    /Duplicate native property/);
  assert.throws(() => parseTm7(xml.replace("<TypeId>GE.P</TypeId>", "<TypeId>GE.DS</TypeId>")), /conflicting native role IDs/);
});

test("TM7 import discloses lost extra properties, annotations and first-seen shared metadata", () => {
  const p = nativeNode(guid(1), "GE.P", "StencilEllipse");
  const xml = nativeModel(
    nativeTab(guid(10), p.replace("</Properties>", "<anyType><DisplayName>Custom fact</DisplayName><Value>Not represented</Value></anyType></Properties>") +
      nativeNode(guid(2), "GE.A", "StencilRectangle")) +
    nativeTab(guid(11), p.replace("Independent node", "Different title")));
  const result = parseTm7(xml);
  assert.equal(result.summary.skippedAnnotationCount, 1);
  assert.equal(result.doc.nodes.length, 1);
  assert.equal(result.doc.nodes[0].title, "Independent node");
  assert.match(result.diagnostics.join("\n"), /Custom fact/);
  assert.match(result.diagnostics.join("\n"), /first occurrence is retained/);
});
