// Standalone-HTML self-embedding utilities.
//
// The single-file build (`dist-single/index.html`) can be redistributed
// as a portable artifact carrying the SecureDesignStudio model inside it. The
// "Export as standalone HTML" file operation:
//
//   1. Reuses the pristine HTML that the browser parsed at startup
//      (`PRISTINE_HTML`, captured by main.tsx before React mounted, so
//      the runtime DOM mutations are not in it).
//   2. Inserts (or replaces) a `<script type="application/json"
//      id="ps-embedded-doc">…</script>` carrying the current document's
//      JSON.
//   3. Triggers a browser download of the result as a `.html` file.
//
// On startup, when the page boots, `readEmbeddedDoc()` looks for that
// same script element and returns the parsed PsDocument so the store
// can seed itself from it (instead of from autosave). This makes the
// exported file a self-contained, double-clickable view of the model
// that round-trips through the same export path.

import type { PsDocument } from "./types";

export const EMBEDDED_DOC_SCRIPT_ID = "ps-embedded-doc";

// Captured by main.tsx before React mounts so the snapshot is the
// browser's parse of the original HTML, free of any runtime
// modifications (React-injected attributes, dynamically-added classes,
// etc.). Falls back to null in environments where the script isn't
// initialized (tests / Node).
let PRISTINE_HTML: string | null = null;

export function capturePristineHtml(html: string): void {
  PRISTINE_HTML = html;
}

export function getPristineHtml(): string | null {
  return PRISTINE_HTML;
}

// Read the embedded-doc script if it was present in the served HTML.
// Returns the raw parsed JSON (anything — the caller hands it to
// normalizeDoc for validation/migration). Returns null when no such
// script exists or it isn't parseable JSON.
export function readEmbeddedDoc(): unknown | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(EMBEDDED_DOC_SCRIPT_ID);
  if (!el) return null;
  const text = el.textContent ?? "";
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Escape every `<` (and U+2028/U+2029) in the JSON payload as a JSON
// unicode escape, so user-supplied content can neither close the containing
// `<script type="application/json">` block early (`</script>`) nor push the
// HTML tokenizer into its double-escaped state (`<!--<script>`), which would
// keep the block from closing at all. JSON.parse restores the characters.
function escapeForScriptBlock(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Replace the LAST occurrence of `regex` in `haystack` with
// `replacement`. We must anchor on the last match — not the first —
// because the inlined main JS bundle contains literal `</body>` and
// `<script ... id="ps-embedded-doc">…</script>` substrings as parts of
// THIS very source file (template literals, string constants), and a
// naive `replace` would splice the injected payload into the middle of
// the bundle's JS text, breaking the script.
function replaceLast(
  haystack: string,
  regex: RegExp,
  replacement: string,
): string | null {
  if (!regex.global) {
    throw new Error("replaceLast requires a /g regex");
  }
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(haystack)) !== null) {
    last = m;
    if (m.index === regex.lastIndex) regex.lastIndex += 1;
  }
  if (last == null) return null;
  return (
    haystack.slice(0, last.index) +
    replacement +
    haystack.slice(last.index + last[0].length)
  );
}

// Build a standalone HTML string containing `docJson` inside an
// embedded-doc script tag. Replaces the existing embedded-doc script
// if there is one, otherwise injects a new one immediately before
// `</body>`. Falls back to appending at the end of the document if no
// `</body>` is found.
//
// The wrapper passes the export wrapper shape (`exportJson()` output),
// not a bare PsDocument, so the embedded payload matches what `Open`
// expects — that way the same JSON could be saved to a `.tma` file too.
export function buildStandaloneHtml(docJson: string): string {
  const pristine = PRISTINE_HTML;
  if (pristine == null) {
    throw new Error(
      "Standalone HTML export is only available in the single-file build " +
        "(BUILD_SINGLE_FILE=1). No pristine HTML was captured at startup.",
    );
  }
  const safeJson = escapeForScriptBlock(docJson);
  const tag =
    `<script type="application/json" id="${EMBEDDED_DOC_SCRIPT_ID}">` +
    safeJson +
    `</script>`;
  // Match any existing embedded-doc script (regardless of attribute
  // order or whitespace) so we don't accumulate duplicates across
  // repeated exports of an already-exported file. Both this regex and
  // the </body> regex below MUST anchor on the LAST match — see
  // `replaceLast` above for the reason.
  const existing =
    /<script\b[^>]*\bid=["']ps-embedded-doc["'][^>]*>[\s\S]*?<\/script>/gi;
  const bodyClose = /<\/body\s*>/gi;
  let replaced = replaceLast(pristine, existing, tag);
  if (replaced == null) {
    replaced = replaceLast(pristine, bodyClose, `${tag}</body>`);
  }
  const body = replaced ?? pristine + tag;
  // outerHTML / capturePristineHtml strips the doctype, so re-prepend
  // an HTML5 doctype so the exported file renders in standards mode.
  return "<!DOCTYPE html>\n" + body;
}
