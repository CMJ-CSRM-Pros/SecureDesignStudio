// Yjs <-> Azure Web Pub/Sub provider.
//
// Wire protocol over a single Web Pub/Sub group named after the room.
// Messages are JSON envelopes carrying base64url-encoded Yjs binary
// updates / state vectors. With E2E enabled (a key is supplied), the
// inner bytes are AES-GCM ciphertext that the Web Pub/Sub service
// cannot read.
//
//   { t: "sync1", body: <state vector> }   // newcomer asks "where am I?"
//   { t: "sync2", body: <update> }         // peer answers with the delta
//   { t: "update", body: <update> }        // any post-sync local change
//
// Sender connections receive their own group messages by default; the
// `noEcho: true` option suppresses that, which keeps the Yjs update
// listener loop simple (we never see our own broadcasts).

import * as Y from "yjs";
import { SERVICES } from "../services";
import { serviceEndpoint } from "../serviceConfiguration";
import {
  WebPubSubClient,
  WebPubSubJsonProtocol,
} from "@azure/web-pubsub-client";
import { REMOTE_ORIGIN } from "./yDoc";
import {
  decryptBytes,
  encryptBytes,
  fromBase64Url,
  toBase64Url,
} from "./crypto";

export type CollabStatus =
  | "idle"
  | "disabled"
  | "connecting"
  | "connected"
  | "error";

export { LOCAL_ONLY_COLLAB_MESSAGE } from "../serviceConfiguration";
const INVALID_ENDPOINT_MESSAGE =
  "Collaboration token endpoint configuration is invalid.";

export interface WebPubSubProviderOptions {
  ydoc: Y.Doc;
  room: string;
  // If supplied, all on-the-wire payloads are AES-GCM encrypted with
  // this key. Generated client-side and shared via URL hash; the server
  // never sees it. If omitted, payloads transit Web Pub/Sub in clear
  // text — useful for tests, not recommended for production data.
  key?: CryptoKey | null;
  // URL of the Azure Function that mints client tokens for this Web
  // Pub/Sub hub. Defaults to `__PS_TOKEN_ENDPOINT__` (baked in at
  // build time from deployment configuration). An override cannot enable
  // a build whose collaboration service is disabled.
  tokenEndpoint?: string;
  onStatus?: (status: CollabStatus, detail?: string) => void;
  onPeerCount?: (count: number) => void;
}

interface Envelope {
  t: "sync1" | "sync2" | "update";
  body: string; // base64url
}

export class WebPubSubProvider {
  private readonly ydoc: Y.Doc;
  private readonly room: string;
  private readonly key: CryptoKey | null;
  private readonly tokenEndpoint: string;
  private readonly onStatus?: (s: CollabStatus, detail?: string) => void;
  private readonly onPeerCount?: (n: number) => void;

  private client: WebPubSubClient | null = null;
  private destroyed = false;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null =
    null;
  // True only between "connected" / "disconnected" events, AND once
  // joinGroup has succeeded for the current connection. Local Yjs
  // updates that arrive while this is false are dropped on the floor
  // — the next "connected" will publish a sync2 carrying our full
  // current state, so peers don't lose the change.
  private ready = false;

  constructor(opts: WebPubSubProviderOptions) {
    if (!SERVICES.collaboration.enabled) {
      throw new Error(SERVICES.collaboration.message);
    }
    const tokenEndpoint = serviceEndpoint(opts.tokenEndpoint ?? SERVICES.collaboration.endpoint);
    if (!tokenEndpoint) {
      throw new Error(INVALID_ENDPOINT_MESSAGE);
    }
    this.ydoc = opts.ydoc;
    this.room = opts.room;
    this.key = opts.key ?? null;
    this.tokenEndpoint = tokenEndpoint;
    this.onStatus = opts.onStatus;
    this.onPeerCount = opts.onPeerCount;
  }

  async start(): Promise<void> {
    this.report("connecting");
    const tokenUrl = new URL(this.tokenEndpoint);
    tokenUrl.searchParams.set("room", this.room);
    let response: Response;
    try {
      response = await fetch(tokenUrl.toString());
    } catch {
      const error = new Error("Collaboration token request failed.");
      this.report("error", error.message);
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        `Collaboration token request failed (${response.status}).`,
      );
      this.report("error", error.message);
      throw error;
    }
    const body = (await response.json().catch(() => null)) as {
      url?: unknown;
    } | null;
    if (!body || typeof body.url !== "string" || !body.url) {
      const error = new Error("Collaboration token response was invalid.");
      this.report("error", error.message);
      throw error;
    }

    if (this.destroyed) return;

