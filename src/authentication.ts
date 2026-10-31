import defaults from "./data/authTypes.json";
import compatibilityIdentities from "./data/authenticationCompatibility.json";
import type { AllowedAuthMethodStatus, PsDocument } from "./types";
import { validateAiDesignGuidance, type AiDesignGuidance } from "../shared/aiDesignGuidance";

export type KnownAuthenticationType =
  | "EntraDelegatedUserAccess"
  | "EntraApplicationOnlyAccess"
  | "EntraApplicationOnlyWithForwardedUserContext"
  | "EntraApplicationOnlyWithCdt"
  | "ProtectedForwardedAccessToken"
  | "PopWithProtectedForwardedToken"
  | "CertificateAuthentication"
  | "SharedAccessSignature"
  | "SharedKeyAuthorization"
  | "AnonymousAccess"
  | "InternalProcessCall"
  | "CustomAuthentication"
  | "EntraOnBehalfOf"
  | "EntraManagedIdentity"
  | "EntraFederatedWorkloadIdentity"
  | "OAuthAccessToken"
  | "ClientCertificateMtls"
  | "ApiKey";

declare const authenticationId: unique symbol;
export type AuthenticationType = KnownAuthenticationType | (string & {
  readonly [authenticationId]: true;
});

export interface AuthBehavior {
  productionIdentity: "required" | "optional" | "unknown";
  audience: boolean;
  constraints: boolean;
  anonymous: boolean;
  managedIdentity: boolean;
}

export interface AuthTypeDef {
  id: AuthenticationType;
  label: string;
  description: string;
  shortLabel: string;
  behavior: AuthBehavior;
  disabled: boolean;
  legacy: boolean;
  aliases: string[];
  aiDesignGuidance?: AiDesignGuidance;
  unresolved?: true;
  // Resolution-only diagnostic. Never serialize this as a saved definition.
  unavailableReason?: string;
}

export const AUTHENTICATION_CATALOG_FORMAT = "secure-design-studio-authentication-catalog";
export const AUTHENTICATION_STORAGE_KEY = "secure-design-studio:authentication-library:v1";
export const LEGACY_AUTHENTICATION_IDS: ReadonlySet<string> = new Set([
  "EntraDelegatedUserAccess", "EntraApplicationOnlyAccess",
  "EntraApplicationOnlyWithForwardedUserContext", "EntraApplicationOnlyWithCdt",
  "ProtectedForwardedAccessToken", "PopWithProtectedForwardedToken",
  "CertificateAuthentication", "SharedAccessSignature", "SharedKeyAuthorization",
  "AnonymousAccess", "CustomAuthentication",
]);
export const UNKNOWN_AUTH_BEHAVIOR: Readonly<AuthBehavior> = Object.freeze({
  productionIdentity: "unknown", audience: false, constraints: false,
  anonymous: false, managedIdentity: false,
});
const forbiddenIds = new Set(
  ["__proto__", "prototype", ...Object.getOwnPropertyNames(Object.prototype)]
    .map(value => value.toLowerCase()),
);

export function isAuthenticationType(value: unknown): value is AuthenticationType {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value)
    && !forbiddenIds.has(value.toLowerCase());
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}: expected an object.`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], where: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where}: unsupported field "${key}".`);
  }
}

function text(value: unknown, where: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`${where}: expected ${allowEmpty ? "" : "nonempty "}text, at most ${max} characters.`);
  }
  return value.trim();
}

