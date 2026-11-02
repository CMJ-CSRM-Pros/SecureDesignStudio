import React, { Fragment } from "react";

// Tokenizes a plain string with embedded links and renders text + anchors.
// Supported syntax:
//   - Markdown-style: [label](https://...) or [label](http://...)
//   - Bare URL:       https://... or http://...
// Only http/https schemes are rendered as anchors; anything else falls through
// as plain text. React's automatic text escaping protects against XSS in the
// label and text fragments. No dangerouslySetInnerHTML is used.

type Token =
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; url: string };

// Single regex pass over the description. The first alternative captures
// markdown [label](url); the second captures bare URLs. The trailing
// character classes for the URL exclude whitespace, closing parens, and
// common punctuation so a sentence-ending "...visit https://example.com."
// doesn't include the period in the link.
const TOKEN_RE =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>"']+)/g;

function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function trimTrailingPunctuation(url: string): { url: string; trail: string } {
  // Strip trailing punctuation a user might accidentally include adjacent to
  // a bare URL (period, comma, semicolon, etc.) and surface it as text after
  // the link.
  const m = /[.,;:!?]+$/.exec(url);
  if (!m) return { url, trail: "" };
  return { url: url.slice(0, -m[0].length), trail: m[0] };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, m.index) });
    }
    if (m[1] && m[2]) {
      // [label](url)
      if (isSafeHttpUrl(m[2])) {
        tokens.push({ kind: "link", label: m[1], url: m[2] });
      } else {
        // Unsafe scheme — emit the raw text instead of an anchor.
        tokens.push({ kind: "text", text: m[0] });
      }
    } else if (m[3]) {
      // Bare URL
      const { url, trail } = trimTrailingPunctuation(m[3]);
      if (isSafeHttpUrl(url)) {
        tokens.push({ kind: "link", label: url, url });
        if (trail) tokens.push({ kind: "text", text: trail });
      } else {
        tokens.push({ kind: "text", text: m[3] });
      }
    }
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return tokens;
}

export function RichText({ text }: { text: string }) {
  if (!text) return null;
  const tokens = tokenize(text);
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "text" ? (
          <Fragment key={i}>{t.text}</Fragment>
        ) : (
          <a
            key={i}
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ps-richtext-link"
            // Stop propagation so a click on the link inside e.g. a list-item
            // doesn't also trigger the item's onClick/select handler.
            onClick={(e) => e.stopPropagation()}
          >
            {t.label}
          </a>
        )
      )}
    </>
  );
}

// Test hook — exported for unit testing if added later. Not used at runtime.
export const __tokenize = tokenize;
