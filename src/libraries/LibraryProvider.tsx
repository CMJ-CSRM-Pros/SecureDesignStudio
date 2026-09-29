import { createContext, useContext, type ReactNode } from "react";
import type { LibraryRegistry } from "./contracts";
import { CORE_LIBRARIES } from "./registry";

const LibraryContext = createContext<LibraryRegistry>(CORE_LIBRARIES);

export function LibraryProvider({ registry, children }: { registry: LibraryRegistry; children: ReactNode }) {
  return <LibraryContext.Provider value={registry}>{children}</LibraryContext.Provider>;
}

export const useLibraries = () => useContext(LibraryContext);