function parseDefinition(value: unknown, where: string, canonical?: AuthTypeDef): AuthTypeDef {
  const raw = object(value, where);
  keys(raw, ["id", "label", "description", "shortLabel", "behavior", "disabled", "legacy", "aliases", "aiDesignGuidance"], where);
  const aiDesignGuidance = validateAiDesignGuidance(raw.aiDesignGuidance);
  if (!isAuthenticationType(raw.id)) {
    throw new Error(`${where}.id: use a letter followed by letters, numbers, ".", "_" or "-" (maximum 128); reserved object names are not IDs.`);
  }
  const label = text(raw.label, `${where}.label (Method)`, 80);
  const behavior = raw.behavior === undefined
    ? { ...(canonical?.behavior ?? UNKNOWN_AUTH_BEHAVIOR) } : object(raw.behavior, `${where}.behavior`);
  keys(behavior, ["productionIdentity", "audience", "constraints", "anonymous", "managedIdentity"], `${where}.behavior`);
  if (!["required", "optional", "unknown"].includes(String(behavior.productionIdentity))) {
    throw new Error(`${where}.behavior.productionIdentity: expected required, optional or unknown.`);
  }
  for (const flag of ["audience", "constraints", "anonymous", "managedIdentity"]) {
    if (typeof behavior[flag] !== "boolean") throw new Error(`${where}.behavior.${flag}: expected a boolean.`);
  }
  if (behavior.managedIdentity && behavior.productionIdentity !== "required") {
    throw new Error(`${where}: managedIdentity requires productionIdentity "required".`);
  }
  for (const flag of ["disabled", "legacy"]) {
    if (raw[flag] !== undefined && typeof raw[flag] !== "boolean") throw new Error(`${where}.${flag}: expected a boolean.`);
  }
  if (raw.aliases !== undefined && !Array.isArray(raw.aliases)) throw new Error(`${where}.aliases: expected an array.`);
  const aliases = (raw.aliases ?? canonical?.aliases ?? []) as unknown[];
  if (aliases.length > 20) throw new Error(`${where}.aliases: maximum 20 aliases.`);
  return {
    id: raw.id, label, description: text(raw.description, `${where}.description`, 4000),
    shortLabel: raw.shortLabel === undefined ? label.slice(0, 20) : text(raw.shortLabel, `${where}.shortLabel`, 24),
    behavior: {
      productionIdentity: behavior.productionIdentity as AuthBehavior["productionIdentity"],
      audience: behavior.audience as boolean, constraints: behavior.constraints as boolean,
      anonymous: behavior.anonymous as boolean, managedIdentity: behavior.managedIdentity as boolean,
    },
    disabled: raw.disabled === true, legacy: raw.legacy === undefined ? canonical?.legacy ?? false : raw.legacy === true,
    aliases: aliases.map((alias, index) => text(alias, `${where}.aliases[${index}]`, 160)),
    ...(aiDesignGuidance ? { aiDesignGuidance } : {}),
  };
}

export const AUTH_TYPE_DEFS: readonly AuthTypeDef[] = Object.freeze(defaults.map((value, index) => {
  const def = parseDefinition(value, `Shipped authentication[${index}]`);
  Object.freeze(def.behavior);
  Object.freeze(def.aliases);
  if (def.aiDesignGuidance) {
    if (def.aiDesignGuidance.sources) Object.freeze(def.aiDesignGuidance.sources);
    Object.freeze(def.aiDesignGuidance);
  }
  return Object.freeze(def);
}));
// Import identity is not installed authority. These names preserve historical
// references; they contribute no authoring choices or behavior profiles.
export function isPackageAuthenticationId(id: string): boolean {
  return compatibilityIdentities.some(entry => entry.id === id);
}

export function legacyAuthenticationIdentity(value: string): AuthenticationType | undefined {
  const historical = compatibilityIdentities.find(entry =>
    [entry.id, ...entry.names].some(name => name.toLowerCase() === value.toLowerCase()));
  return historical && isAuthenticationType(historical.id) ? historical.id : undefined;
}

export function installedAuthentication(
  id: string, installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): AuthTypeDef | undefined {
  return installed.find(def => def.id === id);
}

export function isKnownInstalledAuthentication(
  id: string, installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): boolean {
  return !!installedAuthentication(id, installed) && (!!builtInAuthentication(id) || isPackageAuthenticationId(id));
}

export function unresolvedAuthenticationDefinition(id: AuthenticationType): AuthTypeDef {
  return {
    id, label: `${id} (unresolved)`, description: "Definition missing. Import its Authentication Library JSON or explicitly select a resolved method. Existing metadata is retained.",
    shortLabel: "Unresolved", behavior: { ...UNKNOWN_AUTH_BEHAVIOR },
    disabled: true, legacy: false, aliases: [], unresolved: true,
  };
}

