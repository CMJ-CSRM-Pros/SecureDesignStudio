// React hook that wires a Y.Doc + WebPubSubProvider to the StoreProvider.
//
// The hook is owned by StoreProvider so it can read `docRef.current` and
// call the snapshot-free `setDocFromCollab`. When `room` is null the
// hook is dormant — no Y.Doc, no network, nothing.
//
// Lifecycle:
//   join -> create Y.Doc -> seed Y from local doc (only if Y is empty)
//        -> attach IndexedDB persistence -> start provider
//   any local doc change -> reconcileLocalToY (origin=local)
//   remote update arrives -> Y.applyUpdate(remote) -> Y emits "update"
//                        -> buildDocFromY -> setDocFromCollab
//   leave / unmount -> tear down provider, persistence, Y.Doc

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { withCatalogDefinitions } from "../catalogDefinitions";
import type { CatalogDefinitionSnapshot } from "../types";
import { IndexeddbPersistence } from "y-indexeddb";
import type { PsDocument } from "../types";
import { createYShape, isYShapeEmpty, REMOTE_ORIGIN, type YShape } from "./yDoc";
import { buildDocFromY, reconcileCurrentDocumentToY } from "./reconcile";
import { SERVICES } from "../services";
import {
  WebPubSubProvider,
  type CollabStatus,
} from "./WebPubSubProvider";
import { importKey } from "./crypto";

export interface UseCollabOptions {
  // Null means "not joined". The hook tears down any active session
  // when this transitions back to null.
  room: string | null;
  // Base64url-encoded 32-byte AES-256 key from the URL hash. Required
  // when `room` is non-null; collab refuses to start without one so
  // that messages on the wire are always end-to-end encrypted.
  key: string | null;
  // Live mirror of the local PsDocument. Updates here trigger a
  // reconcile-to-Y on every change. Pass `docRef.current` here from
  // StoreProvider so the value reflects the most recent setDoc.
  doc: PsDocument;
  classificationDefinitions?: readonly CatalogDefinitionSnapshot[];
  // Snapshot-free setter, exposed by StoreProvider. Remote updates
  // never grow the local undo stack.
  setDocFromCollab: (
    doc: PsDocument,
    options: { resetHistory: boolean },
  ) => void;
  // When true, if the Y.Doc is still empty after a brief grace period
  // following connect, push the current local doc into the room.
  // Set true for Share-button joins (the creator publishes their
  // working diagram) and false for hash-URL auto-joins (the joiner is
  // expected to receive state from existing peers and shouldn't risk
  // polluting the room with a stale autosave).
  seedFromLocal: boolean;
}

export interface CollabState {
  status: CollabStatus;
  errorDetail: string | null;
  room: string | null;
}

async function indexedDbDatabaseExists(name: string): Promise<boolean> {
  const listDatabases = window.indexedDB.databases;
  if (typeof listDatabases !== "function") {
    // Older browsers cannot enumerate databases, so attempt the legacy read
    // rather than risk losing a pre-rename offline room cache.
    return true;
  }
  const databases = await listDatabases.call(window.indexedDB);
  return databases.some((database) => database.name === name);
}

