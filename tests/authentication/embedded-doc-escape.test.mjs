// The standalone export embeds the model in <script type="application/json">.
// Escaping only `</script` is not enough: `<!--<script>` sends the HTML
// tokenizer into its double-escaped state, the block never closes, and the
// exported file silently opens without its model (audit S7).
import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { capturePristineHtml, buildStandaloneHtml } = await import("../../src/embeddedDoc.ts");

test("regression: standalone export escapes every '<' and line separator in the embedded model", () => {
  const wrapper = { doc: { description: "a <!--<script> b </script> c <!-- d \u2028 e \u2029 f </SCRIPT" } };
  capturePristineHtml("<html><body>Synthetic app</body></html>");
  const html = buildStandaloneHtml(JSON.stringify(wrapper));
  const open = '<script type="application/json" id="ps-embedded-doc">';
  const start = html.indexOf(open) + open.length;
  const end = html.indexOf("</script>", start);
  assert.ok(start >= open.length && end > start, "embedded block not found");
  const payload = html.slice(start, end);
  assert.equal(/[<\u2028\u2029]/.test(payload), false, `raw '<' or separator in payload: ${payload}`);
  assert.deepEqual(JSON.parse(payload), wrapper);
});