export function sameAuthenticationContract(a: AuthTypeDef, b: AuthTypeDef): boolean {
  return a.id === b.id && a.legacy === b.legacy
    && JSON.stringify(a.behavior) === JSON.stringify(b.behavior)
    && JSON.stringify(a.aliases) === JSON.stringify(b.aliases);
}

export function authenticationUnavailableReason(
  definition: AuthTypeDef, installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): string | undefined {
  const canonical = installedAuthentication(definition.id, installed);
  if (isPackageAuthenticationId(definition.id) && !canonical) {
    return "Required authentication library is unavailable. Existing data is retained; this method cannot be selected for new calls.";
  }
  if (canonical && !sameAuthenticationContract(definition, canonical)) {
    return "Saved authentication behavior differs from the installed contract. Existing data is retained; explicitly adopt the installed definition before selecting this method.";
  }
  return undefined;
}

export function assertInstalledAuthenticationContracts(
  definitions: readonly AuthTypeDef[], installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): void {
  for (const definition of definitions) {
    const canonical = installedAuthentication(definition.id, installed);
    if (canonical && !sameAuthenticationContract(definition, canonical)) {
      throw new Error(`"${definition.id}": installed behavior, legacy status and aliases are protected. Edit Method, Description and AI design guidance only.`);
    }
  }
}

export function builtInAuthentication(id: string): AuthTypeDef | undefined {
  return AUTH_TYPE_DEFS.find(def => def.id === id);
}

