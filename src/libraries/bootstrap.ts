import { resolveLibraries } from "./registry";
import { MAX_LIBRARY_SET_BYTES, type LibraryCandidate, type LibraryDelivery, type LibraryRegistry } from "./contracts";

// Only Vite/deployment-selected local JSON enters this path. The diagram,
// profile preferences, room state and URL fragment cannot select packages.
export async function bootstrapLibraries(
  delivery: LibraryDelivery, localOnly: boolean, baseUrl: string,
  fetcher: typeof fetch = fetch, timeoutMs = 2000,
): Promise<LibraryRegistry> {
  if (delivery.mode === "embedded") return resolveLibraries(delivery.candidates);
  const unavailable = (message: string) => resolveLibraries([{
    source: "Deployment manifest", error: message,
  }]);
  if (localOnly || baseUrl.startsWith("file:")) return unavailable("This delivery cannot fetch optional library manifests.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = new URL(baseUrl);
    const target = new URL(delivery.manifest, base);
    if (!/^https?:$/.test(target.protocol) || target.origin !== base.origin
        || target.username || target.password || target.search || target.hash) {
      return unavailable("Library manifest must be a same-origin deployment asset.");
    }
    const response = await fetcher(target.href, {
      signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store",
    });
    if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      return unavailable("Library manifest is missing or is not JSON; core defaults remain available.");
    }
    if (!response.body) return unavailable("Library manifest is empty.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let json = "";
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_LIBRARY_SET_BYTES) {
          await reader.cancel();
          return unavailable("Library manifest exceeds the 4 MiB limit.");
        }
        json += decoder.decode(result.value, { stream: true });
      }
      json += decoder.decode();
    } finally { reader.releaseLock(); }
    const candidates: unknown = JSON.parse(json);
    if (!Array.isArray(candidates) || candidates.some(candidate =>
      !candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || typeof candidate.source !== "string"
      || Object.keys(candidate).some(key => !["source", "value", "error"].includes(key))
      || (candidate.error !== undefined && typeof candidate.error !== "string"))) {
      return unavailable("Invalid deployment library manifest.");
    }
    return resolveLibraries(candidates as LibraryCandidate[]);
  } catch {
    return unavailable(controller.signal.aborted
      ? "Library startup timed out; core defaults remain available."
      : "Library manifest could not be read; core defaults remain available.");
  } finally { clearTimeout(timer); }
}
