import defaults from "./data/communicationProtocols.json";
import { isAuthenticationType, type AuthenticationType } from "./authentication";
import { validateAiDesignGuidance, type AiDesignGuidance } from "../shared/aiDesignGuidance";

declare const protocolId: unique symbol;
export type ProtocolId = string & { readonly [protocolId]: true };
export type ProtocolTransport = "tcp" | "udp-or-tcp" | "http-dependent" | "unspecified" | "custom";
export type ProtocolChannelProtection = "unspecified" | "implicit-tls" | "tls-upgrade" | "ssh" | "custom";

// All semantics are authored descriptions, never evidence of negotiated controls.
// In particular, unspecified protection proves neither cleartext nor encryption.
export interface ProtocolSemantics {
  protocol: string;
  transport: ProtocolTransport;
  channelProtection: ProtocolChannelProtection;
  description: string;
}

export interface ProtocolTypeDef {
  id: ProtocolId;
  label: string;
  shortLabel: string;
  description: string;
  group: string;
  semantics: ProtocolSemantics;
  // Advisory ranking only; neither an allow-list nor an authentication mutation.
  authenticationSuggestions: AuthenticationType[];
  aiDesignGuidance: AiDesignGuidance;
  disabled: boolean;
}

export const PROTOCOL_CATALOG_FORMAT = "secure-design-studio-protocol-catalog";
export const PROTOCOL_STORAGE_KEY = "secure-design-studio:protocol-library:v1";
export const MAX_PROTOCOL_DEFINITIONS = 2000;
const forbiddenIds = new Set(
  ["__proto__", "prototype", ...Object.getOwnPropertyNames(Object.prototype)]
    .map(value => value.toLowerCase()),
);
const transports: readonly ProtocolTransport[] = ["tcp", "udp-or-tcp", "http-dependent", "unspecified", "custom"];
const protections: readonly ProtocolChannelProtection[] = ["unspecified", "implicit-tls", "tls-upgrade", "ssh", "custom"];

export function isProtocolId(value: unknown): value is ProtocolId {
  return typeof value === "string" && value.length <= 128
    && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) && !forbiddenIds.has(value);
}

export function validateProtocolReference(value: unknown): ProtocolId | undefined {
  if (value === undefined) return undefined;
  if (!isProtocolId(value)) throw new Error("Protocol reference: expected a stable lowercase kebab-case ID.");
  return value;
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}: expected an object.`);
  }
  return value as Record<string, unknown>;
}

function keys(raw: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new Error(`${where}: unsupported field "${key}".`);
  }
}

function text(value: unknown, where: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${where}: expected nonblank text of at most ${max} characters.`);
  }
  return value.trim();
}

export function validateProtocolDefinition(value: unknown): ProtocolTypeDef {
  const where = "Communication profile";
  const raw = object(value, where);
  keys(raw, ["id", "label", "shortLabel", "description", "group", "semantics",
    "authenticationSuggestions", "aiDesignGuidance", "disabled"], where);
  if (!isProtocolId(raw.id)) throw new Error(`${where}.id: expected a nonreserved lowercase kebab-case ID (maximum 128).`);
  const semantics = object(raw.semantics, `${where}.semantics`);
  keys(semantics, ["protocol", "transport", "channelProtection", "description"], `${where}.semantics`);
  if (!transports.includes(semantics.transport as ProtocolTransport)) {
    throw new Error(`${where}.semantics.transport: unsupported transport.`);
  }
  if (!protections.includes(semantics.channelProtection as ProtocolChannelProtection)) {
    throw new Error(`${where}.semantics.channelProtection: unsupported channel protection.`);
  }
  if (typeof raw.disabled !== "boolean") throw new Error(`${where}.disabled: expected a boolean.`);
  if (!Array.isArray(raw.authenticationSuggestions) || raw.authenticationSuggestions.length > 100
      || [...raw.authenticationSuggestions].some(id => !isAuthenticationType(id))
      || new Set(raw.authenticationSuggestions).size !== raw.authenticationSuggestions.length) {
    throw new Error(`${where}.authenticationSuggestions: expected at most 100 distinct valid authentication IDs.`);
  }
  const guidance = validateAiDesignGuidance(raw.aiDesignGuidance);
  if (!guidance) throw new Error(`${where}.aiDesignGuidance: guidance is required, including for custom profiles.`);
  if (guidance.sources && Array.from(guidance.sources).some(source => typeof source !== "string")) {
    throw new Error(`${where}.aiDesignGuidance.sources: sparse URL lists are not supported.`);
  }
  return {
    id: raw.id,
    label: text(raw.label, `${where}.label`, 80),
    shortLabel: text(raw.shortLabel, `${where}.shortLabel`, 24),
    description: text(raw.description, `${where}.description`, 4000),
    group: text(raw.group, `${where}.group`, 80),
    semantics: {
      protocol: text(semantics.protocol, `${where}.semantics.protocol`, 160),
      transport: semantics.transport as ProtocolTransport,
      channelProtection: semantics.channelProtection as ProtocolChannelProtection,
      description: text(semantics.description, `${where}.semantics.description`, 4000),
    },
    authenticationSuggestions: [...raw.authenticationSuggestions] as AuthenticationType[],
    aiDesignGuidance: guidance,
    disabled: raw.disabled,
  };
}

