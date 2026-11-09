// A work-item link that evades the normalizeDoc denylist must never become a
// script-capable href in the exported HTML review report.
import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { documentFixture } from "./catalog-fixtures.mjs";

const { normalizeDoc } = await import("../../src/store.tsx");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");

const PAYLOADS = ["java\tscript:alert(1)", "jav\nascript:alert(1)", "\u0001javascript:alert(1)", "javascript:alert(1)", "data:text/html,<b>x</b>"];

test("regression: report work-item links are scheme allow-listed and the report carries a CSP", () => {
  for (const link of PAYLOADS) {
    const doc = documentFixture();
    doc.workItems = [{ id: "w1", description: "Fix", link }];
    const html = buildReviewReportHtml({ doc: normalizeDoc(doc), scenario: doc.scenarios[0],
      documentFileName: "synthetic.tma", appVersion: "test" });
    for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
      const decoded = href.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      let protocol = null;
      try { protocol = new URL(decoded).protocol; } catch { /* relative: inert */ }
      assert.ok(protocol === null || ["http:", "https:", "mailto:"].includes(protocol),
        `payload ${JSON.stringify(link)} produced href with ${protocol}`);
    }
    assert.match(html, /http-equiv="Content-Security-Policy"[^>]*default-src 'none'/);
  }
  const ok = documentFixture();
  ok.workItems = [{ id: "w2", description: "Ticket", link: "https://example.invalid/t/1" }];
  assert.match(buildReviewReportHtml({ doc: normalizeDoc(ok), scenario: ok.scenarios[0],
    documentFileName: "synthetic.tma", appVersion: "test" }), /<a href="https:\/\/example\.invalid\/t\/1"/);
});

// normalizeDoc already blanks every payload above, so this feeds the raw links
// straight to the report builder to prove the sink-side allow-list holds alone.
test("regression: report sink allow-lists work-item links even when normalizeDoc is bypassed", () => {
  const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  for (const link of PAYLOADS) {
    const doc = normalizeDoc(documentFixture());
    doc.workItems = [{ id: "w1", description: "Fix", link }];
    const html = buildReviewReportHtml({ doc, scenario: doc.scenarios[0],
      documentFileName: "synthetic.tma", appVersion: "test" });
    for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
      const decoded = href.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      let protocol = null;
      try { protocol = new URL(decoded).protocol; } catch { /* unparseable */ }
      assert.ok(["http:", "https:", "mailto:"].includes(protocol),
        `payload ${JSON.stringify(link)} produced href ${JSON.stringify(decoded)} (${protocol})`);
    }
    assert.ok(html.includes(escape(link)), `payload ${JSON.stringify(link)} is rendered as inert text`);
  }
});
