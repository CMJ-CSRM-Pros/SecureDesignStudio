// Public endpoint settings must not contain credentials or URL-borne secrets.
export function serviceEndpoint(value, allowRelative = false) {
  const text = value.trim();
  if (!text || /[\u0000-\u0020\u007f\\]/.test(text)) return null;
  if (allowRelative && text.startsWith("/") && !text.startsWith("//")) {
    try {
      const url = new URL(text, "https://service-config.invalid");
      if (url.origin !== "https://service-config.invalid" || url.search || url.hash) return null;
      return url.pathname;
    } catch { return null; }
  }
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch { return null; }
}