export function sameAuthenticationDefinition(a: AuthTypeDef, b: AuthTypeDef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateDefinitions(value: unknown, portable: boolean, installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): AuthTypeDef[] {
  if (!Array.isArray(value) || value.length > 2000) {
    throw new Error("Authentication methods: expected an array of at most 2000 definitions.");
  }
  const result = value.map((entry: unknown, index) => {
    const where = `Authentication methods[${index}]`;
    const raw = object(entry, where);
    return parseDefinition(entry, where, typeof raw.id === "string"
      ? builtInAuthentication(raw.id) ?? (!portable ? installedAuthentication(raw.id, installed) : undefined)
      : undefined);
  });
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const def of result) {
    const id = def.id.toLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate authentication ID "${def.id}". No changes were applied.`);
    ids.add(id);
    const canonical = AUTH_TYPE_DEFS.find(entry => entry.id.toLowerCase() === id)
      ?? (!portable ? installed.find(entry => entry.id.toLowerCase() === id) : undefined);
    const historical = compatibilityIdentities.find(entry => entry.id.toLowerCase() === id);
    if (historical && (historical.id !== def.id || def.legacy
        || def.aliases.some(alias => !historical.names.includes(alias)))) {
      throw new Error(`"${def.id}": historical ID spelling and compatibility aliases are protected.`);
    }
    if (canonical && (!historical || !portable) && (def.id !== canonical.id
        || JSON.stringify(def.behavior) !== JSON.stringify(canonical.behavior)
        || def.legacy !== canonical.legacy
        || JSON.stringify(def.aliases) !== JSON.stringify(canonical.aliases))) {
      throw new Error(`"${def.id}": built-in ID, behavior, legacy status and aliases are protected. Edit Method, Description and AI design guidance only.`);
    }
    if (!canonical && !historical && (def.legacy || def.aliases.length)) {
      throw new Error(`"${def.id}": legacy status and aliases are reserved for shipped compatibility definitions.`);
    }
    for (const name of [def.id, def.label, ...def.aliases]) {
      const lower = name.toLowerCase();
      const owner = names.get(lower);
      if (owner && owner !== def.id) throw new Error(`Authentication name "${name}" is ambiguous (${owner}, ${def.id}).`);
      const reserved = AUTH_TYPE_DEFS.find(entry => entry.id !== def.id
        && [entry.id, entry.label, ...entry.aliases].some(v => v.toLowerCase() === lower));
      if (reserved) throw new Error(`Authentication name "${name}" belongs to built-in ${reserved.id}.`);
      const historicalOwner = compatibilityIdentities.find(entry => entry.id !== def.id
        && [entry.id, ...entry.names].some(value => value.toLowerCase() === lower));
      if (historicalOwner) throw new Error(`Authentication name "${name}" belongs to reserved identity ${historicalOwner.id}.`);
      names.set(lower, def.id);
    }
  }
  return result;
}

export function validateAuthenticationDefinitions(value: unknown, installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): AuthTypeDef[] {
  return validateDefinitions(value, false, installed);
}

export function validatePortableAuthenticationDefinitions(value: unknown): AuthTypeDef[] {
  return validateDefinitions(value, true);
}

export function parseAuthenticationCatalog(value: unknown, installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): AuthTypeDef[] {
  const raw = object(value, "Authentication catalog");
  keys(raw, ["format", "version", "methods"], "Authentication catalog");
  if (raw.format !== AUTHENTICATION_CATALOG_FORMAT || raw.version !== 1) {
    throw new Error(`Expected format "${AUTHENTICATION_CATALOG_FORMAT}", version 1.`);
  }
  return validateAuthenticationDefinitions(raw.methods, installed);
}

export function exportAuthenticationCatalog(methods: readonly AuthTypeDef[]): string {
  if (methods.some(method => method.unresolved !== undefined || method.unavailableReason !== undefined)) {
    throw new Error("Cannot export a runtime availability view. Export the stored Authentication Library or saved diagram definitions instead.");
  }
  return JSON.stringify({ format: AUTHENTICATION_CATALOG_FORMAT, version: 1, methods }, null, 2);
}

export function loadAuthenticationLibrary(defaults: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): { methods: AuthTypeDef[]; error: string | null } {
  try {
    const raw = window.localStorage.getItem(AUTHENTICATION_STORAGE_KEY);
    return {
      methods: raw ? mergeAuthenticationLibrary(defaults, parseAuthenticationCatalog(JSON.parse(raw), defaults), defaults) : [...defaults],
      error: null,
    };
  } catch (cause) {
    return { methods: [...defaults], error: `Authentication Library could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}. Stored data was not overwritten; export a backup before repairing browser storage.` };
  }
}

export function persistAuthenticationLibrary(
  methods: readonly AuthTypeDef[], expected?: readonly AuthTypeDef[], defaults: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): void {
  try {
    assertInstalledAuthenticationContracts(methods, defaults);
    if (expected) {
      const raw = window.localStorage.getItem(AUTHENTICATION_STORAGE_KEY);
      const stored = raw ? mergeAuthenticationLibrary(defaults, parseAuthenticationCatalog(JSON.parse(raw), defaults), defaults) : defaults;
      if (JSON.stringify(stored) !== JSON.stringify(expected)) {
        throw new Error("The library changed in another tab. Reload before editing or undoing a library change; the other tab's preferences were not overwritten.");
      }
    }
    window.localStorage.setItem(AUTHENTICATION_STORAGE_KEY, exportAuthenticationCatalog(methods));
  } catch (cause) {
    throw new Error(`Authentication Library was not saved to browser storage: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export function mergeAuthenticationLibrary(
  current: readonly AuthTypeDef[], imported: readonly AuthTypeDef[], installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): AuthTypeDef[] {
  const validated = validateAuthenticationDefinitions(imported, installed);
  const replacements = new Map(validated.map(def => [def.id, def]));
  return validateAuthenticationDefinitions([
    ...current.map(def => replacements.get(def.id) ?? def),
    ...validated.filter(def => !current.some(existing => existing.id === def.id)),
  ], installed);
}

export function authenticationReferences(doc: Pick<PsDocument, "edges" | "nodeTypes">): Set<AuthenticationType> {
  const ids = new Set<AuthenticationType>();
  for (const edge of doc.edges) for (const id of edge.authenticationTypes ?? []) ids.add(id);
  for (const type of doc.nodeTypes) {
    for (const rule of type.definition?.allowedAuthMethods ?? []) {
      if (rule.id !== "*") ids.add(rule.id);
    }
  }
  return ids;
}

export function authenticationCatalogFor(
  doc: Pick<PsDocument, "authenticationDefinitions" | "edges" | "nodeTypes">,
  library: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
  installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): AuthTypeDef[] {
  const result = new Map(library.map(def => [def.id, def]));
  const savedIds = new Set((doc.authenticationDefinitions ?? []).map(def => def.id));
  for (const def of doc.authenticationDefinitions ?? []) result.set(def.id, def);
  for (const id of authenticationReferences(doc)) {
    if (!savedIds.has(id) && !installedAuthentication(id, installed)) result.set(id, unresolvedAuthenticationDefinition(id));
  }
  return [...result.values()].map(definition => {
    const unavailableReason = authenticationUnavailableReason(definition, installed);
    return unavailableReason ? { ...definition, unavailableReason } : definition;
  });
}

export function withAuthenticationDefinitions(doc: PsDocument, catalog: readonly AuthTypeDef[]): PsDocument {
  const definitions = new Map((doc.authenticationDefinitions ?? []).map(def => [def.id, def]));
  for (const id of authenticationReferences(doc)) {
    const def = catalog.find(entry => entry.id === id);
    if (def && !def.unresolved && !def.unavailableReason && !definitions.has(id)) definitions.set(id, def);
  }
  return { ...doc, authenticationDefinitions: [...definitions.values()] };
}

export function withAuthenticationGuidance(
  doc: PsDocument, catalog: readonly AuthTypeDef[], id: string, value: AiDesignGuidance | undefined,
): PsDocument {
  const guidance = validateAiDesignGuidance(value);
  const definition = doc.authenticationDefinitions?.find(method => method.id === id)
    ?? catalog.find(method => method.id === id);
  if (!definition || definition.unresolved) {
    throw new Error("Resolve this authentication method before editing its guidance. Existing flow values are preserved.");
  }
  if (JSON.stringify(definition.aiDesignGuidance) === JSON.stringify(guidance)) return doc;
  const { unresolved, unavailableReason, aiDesignGuidance, ...stored } = definition;
  const next = { ...stored, ...(guidance ? { aiDesignGuidance: guidance } : {}) };
  return {
    ...doc,
    authenticationDefinitions: doc.authenticationDefinitions?.some(method => method.id === id)
      ? doc.authenticationDefinitions.map(method => method.id === id ? next : method)
      : [...(doc.authenticationDefinitions ?? []), next],
  };
}

interface AuthenticationItemLabel {
  id: string;
  label: string;
}

export interface AuthenticationCompatibilityFlow {
  id: string;
  title: string;
  source: AuthenticationItemLabel;
  target: AuthenticationItemLabel;
  scenarios: readonly AuthenticationItemLabel[];
}

export interface AuthenticationCompatibilityPolicy extends AuthenticationItemLabel {
  statuses: readonly AllowedAuthMethodStatus[];
}

export interface AuthenticationCompatibilityMethod extends AuthenticationItemLabel {
  flows: readonly AuthenticationCompatibilityFlow[];
  nodeTypePolicies: readonly AuthenticationCompatibilityPolicy[];
}

export interface AuthenticationCompatibility {
  minimumVersion: "0.1.5" | "0.1.11";
  methods: readonly AuthenticationCompatibilityMethod[];
  counts: { methods: number; flows: number; nodeTypePolicies: number };
}

export type AuthenticationVersionStatus = "compatible" | "older" | "unknown";

export function authenticationVersionStatus(runningVersion: unknown, minimumVersion: string): AuthenticationVersionStatus {
  const parse = (value: unknown) => {
    if (typeof value !== "string") return null;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    if (!match || match[0] !== value) return null;
    const prerelease = match[4]?.split(".") ?? [];
    if (prerelease.some(part => /^0\d+$/.test(part))) return null;
    return { core: match.slice(1, 4).map(part => BigInt(part)), prerelease };
  };
  const running = parse(runningVersion);
  const minimum = parse(minimumVersion);
  if (!running || !minimum) return "unknown";
  for (let index = 0; index < 3; index++) {
    if (running.core[index] !== minimum.core[index]) {
      return running.core[index] < minimum.core[index] ? "older" : "compatible";
    }
  }
  if (!running.prerelease.length) return "compatible";
  if (!minimum.prerelease.length) return "older";
  for (let index = 0; index < Math.max(running.prerelease.length, minimum.prerelease.length); index++) {
    const a = running.prerelease[index];
    const b = minimum.prerelease[index];
    if (a === b) continue;
    if (a === undefined) return "older";
    if (b === undefined) return "compatible";
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    const older = aNumeric && bNumeric ? BigInt(a) < BigInt(b)
      : aNumeric !== bNumeric ? aNumeric : a < b;
    return older ? "older" : "compatible";
  }
  return "compatible";
}

export function authenticationCompatibilityFor(
  doc: PsDocument,
  library: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): AuthenticationCompatibility | null {
  const ids = [...authenticationReferences(doc)].filter(id => !LEGACY_AUTHENTICATION_IDS.has(id)).sort();
  if (!ids.length) return null;
  const minimumVersion = ids.includes("InternalProcessCall")
    ? "0.1.11"
    : "0.1.5";
  const catalog = new Map(authenticationCatalogFor(doc, library).map(def => [def.id, def]));
  const nodes = new Map(doc.nodes.map(node => [node.id, node]));
  const scenariosByFlow = new Map<string, Map<string, AuthenticationItemLabel>>();
  for (const scenario of doc.scenarios) {
    for (const id of scenario.edgeIds) {
      const scenarios = scenariosByFlow.get(id) ?? new Map<string, AuthenticationItemLabel>();
      scenarios.set(scenario.id, { id: scenario.id, label: scenario.name?.trim() || scenario.id });
      scenariosByFlow.set(id, scenarios);
    }
  }
  const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const flowsByMethod = new Map(ids.map(id => [id, new Map<string, AuthenticationCompatibilityFlow>()]));
  const policiesByMethod = new Map(ids.map(id => [id, new Map<string, AuthenticationCompatibilityPolicy>()]));
  const flowIds = new Set<string>();
  const policyIds = new Set<string>();
  for (const edge of doc.edges) {
    for (const id of new Set(edge.authenticationTypes ?? [])) {
      const flows = flowsByMethod.get(id);
      if (!flows) continue;
      flows.set(edge.id, {
        id: edge.id, title: edge.title?.trim() || edge.id,
        source: { id: edge.source, label: nodes.get(edge.source)?.title?.trim() || edge.source },
        target: { id: edge.target, label: nodes.get(edge.target)?.title?.trim() || edge.target },
        scenarios: [...(scenariosByFlow.get(edge.id)?.values() ?? [])].sort(byId),
      });
      flowIds.add(edge.id);
    }
  }
  for (const type of doc.nodeTypes) {
    for (const rule of type.definition?.allowedAuthMethods ?? []) {
      if (rule.id === "*") continue;
      const policies = policiesByMethod.get(rule.id);
      if (!policies) continue;
      const statuses = new Set(policies.get(type.id)?.statuses ?? []);
      statuses.add(rule.status);
      policies.set(type.id, { id: type.id, label: type.label?.trim() || type.id, statuses: [...statuses].sort() });
      policyIds.add(type.id);
    }
  }
  return {
    minimumVersion,
    counts: { methods: ids.length, flows: flowIds.size, nodeTypePolicies: policyIds.size },
    methods: ids.map(id => ({
      id, label: catalog.get(id)?.label?.trim() || id,
      flows: [...(flowsByMethod.get(id)?.values() ?? [])].sort(byId),
      nodeTypePolicies: [...(policiesByMethod.get(id)?.values() ?? [])].sort(byId),
    })),
  };
}

export function authenticationWarnings(
  doc: PsDocument, library: readonly AuthTypeDef[], installed: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): string[] {
  const saved = new Map((doc.authenticationDefinitions ?? []).map(def => [def.id, def]));
  const messages: string[] = [];
  const reviewIds = authenticationReferences(doc);
  for (const definition of saved.values()) {
    if (authenticationUnavailableReason(definition, installed)) reviewIds.add(definition.id);
  }
  for (const id of reviewIds) {
    const definition = saved.get(id);
    const local = library.find(def => def.id === id);
    const resolved = definition ?? local;
    const unavailable = resolved ? authenticationUnavailableReason(resolved, installed)
      : isPackageAuthenticationId(id) && !installedAuthentication(id, installed)
        ? "Required authentication library is unavailable; existing references are retained." : undefined;
    if (unavailable) messages.push(`${id}: ${unavailable}`);
    else if (!definition && !installedAuthentication(id, installed)) messages.push(`${id}: definition missing; existing values are preserved. Import a definition, then explicitly use it in this diagram.`);
    else if (definition && local && !sameAuthenticationDefinition(definition, local)) {
      messages.push(`${id}: saved definition differs from your library. The diagram keeps its saved definition until you explicitly use the library definition.`);
    } else if (definition && !local) messages.push(`${id}: available from this diagram only. Import its catalog JSON to reuse it in other diagrams.`);
  }
  return messages;
}

export function normalizeAuthenticationValue(value: unknown, definitions: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): AuthenticationType | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const exact = definitions.find(def => def.id === value);
  if (exact) return exact.id;
  const named = [...definitions, ...AUTH_TYPE_DEFS].find(def =>
    [def.label, ...def.aliases].some(name => name.toLowerCase() === value.toLowerCase()));
  if (named) return named.id;
  const historical = legacyAuthenticationIdentity(value);
  if (historical) return historical;
  if (isAuthenticationType(value)) return value;
  throw new Error(`Authentication reference "${value}" is not a valid ID or recognized legacy label. Correct the file without removing its authentication data.`);
}