    const client = new WebPubSubClient(body.url, {
      // Default is the "reliable" JSON subprotocol, which wraps every
      // sendToGroup in an ack handshake. We don't need it (Yjs already
      // tolerates missed updates via sync1/sync2), and the reliability
      // layer was the source of "Connection is disconnected before
      // receive ack" / "connection is not connected" errors in the
      // browser. Plain json fire-and-forget sends keep things simple.
      protocol: WebPubSubJsonProtocol(),
    });
    this.client = client;

    client.on("group-message", (e) => {
      // The SDK gives us either parsed JSON, a string, or an
      // ArrayBuffer depending on the data type used by the sender.
      // We always send "json", so we expect an object here. Be
      // tolerant of stray non-conforming messages instead of throwing.
      const data = e.message.data as unknown;
      if (
        !data ||
        typeof data !== "object" ||
        typeof (data as Envelope).t !== "string" ||
        typeof (data as Envelope).body !== "string"
      ) {
        return;
      }
      this.handleEnvelope(data as Envelope).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[collab] failed to process message", err);
      });
    });

    client.on("connected", () => {
      // (Re)join group and announce ourselves with a sync1.
      client.joinGroup(this.room).then(
        async () => {
          // Only after the group join is acknowledged is it safe to
          // send. Local Yjs updates that arrived while we were
          // negotiating are intentionally not retried — they're
          // covered by the sync2 below, which carries the entire
          // current Y state.
          this.ready = true;
          this.report("connected");
          await this.sendSync1();
          // Also push a sync2 carrying our entire state — handles the
          // edge case where we are the very first peer in the room and
          // nobody else will ever respond to sync1.
          await this.sendUpdate(Y.encodeStateAsUpdate(this.ydoc), "sync2");
        },
        (err) => {
          this.report(
            "error",
            err instanceof Error ? err.message : String(err)
          );
        }
      );
    });

    client.on("disconnected", () => {
      // Web Pub/Sub will auto-reconnect; while we're between sockets
      // we must not try to send anything. Updates from the local user
      // accumulate in the Y.Doc and ride out on the next connect's
      // sync2 broadcast.
      this.ready = false;
      if (!this.destroyed) this.report("connecting");
    });

    // Forward every local Yjs change to the room, but only while the
    // service-side group join is active. Pre-connect and reconnect
    // gaps drop updates here (the next sync2 covers the gap). Updates
    // we ourselves applied from a remote message are tagged with
    // REMOTE_ORIGIN — we mustn't echo those back or peers will fight
    // in an update loop.
    this.updateHandler = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      if (!this.ready) return;
      void this.sendUpdate(update, "update");
    };
    this.ydoc.on("update", this.updateHandler);

    await client.start();
  }

  destroy(): void {
    this.destroyed = true;
    this.ready = false;
    if (this.updateHandler) {
      this.ydoc.off("update", this.updateHandler);
      this.updateHandler = null;
    }
    if (this.client) {
      try {
        this.client.stop();
      } catch {
        // Stop is best-effort; the SDK may already be torn down.
      }
      this.client = null;
    }
    this.report("idle");
  }

  // ---- internals ----

  private report(status: CollabStatus, detail?: string) {
    this.onStatus?.(status, detail);
  }

  private async sendEnvelope(env: Envelope): Promise<void> {
    if (!this.client || !this.ready) return;
    try {
      await this.client.sendToGroup(this.room, env, "json", {
        noEcho: true,
      });
    } catch (err) {
      // The SDK may close the socket between our `ready` check and
      // the actual send. Treat that the same as a normal pre-connect
      // gap — the next reconnect's sync2 covers it.
      // eslint-disable-next-line no-console
      console.warn("[collab] sendToGroup failed", err);
    }
  }

  private async wrap(bytes: Uint8Array): Promise<string> {
    if (this.key) return await encryptBytes(this.key, bytes);
    return toBase64Url(bytes);
  }

  private async unwrap(body: string): Promise<Uint8Array> {
    if (this.key) return await decryptBytes(this.key, body);
    return fromBase64Url(body);
  }

  private async sendSync1(): Promise<void> {
    const sv = Y.encodeStateVector(this.ydoc);
    const body = await this.wrap(sv);
    await this.sendEnvelope({ t: "sync1", body });
  }

  private async sendUpdate(
    update: Uint8Array,
    t: "sync2" | "update"
  ): Promise<void> {
    if (update.byteLength === 0) return;
    const body = await this.wrap(update);
    await this.sendEnvelope({ t, body });
  }

  private async handleEnvelope(env: Envelope): Promise<void> {
    switch (env.t) {
      case "sync1": {
        const remoteSv = await this.unwrap(env.body);
        const diff = Y.encodeStateAsUpdate(this.ydoc, remoteSv);
        await this.sendUpdate(diff, "sync2");
        return;
      }
      case "sync2":
      case "update": {
        const update = await this.unwrap(env.body);
        Y.applyUpdate(this.ydoc, update, REMOTE_ORIGIN);
        return;
      }
    }
  }
}
