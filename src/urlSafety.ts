// Centralised scheme-validation for any user-controlled string that ends up
// rendered into a DOM `href`. The threat model is straightforward: a
// malicious `.tma`/TMC/PrivacyManager import could contain
// `"link": "javascript:alert(document.cookie)"` (or `data:text/html,…`) and
// React will happily pass that through to `<a href={…}>`. `target="_blank"
// rel="noopener noreferrer"` does NOT prevent `javascript:` execution.
//
// `safeNavigationHref` returns the original URL when its scheme is in the
// allow-list, and `null` otherwise so callers can skip rendering the link
// entirely (preferred) or fall back to plain text.

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function isSafeNavigationUrl(raw: string | undefined | null): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    // URL() requires a base for protocol-relative strings, but we deliberately
    // do NOT supply one — we only consider absolute URLs safe to render.
    const u = new URL(trimmed);
    return ALLOWED_SCHEMES.has(u.protocol.toLowerCase());
  } catch {
    return false;
  }
}

export function safeNavigationHref(
  raw: string | undefined | null
): string | null {
  return isSafeNavigationUrl(raw) ? (raw as string).trim() : null;
}
