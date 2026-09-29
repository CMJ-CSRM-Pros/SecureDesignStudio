// Persistent state for which tab ("general" or "privacy") is active in the
// right-pane details inspector. Lives outside React so it survives
// NodeDetails/EdgeDetails being unmounted and remounted as the selection
// changes from one element to another, and is mirrored to localStorage so
// it also survives reloads.

import { useSyncExternalStore } from "react";

export type DetailsTab = "general" | "privacy";

const STORAGE_KEY = "ps-details-tab";

function readInitial(): DetailsTab {
  if (typeof window === "undefined") return "general";
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw === "general" || raw === "privacy") return raw;
  } catch {
    /* localStorage may be unavailable (private mode, sandboxed iframe) */
  }
  return "general";
}

let currentTab: DetailsTab = readInitial();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): DetailsTab {
  return currentTab;
}

export function setDetailsTab(tab: DetailsTab): void {
  if (tab === currentTab) return;
  currentTab = tab;
  try {
    window.localStorage?.setItem(STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
  for (const cb of listeners) cb();
}

export function resetDetailsTab(): void {
  setDetailsTab("general");
}

export function useDetailsTab(): [DetailsTab, (tab: DetailsTab) => void] {
  const tab = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [tab, setDetailsTab];
}
