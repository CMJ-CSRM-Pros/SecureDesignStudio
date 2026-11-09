import { createHash } from "node:crypto";

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The standalone file runs from file:// with every script inlined, so its CSP
// pins each inline script by hash instead of allowing 'unsafe-inline'.
// Browsers hash the parsed script text: input preprocessing turns CR and CRLF
// into LF, and the script data state emits U+0000 as U+FFFD; every other
// character passes through unchanged (no character references in script data).
// frame-ancestors is not honoured in a meta tag; hosting headers cover it.
export function standaloneContentSecurityPolicy(inlineScripts) {
  const hashes = inlineScripts.map(code => {
    const parsed = code.replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
    return `'sha256-${createHash("sha256").update(parsed).digest("base64")}'`;
  });
  return [
    "default-src 'none'", `script-src ${hashes.join(" ")}`, "style-src 'unsafe-inline'",
    "img-src data: blob:", "font-src data:", "connect-src https: wss:",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join("; ");
}

export function singleFileBuildPlugin() {
  return {
    name: "sds:single-file",
    enforce: "post",
    config(config) {
      config.base = "./";
      config.build ??= {};
      config.build.assetsInlineLimit = () => true;
      config.build.cssCodeSplit = false;
      config.build.assetsDir = "";
      config.build.rollupOptions ??= {};
      config.build.rollupOptions.output ??= {};
      const outputs = Array.isArray(config.build.rollupOptions.output)
        ? config.build.rollupOptions.output : [config.build.rollupOptions.output];
      for (const output of outputs) output.codeSplitting = false;
    },
    generateBundle(_options, bundle) {
      const htmlFiles = Object.values(bundle).filter(file => /\.html?$/.test(file.fileName));
      if (!htmlFiles.length) this.error("Standalone build did not emit HTML.");
      const inlined = new Set();
      for (const html of htmlFiles) {
        // Place the CSP before inlining, and only before the first script, so
        // inlined code can never supply the anchor and the policy precedes
        // every script. A meta CSP outside <head> is ignored, so no anchor is
        // a build error rather than a silently unprotected file.
        const original = String(html.source);
        const firstScript = original.search(/<script\b/i);
        const prelude = firstScript < 0 ? original : original.slice(0, firstScript);
        const anchor = /<meta\s+charset=[^>]*>/i.exec(prelude) ?? /<head(?=[\s/>])[^>]*>/i.exec(prelude);
        if (!anchor) {
          this.error(`Standalone build cannot place its Content-Security-Policy in ${html.fileName}: no <meta charset> or <head> before the first <script>.`);
          return;
        }
        const at = anchor.index + anchor[0].length;
        const parts = [original.slice(0, at), original.slice(at)];
        const inlineScripts = [];
        for (const file of Object.values(bundle)) {
          const name = escapeRegExp(file.fileName);
          if (file.type === "chunk") {
            const tag = new RegExp(`<script([^>]*?)\\s+src=["'](?:\\./)?${name}["']([^>]*)>\\s*</script>`, "g");
            let matched = false;
            const code = file.code.replace(/"?__VITE_PRELOAD__"?/g, "void 0")
              .replace(/<(\/script>|!--)/gi, "\\x3C$1");
            for (const [i, part] of parts.entries()) parts[i] = part.replace(tag, (_, before, after) => {
              matched = true;
              inlineScripts.push(code.trim());
              return `<script${before}${after}>${code.trim()}</script>`;
            });
            if (matched) inlined.add(file.fileName);
          } else if (/\.css$/.test(file.fileName)) {
            const tag = new RegExp(`<link\\b[^>]*\\bhref=["'](?:\\./)?${name}["'][^>]*>`, "g");
            let matched = false;
            const css = String(file.source).replace(/@charset "UTF-8";/g, "")
              .replace(/<\/style/gi, "\\3C /style");
            for (const [i, part] of parts.entries()) parts[i] = part.replace(tag, () => {
              matched = true;
              return `<style>${css.trim()}</style>`;
            });
            if (matched) inlined.add(file.fileName);
          }
        }
        const meta = `<meta http-equiv="Content-Security-Policy" content="${standaloneContentSecurityPolicy(inlineScripts)}">`;
        html.source = parts[0] + meta + parts[1];
      }
      for (const file of Object.values(bundle)) {
        if (file.type === "chunk" || /\.css$/.test(file.fileName)) {
          if (!inlined.has(file.fileName)) this.error(`Standalone resource was not inlined: ${file.fileName}`);
          delete bundle[file.fileName];
        }
      }
    },
  };
}
