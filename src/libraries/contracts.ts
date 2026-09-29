import type { AuthTypeDef } from "../authentication";
import type { ClassificationLibrary } from "../classificationLibrary";
import type { CatalogDefinitionSnapshot, NodeTypeRef } from "../types";

export const LIBRARY_API_VERSION = 1;
export const LIBRARY_FORMAT = "secure-design-studio-library";
export const MAX_LIBRARY_BYTES = 1_048_576;
export const MAX_LIBRARY_SET_BYTES = 4_194_304;
export const MAX_LIBRARIES = 16;

export interface LibraryIdentity {
  id: string;
  name: string;
  version: string;
}

export interface MetadataField {
  id: string;
  target: "node" | "edge";
  storage: "metadata" | "serviceTreeId" | "endpointRegex";
  label: string;
  description?: string;
  validation?: "guid";
  library?: { id: string; version: string };
}

export interface LibraryRule {
  id: string;
  target: "node" | "edge";
  fieldId: string;
  check: "required" | "guid";
  title: string;
  description: string;
  resolutionLink?: string;
}

export interface LibraryHelp {
  id: string;
  title: string;
  text: string;
  url?: string;
}

export interface LibraryPackage extends LibraryIdentity {
  format: typeof LIBRARY_FORMAT;
  apiVersion: typeof LIBRARY_API_VERSION;
  dependencies: { id: string; version: string }[];
  // Exact contribution keys with the expected previous owner; no implicit
  // last-writer-wins ordering. An overlay owner must also be a dependency.
  overrides: { key: string; from: string }[];
  catalogs: {
    authentication: AuthTypeDef[];
    classifications?: ClassificationLibrary;
    nodes: NodeTypeRef[];
    taxonomy: CatalogDefinitionSnapshot[];
  };
  fields: MetadataField[];
  rules: LibraryRule[];
  help: LibraryHelp[];
}

export interface LibraryCandidate {
  source: string;
  value?: unknown;
  error?: string;
}

export interface LibraryStatus {
  source: string;
  identity?: LibraryIdentity;
  state: "loaded" | "rejected" | "unavailable";
  message?: string;
  contributions: readonly string[];
}

export interface LibraryRegistry {
  statuses: readonly LibraryStatus[];
  authentication: readonly AuthTypeDef[];
  classifications: ClassificationLibrary;
  nodes: readonly NodeTypeRef[];
  taxonomy: readonly CatalogDefinitionSnapshot[];
  fields: readonly MetadataField[];
  rules: readonly LibraryRule[];
  help: readonly LibraryHelp[];
  provenance: Readonly<Record<string, string>>;
  coreRuleIds: readonly string[];
}

export type LibraryDelivery =
  | { mode: "embedded"; candidates: LibraryCandidate[] }
  | { mode: "same-origin"; manifest: string };
