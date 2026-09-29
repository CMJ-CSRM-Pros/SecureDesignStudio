// Local-storage autosave for the entire working document plus undo/redo
// history. Survives accidental tab close / refresh.
//
// Bundle format (versioned):
//   { version, doc, past[], future[], view: { activeScenarioId, filter } }
//
// `past` and `future` are arrays of full PsDocument snapshots, matching the
// in-memory undo/redo stacks. We cap how many we persist (separately from
// the in-memory cap) because localStorage typically has a 5–10 MB quota.
//
// All reads/writes are wrapped in try/catch — localStorage may be
// unavailable (private mode, sandboxed iframe) or full.

import type { AuthTypeDef, PsDocument } from "./types";
import type { ClassificationLibrary } from "./classificationLibrary";

const STORAGE_KEY = "secure-design-studio:autosave:v1";
const LEGACY_STORAGE_KEY = "privsec-diagram:autosave:v1";
const CURRENT_VERSION = 1;

// History trim ladder for the quota-fallback retry path. Saving tries each
// limit in turn until one succeeds; the last (0) drops history entirely.
const HISTORY_TRIM_LADDER = [25, 10, 5, 0] as const;

export interface AutosaveView {
  activeScenarioId: string | null;
  // Free-form structural — store.tsx coerces back to FilterState on read.
  filter: unknown;
}

export interface AutosaveBundle {
  doc: PsDocument;
  past: PsDocument[];
  future: PsDocument[];
  view: AutosaveView;
  authenticationHistory?: { past: (AuthTypeDef[] | null)[]; future: (AuthTypeDef[] | null)[] };
  classificationHistory?: { past: (ClassificationLibrary | null)[]; future: (ClassificationLibrary | null)[] };
}

export interface PersistedBundle {
  version: number;
  doc: unknown;
  past: unknown[];
  future: unknown[];
  view: unknown;
  authenticationHistory?: unknown;
  classificationHistory?: unknown;
}

export function loadAutosaveRaw(): PersistedBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    const current = storage?.getItem(STORAGE_KEY);
    const raw = current ?? storage?.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (!("doc" in p)) return null;
    if (!current) {
      // Migrate legacy browser state in place. Future saves use only the
      // SecureDesignStudio namespace; the legacy value is retained so an older
      // deployed build can still recover the same local document.
      storage?.setItem(STORAGE_KEY, raw);
    }
    return {
      version: typeof p.version === "number" ? p.version : 0,
      doc: p.doc,
      past: Array.isArray(p.past) ? p.past : [],
      future: Array.isArray(p.future) ? p.future : [],
      view: p.view ?? null,
      authenticationHistory: p.authenticationHistory,
      classificationHistory: p.classificationHistory,
    };
  } catch {
    /* corrupt JSON or storage unavailable */
    return null;
  }
}

export function saveAutosave(bundle: AutosaveBundle): void {
  if (typeof window === "undefined") return;
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  if (!storage) return;

  // Try progressively smaller history caps so a big diagram still saves
  // (without history) rather than failing silently when the quota is hit.
  for (const limit of HISTORY_TRIM_LADDER) {
    const payload = {
      version: CURRENT_VERSION,
      doc: bundle.doc,
      past: limit > 0 ? bundle.past.slice(-limit) : [],
      future: limit > 0 ? bundle.future.slice(-limit) : [],
      view: bundle.view,
      authenticationHistory: bundle.authenticationHistory ? {
        past: limit > 0 ? bundle.authenticationHistory.past.slice(-limit) : [],
        future: limit > 0 ? bundle.authenticationHistory.future.slice(-limit) : [],
      } : undefined,
      classificationHistory: bundle.classificationHistory ? {
        past: limit > 0 ? bundle.classificationHistory.past.slice(-limit) : [],
        future: limit > 0 ? bundle.classificationHistory.future.slice(-limit) : [],
      } : undefined,
    };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return;
    } catch {
      // Quota or serialization error — try a smaller payload.
    }
  }
}

export function clearAutosave(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
    window.localStorage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
