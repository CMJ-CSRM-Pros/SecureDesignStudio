// AES-GCM wrap/unwrap for collab payloads. The symmetric key lives in
// the URL hash (e.g. `#room=…&key=base64url(32 bytes)`), which never
// leaves the browser — Web Pub/Sub only ever sees ciphertext + IV.
//
// Each wrapped message is `[12-byte IV | ciphertext+tag]` then base64url
// encoded for safe transport over the JSON message channel.

const KEY_BYTES = 32; // AES-256

// lib.dom's BufferSource now distinguishes ArrayBuffer-backed views
// from SharedArrayBuffer-backed ones, but Uint8Array's `buffer` is
// typed as the union. Copying the bytes into a fresh ArrayBuffer makes
// the strict overload accept the value at the cost of one extra
// allocation per crypto call — negligible compared to the AES-GCM work
// itself.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

export function generateKey(): string {
  const raw = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(raw);
  return toBase64Url(raw);
}

export async function importKey(b64url: string): Promise<CryptoKey> {
  const raw = fromBase64Url(b64url);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error(
      `Invalid collab key length: expected ${KEY_BYTES} bytes, got ${raw.byteLength}`
    );
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext)
  );
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.byteLength);
  return toBase64Url(out);
}

export async function decryptBytes(
  key: CryptoKey,
  payload: string
): Promise<Uint8Array> {
  const buf = fromBase64Url(payload);
  if (buf.byteLength <= 12) throw new Error("Ciphertext too short");
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct)
  );
  return new Uint8Array(pt);
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