// Strict and atomic for both profile preferences and portable saved definitions.
// Unknown IDs are allowed on valid definitions, not a license for malformed ones.
export function validateProtocolDefinitions(value: unknown): ProtocolTypeDef[] {
  if (!Array.isArray(value) || value.length > MAX_PROTOCOL_DEFINITIONS) {
    throw new Error(`Communication profiles: expected an array of at most ${MAX_PROTOCOL_DEFINITIONS} definitions.`);
  }
  const definitions = Array.from(value, validateProtocolDefinition);
  const ids = new Set<ProtocolId>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate protocol ID "${definition.id}". No changes were applied.`);
    ids.add(definition.id);
  }
  return definitions;
}

export const PROTOCOL_TYPE_DEFS: readonly ProtocolTypeDef[] = Object.freeze(
  validateProtocolDefinitions(defaults).map(definition => {
    Object.freeze(definition.semantics);
    Object.freeze(definition.authenticationSuggestions);
    if (definition.aiDesignGuidance.sources) Object.freeze(definition.aiDesignGuidance.sources);
    Object.freeze(definition.aiDesignGuidance);
    return Object.freeze(definition);
  }),
);

export function parseProtocolCatalog(value: unknown): ProtocolTypeDef[] {
  const raw = object(value, "Protocol catalog");
  keys(raw, ["format", "version", "protocols"], "Protocol catalog");
  if (raw.format !== PROTOCOL_CATALOG_FORMAT || raw.version !== 1) {
    throw new Error(`Expected format "${PROTOCOL_CATALOG_FORMAT}", version 1.`);
  }
  return validateProtocolDefinitions(raw.protocols);
}

export function exportProtocolCatalog(definitions: readonly ProtocolTypeDef[]): string {
  return JSON.stringify({
    format: PROTOCOL_CATALOG_FORMAT, version: 1, protocols: validateProtocolDefinitions(definitions),
  }, null, 2);
}

export function loadProtocolLibrary(): {
  definitions: ProtocolTypeDef[];
  error: string | null;
  storedValue: string | null;
} {
  let storedValue: string | null = null;
  try {
    storedValue = window.localStorage.getItem(PROTOCOL_STORAGE_KEY);
    return {
      definitions: storedValue === null ? validateProtocolDefinitions(PROTOCOL_TYPE_DEFS)
        : parseProtocolCatalog(JSON.parse(storedValue)),
      error: null,
      storedValue,
    };
  } catch (cause) {
    return {
      definitions: validateProtocolDefinitions(PROTOCOL_TYPE_DEFS),
      error: `Communication Library could not be loaded: ${(cause as Error).message}`,
      storedValue,
    };
  }
}

export function persistProtocolLibrary(
  definitions: readonly ProtocolTypeDef[],
  expected?: readonly ProtocolTypeDef[],
): void {
  const next = validateProtocolDefinitions(definitions);
  try {
    if (expected) {
      const stored = window.localStorage.getItem(PROTOCOL_STORAGE_KEY);
      const actual = stored === null ? validateProtocolDefinitions(PROTOCOL_TYPE_DEFS)
        : parseProtocolCatalog(JSON.parse(stored));
      if (JSON.stringify(actual) !== JSON.stringify(validateProtocolDefinitions(expected))) {
        throw new Error("The Communication Library changed in another window. Reload it before saving.");
      }
    }
    window.localStorage.setItem(PROTOCOL_STORAGE_KEY, exportProtocolCatalog(next));
  } catch (cause) {
    throw new Error(`Communication Library could not be saved: ${(cause as Error).message}`);
  }
}

export function sameProtocolDefinition(a: ProtocolTypeDef, b: ProtocolTypeDef): boolean {
  return JSON.stringify(validateProtocolDefinition(a)) === JSON.stringify(validateProtocolDefinition(b));
}

export interface ProtocolDefinitionConflict {
  id: ProtocolId;
  current: ProtocolTypeDef;
  incoming: ProtocolTypeDef;
}

export type ProtocolMergeResult =
  | { status: "merged"; definitions: ProtocolTypeDef[] }
  | { status: "conflict"; conflicts: ProtocolDefinitionConflict[] };

export interface ProtocolConflictResolution {
  id: ProtocolId;
  resolution: "keep-current" | "use-imported";
}

function conflictsBetween(current: readonly ProtocolTypeDef[], incoming: readonly ProtocolTypeDef[]): ProtocolDefinitionConflict[] {
  const existing = new Map(current.map(definition => [definition.id, definition]));
  return incoming.flatMap(definition => {
    const before = existing.get(definition.id);
    return before && !sameProtocolDefinition(before, definition)
      ? [{ id: definition.id, current: before, incoming: definition }] : [];
  });
}

function mergedDefinitions(current: ProtocolTypeDef[], incoming: ProtocolTypeDef[], keep: ReadonlySet<ProtocolId>): ProtocolTypeDef[] {
  const replacements = new Map(incoming.filter(definition => !keep.has(definition.id)).map(definition => [definition.id, definition]));
  return validateProtocolDefinitions([
    ...current.map(definition => replacements.get(definition.id) ?? definition),
    ...incoming.filter(definition => !current.some(existing => existing.id === definition.id)),
  ]);
}

// A conflict returns no partially merged library. Caller must preview and decide.
export function mergeProtocolLibrary(current: readonly ProtocolTypeDef[], incoming: readonly ProtocolTypeDef[]): ProtocolMergeResult {
  const before = validateProtocolDefinitions(current);
  const imported = validateProtocolDefinitions(incoming);
  const conflicts = conflictsBetween(before, imported);
  return conflicts.length ? { status: "conflict", conflicts }
    : { status: "merged", definitions: mergedDefinitions(before, imported, new Set()) };
}

export function resolveProtocolLibraryConflicts(
  current: readonly ProtocolTypeDef[], incoming: readonly ProtocolTypeDef[], resolutions: readonly ProtocolConflictResolution[],
): ProtocolTypeDef[] {
  const before = validateProtocolDefinitions(current);
  const imported = validateProtocolDefinitions(incoming);
  const conflicts = conflictsBetween(before, imported);
  if (!Array.isArray(resolutions)) throw new Error("Protocol conflict resolutions: expected an array.");
  const required = new Set(conflicts.map(conflict => conflict.id));
  const decisions = new Map<ProtocolId, ProtocolConflictResolution["resolution"]>();
  for (const value of resolutions) {
    const raw = object(value, "Protocol conflict resolution");
    keys(raw, ["id", "resolution"], "Protocol conflict resolution");
    if (!isProtocolId(raw.id) || !required.has(raw.id) || decisions.has(raw.id)
        || (raw.resolution !== "keep-current" && raw.resolution !== "use-imported")) {
      throw new Error("Protocol conflict resolutions must decide each actual conflict exactly once.");
    }
    decisions.set(raw.id, raw.resolution);
  }
  if (decisions.size !== required.size) throw new Error("Every protocol conflict requires an explicit resolution.");
  const keep = new Set([...decisions].filter(([, resolution]) => resolution === "keep-current").map(([id]) => id));
  return mergedDefinitions(before, imported, keep);
}

export type ProtocolResolution =
  | { status: "unspecified" }
  | { status: "unresolved"; id: ProtocolId; label: string; shortLabel: "Unresolved"; selectable: false }
  | {
    status: "resolved"; id: ProtocolId; definition: ProtocolTypeDef;
    definitionSource: "saved" | "available"; selectable: boolean;
    conflict?: ProtocolDefinitionConflict; unavailableReason?: string;
  };

function resolveValidatedProtocol(
  id: ProtocolId | undefined, saved: readonly ProtocolTypeDef[], available: readonly ProtocolTypeDef[],
): ProtocolResolution {
  if (id === undefined) return { status: "unspecified" };
  const stored = saved.find(definition => definition.id === id);
  const installed = available.find(definition => definition.id === id);
  const definition = stored ?? installed;
  if (!definition) return { status: "unresolved", id, label: `${id} (unresolved)`, shortLabel: "Unresolved", selectable: false };
  const conflict = stored && installed && !sameProtocolDefinition(stored, installed)
    ? { id, current: installed, incoming: stored } : undefined;
  const unavailableReason = !installed ? "Definition is saved but absent from the available protocol library."
    : conflict ? "Saved definition differs from the available protocol library; explicitly resolve the conflict."
    : definition.disabled || installed.disabled ? "This profile is disabled for new choices." : undefined;
  return {
    status: "resolved", id, definition, definitionSource: stored ? "saved" : "available",
    selectable: unavailableReason === undefined,
    ...(conflict ? { conflict } : {}), ...(unavailableReason ? { unavailableReason } : {}),
  };
}

// Saved data controls document display; comparison uses the actual available
// library, never a saved-first catalog that would conceal same-ID differences.
export function resolveProtocolReference(
  id: ProtocolId | undefined, saved: readonly ProtocolTypeDef[] = [], available: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS,
): ProtocolResolution {
  return resolveValidatedProtocol(validateProtocolReference(id), validateProtocolDefinitions(saved), validateProtocolDefinitions(available));
}

export function protocolDefinitionConflicts(
  saved: readonly ProtocolTypeDef[], available: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS,
): ProtocolDefinitionConflict[] {
  return conflictsBetween(validateProtocolDefinitions(available), validateProtocolDefinitions(saved));
}

export function selectableProtocolDefinitions(available: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS): ProtocolTypeDef[] {
  return validateProtocolDefinitions(available).filter(definition => !definition.disabled);
}

// Structural input keeps this pure module independent of the application schema.
export interface ProtocolDocument {
  edges: readonly { protocolId?: ProtocolId }[];
  protocolDefinitions?: readonly ProtocolTypeDef[];
}

export function protocolReferences(doc: Pick<ProtocolDocument, "edges">): Set<ProtocolId> {
  const ids = new Set<ProtocolId>();
  for (const edge of doc.edges) {
    const id = validateProtocolReference(edge.protocolId);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

export function protocolCatalogFor(
  doc: ProtocolDocument, available: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS,
): ProtocolResolution[] {
  const library = validateProtocolDefinitions(available);
  const saved = validateProtocolDefinitions(doc.protocolDefinitions ?? []);
  const ids = new Set([...library.map(definition => definition.id), ...saved.map(definition => definition.id), ...protocolReferences(doc)]);
  return [...ids].map(id => resolveValidatedProtocol(id, saved, library));
}

export function withProtocolDefinitions<T extends ProtocolDocument>(
  doc: T, available: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS,
): T & { protocolDefinitions: ProtocolTypeDef[] } {
  const library = validateProtocolDefinitions(available);
  const saved = validateProtocolDefinitions(doc.protocolDefinitions ?? []);
  const definitions = new Map(saved.map(definition => [definition.id, definition]));
  for (const id of protocolReferences(doc)) {
    const definition = library.find(entry => entry.id === id);
    if (definition && !definitions.has(id)) definitions.set(id, definition);
  }
  return { ...doc, protocolDefinitions: validateProtocolDefinitions([...definitions.values()]) };
}

// The custom template is a real choice; authored entries get separate IDs.
// The author must revise its generic guidance and descriptive semantics.
export function createCustomProtocolId(name: string, existing: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS): ProtocolId {
  const label = text(name, "Custom protocol name", 80);
  const slug = label.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").slice(0, 110).replace(/^-|-$/g, "") || "entry";
  const stem = `custom-${slug}`;
  const ids = new Set(validateProtocolDefinitions(existing).map(definition => definition.id as string));
  let candidate = stem;
  for (let suffix = 2; ids.has(candidate); suffix++) candidate = `${stem}-${suffix}`;
  if (!isProtocolId(candidate)) throw new Error("Could not create a valid custom protocol ID.");
  return candidate;
}

export function createCustomProtocolDefinition(
  name: string, existing: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS,
): ProtocolTypeDef {
  const template = PROTOCOL_TYPE_DEFS.find(definition => definition.id === "custom")!;
  return validateProtocolDefinition({
    ...template, id: createCustomProtocolId(name, existing),
    label: text(name, "Custom protocol name", 80), shortLabel: name.trim().slice(0, 24),
  });
}
