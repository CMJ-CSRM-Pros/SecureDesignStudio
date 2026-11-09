// Hosted app and standalone HTML carry a Content Security Policy and the
// usual hardening headers (audit S6).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { singleFileBuildPlugin } from "../../scripts/single-file-build.mjs";

const directives = policy => new Map(policy.split(";").map(part => part.trim()).filter(Boolean)
  .map(part => { const [name, ...values] = part.split(/\s+/); return [name, values]; }));

test("regression: hosted Static Web App sends CSP, nosniff, frame and referrer protection", async () => {
  const config = JSON.parse(await readFile(new URL("../../staticwebapp.config.json", import.meta.url), "utf8"));
  const headers = config.globalHeaders;
  assert.equal(headers["Cache-Control"], "no-cache", "existing header kept");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  const csp = directives(headers["Content-Security-Policy"]);
  assert.deepEqual(csp.get("script-src"), ["'self'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'none'"]);
  assert.ok(csp.get("connect-src").includes("wss:"), "collaboration WebSocket allowed");
});

test("regression: standalone build pins its inline script by hash in a CSP meta tag", () => {
  // CRLF in the bundle: browsers hash the parsed text, where CR/CRLF are LF.
  const code = "console.log('a');\r\nconsole.log('</script>');\rdone();";
  const bundle = {
    "index.html": { fileName: "index.html", type: "asset",
      source: '<!doctype html><html><head><meta charset="UTF-8" /><script type="module" crossorigin src="./index.js"></script><link rel="stylesheet" href="./index.css"></head><body></body></html>' },
    "index.js": { fileName: "index.js", type: "chunk", code },
    "index.css": { fileName: "index.css", type: "asset", source: "body{margin:0}" },
  };
  const plugin = singleFileBuildPlugin();
  plugin.generateBundle.call({ error: message => { throw new Error(message); } }, {}, bundle);
  const html = String(bundle["index.html"].source);
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(meta, "CSP meta tag present");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<script"), "CSP precedes the first script");
  const csp = directives(meta[1]);
  for (const tag of ["script", "SCRIPT", "sCrIpT"]) {
    for (const end of [">", " >", "\t>", ' ignored="yes">']) {
      const variant = html.replaceAll("<script", `<${tag}`).replaceAll("</script>", `</${tag}${end}`);
      const inline = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i.exec(variant)[1];
      const parsed = inline.replace(/\r\n?/g, "\n");
      const hash = `'sha256-${createHash("sha256").update(parsed).digest("base64")}'`;
      assert.deepEqual(csp.get("script-src"), [hash]);
    }
  }
  assert.deepEqual(csp.get("default-src"), ["'none'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.equal(csp.has("frame-ancestors"), false, "ignored in meta tags");
});

// Builds a one-script bundle around `page` (which must contain the script tag)
// and returns the plugin's HTML, or throws the build error.
const buildStandalone = (page, code = "run();") => {
  const bundle = {
    "index.html": { fileName: "index.html", type: "asset", source: page },
    "index.js": { fileName: "index.js", type: "chunk", code },
  };
  singleFileBuildPlugin().generateBundle.call({ error: message => { throw new Error(message); } }, {}, bundle);
  return String(bundle["index.html"].source);
};
const scriptTag = '<script type="module" crossorigin src="./index.js"></script>';
const cspMeta = html => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);

test("regression: standalone build fails instead of shipping without a CSP when there is no head or charset", () => {
  assert.throws(() => buildStandalone(`<!doctype html><title>x</title>${scriptTag}<p>hi</p>`),
    /Content-Security-Policy|CSP/);
});

test("regression: standalone CSP goes into the real head, not a <header> element", () => {
  const html = buildStandalone(`<!doctype html><html><head><title>x</title>${scriptTag}</head><body><header>top</header></body></html>`);
  const meta = cspMeta(html);
  assert.ok(meta, "CSP meta tag present");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<script"), "CSP precedes the first script");
  assert.ok(html.indexOf("<head>") < html.indexOf(meta[0]), "CSP sits inside <head>");
  assert.ok(html.includes("<header>top</header>"), "header element untouched");
  // Without a head, a <header> must not pass for one: a meta CSP in the body is ignored.
  assert.throws(() => buildStandalone(`<!doctype html><html><body><header>top</header>${scriptTag}</body></html>`),
    /Content-Security-Policy|CSP/);
});

test("regression: standalone CSP hashes U+0000 in script text as U+FFFD, like the HTML tokenizer", () => {
  const code = "const nul = '\u0000';\r\nrun(nul);";
  const html = buildStandalone(`<!doctype html><html><head><meta charset="UTF-8">${scriptTag}</head><body></body></html>`, code);
  const parsed = code.replace(/\r\n?/g, "\n").replace(/\u0000/g, "\uFFFD");
  const hash = `'sha256-${createHash("sha256").update(parsed).digest("base64")}'`;
  assert.deepEqual(directives(cspMeta(html)[1]).get("script-src"), [hash]);
});

test("regression: a charset-looking string inside inlined JS is never the CSP insertion point", () => {
  const code = "document.head.insertAdjacentHTML('beforeend', '<meta charset=\"x\">');";
  const html = buildStandalone(`<!doctype html><html><head><title>x</title>${scriptTag}</head><body></body></html>`, code);
  const meta = cspMeta(html);
  assert.ok(meta, "CSP meta tag present");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<script"), "CSP precedes the first script");
  const inline = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i.exec(html)[1];
  assert.equal(inline, code, "inlined script text unchanged");
});