export const AUTH_TYPES: readonly AuthenticationType[] = AUTH_TYPE_DEFS.map(def => def.id);
export const AUTH_TYPE_LABELS = Object.fromEntries(AUTH_TYPE_DEFS.map(def => [def.id, def.label]));
export const AUTH_TYPE_SHORT_LABELS = Object.fromEntries(AUTH_TYPE_DEFS.map(def => [def.id, def.shortLabel]));
export const AUTH_TYPE_DESCRIPTIONS = Object.fromEntries(AUTH_TYPE_DEFS.map(def => [def.id, def.description]));
export function authTypeLabel(id: string, catalog: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): string {
  return catalog.find(def => def.id === id)?.label ?? `${id} (unresolved)`;
}
export function authTypeShortLabel(id: string, catalog: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): string {
  return catalog.find(def => def.id === id)?.shortLabel ?? "Unresolved";
}
export function authTypeDescription(id: string, catalog: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): string | undefined {
  return catalog.find(def => def.id === id)?.description;
}
export function authBehavior(id: string, catalog: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): Readonly<AuthBehavior> {
  const definition = catalog.find(def => def.id === id);
  return definition && !definition.unavailableReason && !definition.unresolved ? definition.behavior : UNKNOWN_AUTH_BEHAVIOR;
}
export const AUTH_TYPES_REQUIRING_APPLICATION_ID: ReadonlySet<string> =
  new Set(AUTH_TYPE_DEFS.filter(def =>
    def.behavior.productionIdentity === "required" && !def.behavior.managedIdentity
  ).map(def => def.id));
export const AUTH_TYPES_REQUIRING_PRODUCTION_IDENTITY = AUTH_TYPES_REQUIRING_APPLICATION_ID;
export function edgeRequiresApplicationId(types: readonly string[] | undefined, catalog: readonly AuthTypeDef[] = AUTH_TYPE_DEFS): boolean {
  return !!types?.some(id => {
    const behavior = authBehavior(id, catalog);
    return behavior.productionIdentity === "required" && !behavior.managedIdentity;
  });
}
export const edgeRequiresProductionIdentity = edgeRequiresApplicationId;
