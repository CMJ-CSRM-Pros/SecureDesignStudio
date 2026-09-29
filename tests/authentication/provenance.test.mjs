import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { unzipSync, strFromU8 } from "fflate";
import { modelFixture } from "../browser/fixture.mjs";

const { IssueManager } = await import("../../src/IssueManager.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { exportVsdx } = await import("../../src/vsdxExport.ts");
const { VSDX_TEMPLATE_BASE64 } = await import("../../src/vsdxTemplate.ts");
const notice = JSON.parse(await readFile(new URL("../../src/data/vsdxTemplateNotice.json", import.meta.url), "utf8"));
const help = [{ id: "analysis.deprecated-auth-guidance", title: "Synthetic guidance", text: "Synthetic only.", url: "https://example.invalid/deprecated-auth" }];
const manager = guidance => new IssueManager(undefined, undefined, [], [], undefined, guidance);
const authFinding = doc => doc.issues.find(issue => issue.kind === "Edge_auth_not_accepted" && issue.targetId === "e_request");
function deprecatedModel() {
  const doc = modelFixture().doc;
  delete doc.nodeTypes[0].definition.policyStatus;
  doc.nodeTypes[0].definition.allowedAuthMethods = [{ id: "ApiKey", status: "Deprecated" }];
  doc.nodeTypes[0].definition.allowedDataTypes = [{ id: "*", retention: "*", action: "Allow" }];
  doc.edges[0].authenticationTypes = ["ApiKey"];
  return doc;
}

test("guidance: installed help changes only the rule-driven link, not finding decisions or human status", () => {
  const doc = manager([]).analyze(deprecatedModel());
  const original = authFinding(doc);
  assert.equal(original.resolutionLink, undefined);
  original.status = "Resolved";
  original.replies = [{ id: "ir_preserved", text: "Synthetic decision", createdAt: 2 }];
  const selected = manager(help).analyze(doc);
  assert.deepEqual(authFinding(selected), { ...original, resolutionLink: help[0].url });
  assert.deepEqual(authFinding(manager([]).analyze(selected)), original);
  assert.deepEqual(authFinding(manager([{ ...help[0], url: "javascript:alert(1)" }]).analyze(doc)), original);
  const denied = deprecatedModel();
  denied.nodeTypes[0].definition.allowedAuthMethods = [{ id: "AnonymousAccess", status: "Allowed" }];
  assert.equal(authFinding(manager(help).analyze(denied)).resolutionLink, undefined);
});

test("guidance: saved links survive import and unavailable-policy reconciliation without installing help", () => {
  const doc = manager(help).analyze(deprecatedModel());
  const saved = structuredClone(authFinding(doc));
  doc.nodeTypes = [];
  const opened = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(authFinding(opened).resolutionLink, help[0].url);
  assert.deepEqual(authFinding(manager([]).analyze(opened)), { ...saved, notEvaluatedReason: "policy-unavailable" });
});

test("provenance: retention identifiers and labels stay stable without private guidance in defaults", async () => {
  const retention = JSON.parse(await readFile(new URL("../../src/data/retentionTypes.json", import.meta.url), "utf8"));
  assert.deepEqual(retention.map(({ id, label }) => ({ id, label })), [
    { id: "ProcessingNoStorage", label: "Processing only (no storage)" },
    { id: "StorageUnder48Hours", label: "Storage < 48 hours" },
    { id: "StorageOver48Hours", label: "Storage \u2265 48 hours" },
  ]);
  assert.doesNotMatch(JSON.stringify(retention), /eng\.ms|DHS|Data Handling Standards/);
  assert.match(retention[2].description, /does not define a legal retention limit/);
});

test("provenance: embedded template bytes and BSD notice match the pinned component identity", () => {
  const bytes = Buffer.from(VSDX_TEMPLATE_BASE64, "base64");
  assert.equal(bytes.length, 20056);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), notice.templateSha256);
  assert.equal(notice.license, "BSD-3-Clause");
  assert.match(notice.sourceUrl, /934a1b5dc68cbc7dab2d34509221741a1d97d2dd\/vsdx\/media\/media\.vsdx$/);
  for (const fragment of ["Copyright (c) 2020, Dave Howard", "All rights reserved.", "1. Redistributions", "2. Redistributions", "3. Neither", "THIS SOFTWARE IS PROVIDED", "EVEN IF ADVISED"]) {
    assert.ok(notice.notice.includes(fragment));
  }
});

test("provenance: VSDX carries attribution without inherited metadata or dangling package relationships", () => {
  const title = 'Synthetic <model> & "review"';
  const files = unzipSync(exportVsdx(modelFixture().doc, { modelName: title }));
  const parser = new DOMParser();
  const xml = name => parser.parseFromString(strFromU8(files[name]), "text/xml");
  const core = xml("docProps/core.xml");
  assert.equal(core.getElementsByTagName("dc:title")[0].textContent, title);
  assert.equal(core.getElementsByTagName("dc:creator")[0].textContent, "SecureDesignStudio");
  const description = core.getElementsByTagName("dc:description")[0].textContent;
  assert.ok(description.includes(notice.sourceUrl));
  assert.ok(description.includes(notice.notice));
  for (const name of ["cp:lastPrinted", "dcterms:created", "dcterms:modified", "cp:keywords", "cp:category"]) {
    assert.equal(core.getElementsByTagName(name).length, 0);
  }
  const app = xml("docProps/app.xml");
  assert.equal(app.getElementsByTagName("Application")[0].textContent, "SecureDesignStudio");
  for (const name of ["Company", "Manager", "Template", "HyperlinkBase"]) assert.equal(app.getElementsByTagName(name).length, 0);
  assert.equal(files["docProps/custom.xml"], undefined);
  assert.equal(files["docProps/thumbnail.emf"], undefined);
  for (const name of Object.keys(files).filter(name => name.endsWith(".rels"))) {
    const base = name === "_rels/.rels" ? "" : posix.dirname(name).replace(/\/_rels$/, "");
    const relationships = xml(name).getElementsByTagName("Relationship");
    for (let i = 0; i < relationships.length; i++) {
      const relation = relationships[i];
      if (relation.getAttribute("TargetMode") === "External") continue;
      const target = relation.getAttribute("Target");
      const path = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(base, target));
      assert.ok(files[path], `${name} references missing part ${path}`);
    }
  }
  const overrides = xml("[Content_Types].xml").getElementsByTagName("Override");
  for (let i = 0; i < overrides.length; i++) assert.ok(files[overrides[i].getAttribute("PartName").replace(/^\//, "")]);
  assert.equal(Object.keys(files).filter(name => /^visio\/pages\/page\d+\.xml$/.test(name)).length, 2);
});