export function useCollab(opts: UseCollabOptions): CollabState {
  const { room, key, doc, setDocFromCollab, seedFromLocal } = opts;
  const classificationDefinitionsRef = useRef(opts.classificationDefinitions);
  classificationDefinitionsRef.current = opts.classificationDefinitions;

  const [state, setState] = useState<CollabState>(() =>
    !SERVICES.collaboration.enabled
      ? {
          status: "disabled",
          errorDetail: SERVICES.collaboration.message,
          room: null,
        }
      : {
          status: "idle",
          errorDetail: null,
          room: null,
        },
  );

  const yRef = useRef<YShape | null>(null);
  const invalidRoomStateRef = useRef(false);
  const providerRef = useRef<WebPubSubProvider | null>(null);
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);
  // Identity of the last doc reference we pushed into the store from a
  // remote / IndexedDB source. The local->Y effect compares the current
  // doc against this and skips the reconcile when they're the same
  // reference, breaking the otherwise-immediate echo loop:
  //   remote update -> setDoc(newDoc)
  //                 -> render with newDoc
  //                 -> effect would reconcileLocalToY(newDoc) (LOCAL_ORIGIN)
  //                 -> provider rebroadcasts to peers.
  // Reference identity is sufficient because setDoc(newDoc) preserves
  // the reference until something else mutates state.
  const lastAppliedFromCollabRef = useRef<PsDocument | null>(null);
  // Latest doc — read inside the Y "update" listener so we can decide
  // whether to push the rebuilt doc back into the store.
  const docRef = useRef<PsDocument>(doc);
  docRef.current = doc;
  const setDocFromCollabRef = useRef(setDocFromCollab);
  setDocFromCollabRef.current = setDocFromCollab;

  // Bring up / tear down on room change.
  useEffect(() => {
    if (!SERVICES.collaboration.enabled) return;
    if (!room) return;
    if (!key) {
      setState({
        status: "error",
        errorDetail:
          "Missing collaboration key. Make sure the URL contains the #key= fragment.",
        room,
      });
      return;
    }

    let cancelled = false;
    let adoptedRoomState = false;
    const yShape = createYShape();
    yRef.current = yShape;
    invalidRoomStateRef.current = false;
    let transportState: CollabState = { status: "connecting", errorDetail: null, room };
    setState(transportState);

    // Seed Y from the local doc only if the Y.Doc is empty (i.e. this
    // is a brand-new room, not a rejoin where IndexedDB already has
    // state). Doing it unconditionally would clobber peers.
    const yIsEmpty = (shape: YShape = yShape) => isYShapeEmpty(shape);
    const applyRoomState = (rebuilt: PsDocument) => {
      if (invalidRoomStateRef.current) setState(transportState);
      invalidRoomStateRef.current = false;
      const resetHistory = !adoptedRoomState;
      adoptedRoomState = true;
      lastAppliedFromCollabRef.current = rebuilt;
      setDocFromCollabRef.current(rebuilt, { resetHistory });
    };

    // IndexedDB cache, scoped per-room. Lets a peer rejoin while
    // disconnected and resync when others come back.
    const persistence = new IndexeddbPersistence(
      `secure-design-studio:collab:${room}`,
      yShape.ydoc,
    );
    persistenceRef.current = persistence;
    const legacyPersistenceName = `privsec:collab:${room}`;
    let legacyShape: YShape | null = null;
    let legacyPersistence: IndexeddbPersistence | null = null;
    let seedTimer: number | null = null;

    // Y -> store: any non-local origin update means a remote (or
    // IndexedDB load) change. Materialise and push.
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) {
        try {
          applyRoomState(buildDocFromY(yShape));
        } catch (error) {
          invalidRoomStateRef.current = true;
          setState({
            status: "error",
            errorDetail: error instanceof Error ? error.message : String(error),
            room,
          });
        }
      }
    };
    yShape.ydoc.on("update", onUpdate);

    let provider: WebPubSubProvider | null = null;

    (async () => {
      try {
        await persistence.whenSynced;
        if (cancelled) return;

        // A room first opened by a pre-rename build has only the legacy cache.
        // Copy it into the new namespace once; all subsequent updates persist
        // under the SecureDesignStudio key.
        const hasLegacyPersistence =
          yIsEmpty() &&
          (await indexedDbDatabaseExists(legacyPersistenceName));
        if (cancelled) return;
        if (hasLegacyPersistence) {
          legacyShape = createYShape();
          legacyPersistence = new IndexeddbPersistence(
            legacyPersistenceName,
            legacyShape.ydoc,
          );
          await legacyPersistence.whenSynced;
          if (cancelled) return;
          if (!yIsEmpty(legacyShape)) {
            Y.applyUpdate(
              yShape.ydoc,
              Y.encodeStateAsUpdate(legacyShape.ydoc),
            );
          }
        }
        if (!yIsEmpty()) {
          try {
            applyRoomState(buildDocFromY(yShape));
          } catch (error) {
            invalidRoomStateRef.current = true;
            throw error;
          }
        }
        legacyPersistence?.destroy();
        legacyShape?.ydoc.destroy();
        legacyPersistence = null;
        legacyShape = null;

        const cryptoKey = await importKey(key);
        if (cancelled) return;
        provider = new WebPubSubProvider({
          ydoc: yShape.ydoc,
          room,
          key: cryptoKey,
          onStatus: (status, detail) => {
            if (cancelled) return;
            transportState = {
              status,
              errorDetail: status === "error" ? detail ?? null : null,
              room,
            };
            if (invalidRoomStateRef.current && status !== "error") return;
            setState(transportState);
          },
        });
        providerRef.current = provider;
        await provider.start();

        // Give network sync a brief grace period before a Share-button creator
        // seeds a genuinely empty room. Hash-link joiners never seed.
        seedTimer = window.setTimeout(() => {
          if (cancelled) return;
          if (seedFromLocal && yIsEmpty()) {
            try {
              const definitions = classificationDefinitionsRef.current;
              reconcileCurrentDocumentToY(yShape, withCatalogDefinitions(docRef.current, definitions), definitions);
            } catch (error) {
              setState({
                status: "error",
                errorDetail: error instanceof Error ? error.message : String(error),
                room,
              });
            }
          }
        }, 3000);
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          errorDetail: err instanceof Error ? err.message : String(err),
          room,
        });
      }
    })();

    return () => {
      cancelled = true;
      if (seedTimer != null) window.clearTimeout(seedTimer);
      yShape.ydoc.off("update", onUpdate);
      if (provider) provider.destroy();
      providerRef.current = null;
      persistence.destroy();
      legacyPersistence?.destroy();
      legacyShape?.ydoc.destroy();
      persistenceRef.current = null;
      yShape.ydoc.destroy();
      yRef.current = null;
      invalidRoomStateRef.current = false;
      setState({ status: "idle", errorDetail: null, room: null });
    };
    // We deliberately depend only on room/key. Doc + setter changes are
    // funnelled through refs so we don't tear down the connection on
    // every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, key, seedFromLocal]);

  // store -> Y: shallow per-field reconcile after each local doc change.
  useEffect(() => {
    const y = yRef.current;
    if (!y) return;
    // Do not publish a stale local snapshot after rejecting malformed or
    // unsupported room data. A subsequent valid remote state clears the gate.
    if (invalidRoomStateRef.current) return;
    // Identity check — if this doc is the one we just pushed in from
    // the network or from IndexedDB, the Y.Doc is already in sync and
    // re-running the reconciler would echo it back to peers under
    // LOCAL_ORIGIN.
    if (lastAppliedFromCollabRef.current === doc) return;
    try {
      const definitions = classificationDefinitionsRef.current;
      reconcileCurrentDocumentToY(y, withCatalogDefinitions(doc, definitions), definitions);
    } catch (error) {
      setState({
        status: "error",
        errorDetail: error instanceof Error ? error.message : String(error),
        room: opts.room,
      });
    }
  }, [doc]);

  return state;
}
