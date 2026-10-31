export type NodeType = string; // free-form, but suggested values come from a list

import type { AuthenticationType, AuthTypeDef } from "./authentication";
import type { ProtocolId, ProtocolTypeDef } from "./protocols";
import type { MetadataField } from "./libraries/contracts";
import productionIdentityTenants from "./data/productionIdentityTenants.json";
import deviationTypes from "./data/deviationTypes.json";
export * from "./authentication";

declare const catalogReferenceId: unique symbol;
export type CatalogReferenceId = string & { readonly [catalogReferenceId]: true };

export const CATALOG_DEFINITION_KINDS = [
  "classification", "tenant", "privacyBoundary", "securityBoundary", "deviation",
] as const;
export type CatalogDefinitionKind = (typeof CATALOG_DEFINITION_KINDS)[number];
export interface CatalogDefinitionSnapshot {
  kind: CatalogDefinitionKind;
  id: string;
  label: string;
  description?: string;
  library?: { id: string; version: string };
}

const reservedCatalogIds = new Set(
  ["__proto__", "prototype", "*", ...Object.getOwnPropertyNames(Object.prototype)]
    .map((id) => id.toLowerCase()),
);

// Catalog membership is not validation: an unavailable definition must not
// destroy a structurally valid saved reference.
export function isCatalogReferenceId(value: unknown): value is CatalogReferenceId {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f<>]/.test(value)
    && !reservedCatalogIds.has(value.toLowerCase());
}

export function catalogReferenceLabel(
  id: string,
  definitions: readonly { id: string; label: string }[],
): string {
  return definitions.find((definition) => definition.id === id)?.label
    ?? `${id} (unresolved)`;
}

// Core authoring choices; deployment-selected packages can supply more.
export interface ProductionIdentityTenantDef {
  id: string;
  label: string;
}
export const PRODUCTION_IDENTITY_TENANT_DEFS: readonly ProductionIdentityTenantDef[] = productionIdentityTenants;
export type ProductionIdentityTenant =
  (typeof PRODUCTION_IDENTITY_TENANT_DEFS)[number]["id"];
export const PRODUCTION_IDENTITY_TENANT_LABELS: Record<string, string> =
  Object.fromEntries(
    PRODUCTION_IDENTITY_TENANT_DEFS.map((t) => [t.id, t.label])
  );
export function productionIdentityTenantLabel(id: string, saved?: readonly CatalogDefinitionSnapshot[]): string {
  return catalogReferenceLabel(id, catalogDefinitionsFor("tenant", saved));
}

export function productionIdentityTenantChoices(
  saved?: readonly CatalogDefinitionSnapshot[], available?: readonly CatalogDefinitionSnapshot[],
): CatalogDefinitionSnapshot[] {
  return catalogDefinitionChoices("tenant", saved, available);
}

// Discriminated union representing the production identity an edge uses to
// issue its call. AppId carries a GUID + a tenant; ManagedIdentity carries a
// resource name. Both raw values are stored as the user typed them; the
// IssueManager surfaces validation problems.
export type ProductionIdentity =
  | {
      kind: "AppId";
      appId: string;
      tenant: ProductionIdentityTenant;
    }
  | {
      kind: "ManagedIdentity";
    };

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isGuid(s: string): boolean {
  return GUID_RE.test(s.trim());
}

export function formatProductionIdentity(pi: ProductionIdentity, saved?: readonly CatalogDefinitionSnapshot[]): string {
  if (pi.kind === "AppId") {
    const id = pi.appId.trim() || "(no app id)";
    return `App ID ${id} (${productionIdentityTenantLabel(pi.tenant, saved)})`;
  }
  return "Managed Identity";
}

// Canonical comparison key for diff. Whitespace-only fields collapse to
// empty so visually-identical values don't show up as changes.
export function canonicalProductionIdentity(
  pi: ProductionIdentity | undefined
): string {
  if (!pi) return "";
  if (pi.kind === "AppId") {
    return `AppId|${pi.appId.trim().toLowerCase()}|${pi.tenant}`;
  }
  return "ManagedIdentity";
}

import dataClassificationsData from "./data/dataClassifications.json";

export interface DataClassificationDef {
  // Stable identifier; this is what gets persisted on a PsData item.
  id: string;
  // Human-readable description rendered in the UI.
  label: string;
  // Optional long-form description shown in hover tooltips. May contain
  // [text](url) markdown-style or bare https?:// links.
  description?: string;
}

// Shipped defaults only. Authoring uses the active Classification Library;
// data items retain IDs and saved document definitions remain authoritative.
export const DATA_CLASSIFICATION_DEFS: readonly DataClassificationDef[] =
  dataClassificationsData as readonly DataClassificationDef[];

// Known choices are offered for authoring; validated saved references may
// belong to a catalog that is not installed in this build.
export type DataClassification =
  | "EUII"
  | "EUPI"
  | "Customer Content"
  | "OII"
  | "System Metadata"
  | "Feedback Data"
  | "Access Control Data"
  | "Support Data"
  | "Account Data"
  | "Administrator Data"
  | "Customer Data"
  | "Other"
  | CatalogReferenceId;

export const DATA_CLASSIFICATIONS: readonly DataClassification[] =
  DATA_CLASSIFICATION_DEFS.map((c) => c.id as DataClassification);

export const DATA_CLASSIFICATION_LABELS: Record<DataClassification, string> =
  Object.fromEntries(
    DATA_CLASSIFICATION_DEFS.map((c) => [c.id, c.label])
  ) as Record<DataClassification, string>;

export const DATA_CLASSIFICATION_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    DATA_CLASSIFICATION_DEFS.filter((c) => c.description).map((c) => [
      c.id,
      c.description!,
    ])
  );

export function dataClassificationLabel(
  id: DataClassification | string,
  saved?: readonly CatalogDefinitionSnapshot[],
  available?: readonly CatalogDefinitionSnapshot[],
): string {
  return catalogReferenceLabel(id, catalogDefinitionsFor("classification", saved, available));
}

export function dataClassificationDescription(
  id: DataClassification | string,
  saved?: readonly CatalogDefinitionSnapshot[],
  available?: readonly CatalogDefinitionSnapshot[],
): string | undefined {
  return catalogDefinitionsFor("classification", saved, available).find((def) => def.id === id)?.description;
}

// How a node handles a piece of data while it's there. The empty string is a
// deliberate "(blank / unspecified)" option and is *not* listed in the JSON
// file — the JSON enumerates only the real retention choices. The unset
// sentinel is added separately so the analyzer can detect "missing retention".
import retentionTypesData from "./data/retentionTypes.json";

export interface RetentionTypeDef {
  // Stable identifier; this is what gets persisted on node data attachments.
  id: string;
  // Human-readable description rendered in the UI.
  label: string;
  // Optional long-form description shown in hover tooltips. May contain
  // [text](url) markdown-style or bare https?:// links.
  description?: string;
}

// The JSON file in src/data/retentionTypes.json is the single source of truth
// for the set of available retention types.
export const RETENTION_TYPE_DEFS: readonly RetentionTypeDef[] =
  retentionTypesData as readonly RetentionTypeDef[];

// Literal union must stay in sync with the ids in retentionTypes.json plus the
// "" sentinel that represents "unset".
export type Retention =
  | ""
  | "ProcessingNoStorage"
  | "StorageUnder48Hours"
  | "StorageOver48Hours";

// Includes the "" sentinel first so dropdowns naturally start with it.
export const RETENTION_TYPES: readonly Retention[] = [
  "",
  ...RETENTION_TYPE_DEFS.map((r) => r.id as Retention),
];

export const RETENTION_LABELS: Record<Retention, string> = {
  "": "",
  ...(Object.fromEntries(
    RETENTION_TYPE_DEFS.map((r) => [r.id, r.label])
  ) as Record<Exclude<Retention, "">, string>),
};

export const RETENTION_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    RETENTION_TYPE_DEFS.filter((r) => r.description).map((r) => [
      r.id,
      r.description!,
    ])
  );

export function retentionLabel(id: Retention | string): string {
  return RETENTION_LABELS[id as Retention] ?? id;
}

export function retentionDescription(id: Retention | string): string | undefined {
  return RETENTION_DESCRIPTIONS[id];
}

// ---------- Node type catalog ----------
//
// The JSON file in src/data/nodeTypes.json is the source of truth for the
// catalog of "known" node types and the metadata that auto-populates a node
// when its type is set. Users can still type free-form types from the UI;
// only those whose id matches a NodeTypeDef get auto-populated and locked.

import nodeTypesData from "./data/nodeTypes.json";
import microsoftCloudNodeTypesData from "./data/microsoftCloudNodeTypes.json";
import genericNodeTypesData from "./data/genericNodeTypes.json";

export type AllowedAuthMethodStatus = "Allowed" | "Deprecated";
export type AllowedDataAction = "Allow" | "Deny";

export interface AllowedAuthMethod {
  // Auth method id from authTypes.json, or "*" to match any method not
  // listed by an explicit (id !== "*") entry. The explicit entry's status
  // wins when both are present.
  id: AuthenticationType | "*";
  status: AllowedAuthMethodStatus;
}

export interface AllowedDataType {
  // Data classification id from dataClassifications.json, or "*" for the
  // default rule. Exactly one "*"/"*" entry is required per node type and is
  // treated as the fallback.
  id: DataClassification | "*";
  // Retention id from retentionTypes.json, or "*" for "any retention".
  retention: Retention | "*";
  action: AllowedDataAction;
}

export type DfdRole = "Process" | "DataStore" | "ExternalInteractor";
export interface InvalidDfdValue { invalid: string; truncated?: true }
export type DfdValue = string | InvalidDfdValue;

export interface NodeTypeDef {
  id: NodeType;
  aiDesignGuidance?: import("../shared/aiDesignGuidance").AiDesignGuidance;
  defaultDfdRole?: DfdValue;
  // User-facing label shown in dropdowns. May be the same as id for legacy
  // entries, but distinct from id so labels can be edited without breaking
  // references on existing nodes.
  label: string;
  serviceTreeId: string;
  endpointRegex: string;
  templateHints?: string[];
  allowedAuthMethods: AllowedAuthMethod[];
  allowedDataTypes: AllowedDataType[];
  // Microsoft-cloud catalog entries provide discoverability and endpoint
  // metadata without asserting service-specific policy. Curated entries omit
  // this field and retain their explicit auth/data rules.
  policyStatus?: "Unspecified";
  category?: string;
  catalogSource?: string;
  resourceProviders?: string[];
  documentationUrl?: string;
  // Relative key resolved by nodeTypeIcons.ts. The SVG itself is an imported
  // build asset so standalone HTML exports remain self-contained.
  icon?: string;
  // Default privacy boundary this node type belongs in. Id refers to a
  // PrivacyBoundaryTypeDef. Optional — types without an intrinsic privacy
  // stance may leave it undefined.
  defaultPrivacyBoundary?: string;
  // Geo-residency behavior for the node type. Some variants (e.g.
  // DataKeptInGeoUnlessIndicatedByCaller) are deferred to the per-scenario
  // instance and must be re-specified there.
  geoBoundary?: GeoBoundarySetting;
  // How data is retained after the customer subscription ends. Some variants
  // (e.g. ControlledByCallingService) are deferred to the per-scenario
  // instance.
  postSubscriptionRetention?: PostSubscriptionRetention;
  // How the node handles GDPR export/delete obligations.
  gdprHandling?: GdprHandling;
  // Optional long-form description shown in hover tooltips. May contain
  // [text](url) markdown-style or bare https?:// links.
  description?: string;
}

export type NodeTypeDefinition = Omit<NodeTypeDef, "id" | "label">;

// User-extendable entry stored on PsDocument.nodeTypes. Static catalog entries
// normally carry only id/label. `definition` is a document-local custom type or
// override and therefore travels through JSON, autosave, standalone HTML, and
// collaboration with the document.
export interface NodeTypeRef {
  id: NodeType;
  label: string;
  definition?: NodeTypeDefinition;
}

export function emptyNodeTypeDefinition(): NodeTypeDefinition {
  return {
    defaultDfdRole: "Process",
    serviceTreeId: "",
    endpointRegex: "^$",
    templateHints: [],
    allowedAuthMethods: [],
    allowedDataTypes: [],
    policyStatus: "Unspecified",
    category: "Custom",
    catalogSource: "Document",
    icon: "generic/component.svg",
    description: "",
  };
}

interface MicrosoftCloudNodeTypeCatalogEntry {
  id: string;
  aiDesignGuidance?: NodeTypeDef["aiDesignGuidance"];
  defaultDfdRole?: DfdRole;
  label: string;
  category: string;
  catalogSource: string;
  icon: string;
  endpointRegex?: string;
  templateHints?: string[];
  resourceProviders?: string[];
  documentationUrl?: string;
  description?: string;
}

const curatedNodeTypeDefs: NodeTypeDef[] = (
  nodeTypesData as readonly NodeTypeDef[]
).map((def) => ({ ...def }));
const curatedNodeTypeIds = new Set(curatedNodeTypeDefs.map((def) => def.id));
// Vendor-neutral Generic entries and Microsoft cloud entries share the same
// neutral (policyStatus: Unspecified) shape.
const microsoftCloudNodeTypeDefs: NodeTypeDef[] = [
  ...(genericNodeTypesData as readonly MicrosoftCloudNodeTypeCatalogEntry[]),
  ...(microsoftCloudNodeTypesData as readonly MicrosoftCloudNodeTypeCatalogEntry[]),
]
  .filter((entry) => !curatedNodeTypeIds.has(entry.id))
  .map((entry) => ({
    ...entry,
    serviceTreeId: "",
    endpointRegex: entry.endpointRegex ?? "^$",
    templateHints: entry.templateHints ?? [],
    resourceProviders: entry.resourceProviders ?? [],
    allowedAuthMethods: [],
    allowedDataTypes: [],
    policyStatus: "Unspecified",
  }));

export const NODE_TYPE_DEFS: readonly NodeTypeDef[] = Object.freeze([
  ...curatedNodeTypeDefs,
  ...microsoftCloudNodeTypeDefs,
]);

export const NODE_TYPE_DEF_MAP: Readonly<Record<string, NodeTypeDef>> =
  Object.freeze(
    Object.fromEntries(NODE_TYPE_DEFS.map((d) => [d.id, d]))
  );

export const NODE_TYPE_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    NODE_TYPE_DEFS.filter((d) => d.description).map((d) => [
      d.id,
      d.description!,
    ])
  );

export function resolveNodeTypeDef(
  id: string,
  docNodeTypes?: readonly NodeTypeRef[],
): NodeTypeDef | undefined {
  const documentRef = docNodeTypes?.find((type) => type.id === id);
  if (documentRef?.definition) {
    return {
      id: documentRef.id,
      label: documentRef.label,
      ...documentRef.definition,
    };
  }
  return NODE_TYPE_DEF_MAP[id];
}

export function nodeTypeDescription(
  id: string,
  docNodeTypes?: readonly NodeTypeRef[],
): string | undefined {
  return resolveNodeTypeDef(id, docNodeTypes)?.description;
}

// Seeded into emptyDocument().nodeTypes. The user can extend this list at
// runtime via addNodeType, but only entries with a matching NodeTypeDef get
// the auto-fill / lock treatment in NodeDetails.
export const DEFAULT_NODE_TYPES: NodeTypeRef[] = NODE_TYPE_DEFS.map((d) => ({
  id: d.id,
  label: d.label,
}));

// Resolve a node-type id to its display label. Catalog entries win first,
// then the document's own nodeTypes list, then a fallback to the id itself
// (so unmigrated docs or unknown ids still render something readable).
export function nodeTypeLabel(
  id: string,
  docNodeTypes?: readonly NodeTypeRef[]
): string {
  const documentRef = docNodeTypes?.find((t) => t.id === id);
  if (documentRef?.definition) return documentRef.label;
  const def = NODE_TYPE_DEF_MAP[id];
  if (def) return def.label;
  if (documentRef) return documentRef.label;
  return id;
}

export type BoundaryType = "security" | "privacy";

// Edges carry data attached separately for the request (source → target)
// and response (target → source) directions. Each direction has its own
// per-scenario bucket in Scenario.edgeRequestData / edgeResponseData.
export type EdgeDataDirection = "request" | "response";

// ---------- Privacy boundary type catalog ----------
//
// Enumerates the core kinds of privacy boundaries a user can draw. The set lives in
// src/data/privacyBoundaryTypes.json so it can be extended without code
// changes. This is orthogonal to BoundaryType ("security" | "privacy") which
// describes the boundary's *purpose*; PrivacyBoundaryTypeDef catalogs the
// finer-grained subtypes within the privacy family.

import privacyBoundaryTypesData from "./data/privacyBoundaryTypes.json";

export interface PrivacyBoundaryTypeDef {
  // Stable identifier; this is what would get persisted on a boundary if it
  // adopts a privacy subtype.
  id: string;
  // Human-readable description rendered in the UI.
  label: string;
  // Optional long-form description shown in hover tooltips.
  description?: string;
}

export const PRIVACY_BOUNDARY_TYPE_DEFS: readonly PrivacyBoundaryTypeDef[] =
  privacyBoundaryTypesData as readonly PrivacyBoundaryTypeDef[];

export const PRIVACY_BOUNDARY_TYPE_LABELS: Record<string, string> =
  Object.fromEntries(
    PRIVACY_BOUNDARY_TYPE_DEFS.map((b) => [b.id, b.label])
  );

export const PRIVACY_BOUNDARY_TYPE_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    PRIVACY_BOUNDARY_TYPE_DEFS.filter((b) => b.description).map((b) => [
      b.id,
      b.description!,
    ])
  );

export function privacyBoundaryTypeLabel(id: string, saved?: readonly CatalogDefinitionSnapshot[], available?: readonly CatalogDefinitionSnapshot[]): string {
  return catalogReferenceLabel(id, catalogDefinitionsFor("privacyBoundary", saved, available));
}

export function privacyBoundaryTypeDescription(id: string, saved?: readonly CatalogDefinitionSnapshot[], available?: readonly CatalogDefinitionSnapshot[]): string | undefined {
  return catalogDefinitionsFor("privacyBoundary", saved, available).find((def) => def.id === id)?.description;
}

// ---------- Security boundary subtype catalog ----------
//
// Mirrors PRIVACY_BOUNDARY_TYPE_DEFS but for security boundaries (IFrame,
// CSP, Azure, etc.). Source of truth lives in
// src/data/securityBoundaryTypes.json.

import securityBoundaryTypesData from "./data/securityBoundaryTypes.json";

export interface SecurityBoundaryTypeDef {
  id: string;
  label: string;
  description?: string;
}

export const SECURITY_BOUNDARY_TYPE_DEFS: readonly SecurityBoundaryTypeDef[] =
  securityBoundaryTypesData as readonly SecurityBoundaryTypeDef[];

export const SECURITY_BOUNDARY_TYPE_LABELS: Record<string, string> =
  Object.fromEntries(
    SECURITY_BOUNDARY_TYPE_DEFS.map((b) => [b.id, b.label])
  );

export const SECURITY_BOUNDARY_TYPE_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    SECURITY_BOUNDARY_TYPE_DEFS.filter((b) => b.description).map((b) => [
      b.id,
      b.description!,
    ])
  );

export function securityBoundaryTypeLabel(id: string, saved?: readonly CatalogDefinitionSnapshot[], available?: readonly CatalogDefinitionSnapshot[]): string {
  return catalogReferenceLabel(id, catalogDefinitionsFor("securityBoundary", saved, available));
}

export function securityBoundaryTypeDescription(
  id: string,
  saved?: readonly CatalogDefinitionSnapshot[],
  available?: readonly CatalogDefinitionSnapshot[],
): string | undefined {
  return catalogDefinitionsFor("securityBoundary", saved, available).find((def) => def.id === id)?.description;
}

// ---------- Geo-boundary setting catalog ----------
//
// Describes how a node type treats data with respect to geo residency. Lives
// in src/data/geoBoundarySettings.json so the catalog can be extended without
// code changes. The `instanceMustSpecify` flag marks options where the type
// itself doesn't pin a concrete behavior — the per-scenario instance is
// expected to supply one. `requiresDescription` marks options that need a
// free-form description (e.g. "controls X are exposed to customer").

import geoBoundarySettingsData from "./data/geoBoundarySettings.json";

export interface GeoBoundarySettingDef {
  id: string;
  label: string;
  instanceMustSpecify?: boolean;
  requiresDescription?: boolean;
  description?: string;
}

export const GEO_BOUNDARY_SETTING_DEFS: readonly GeoBoundarySettingDef[] =
  geoBoundarySettingsData as readonly GeoBoundarySettingDef[];

export const GEO_BOUNDARY_SETTING_LABELS: Record<string, string> =
  Object.fromEntries(
    GEO_BOUNDARY_SETTING_DEFS.map((d) => [d.id, d.label])
  );

export const GEO_BOUNDARY_SETTING_DEF_MAP: Readonly<
  Record<string, GeoBoundarySettingDef>
> = Object.freeze(
  Object.fromEntries(GEO_BOUNDARY_SETTING_DEFS.map((d) => [d.id, d]))
);

export const GEO_BOUNDARY_SETTING_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    GEO_BOUNDARY_SETTING_DEFS.filter((d) => d.description).map((d) => [
      d.id,
      d.description!,
    ])
  );

export function geoBoundarySettingLabel(id: string): string {
  return GEO_BOUNDARY_SETTING_LABELS[id] ?? id;
}

export function geoBoundarySettingDescription(id: string): string | undefined {
  return GEO_BOUNDARY_SETTING_DESCRIPTIONS[id];
}

// Discriminated union of stored values on a NodeTypeDef (and, eventually, a
// per-instance override on a node). Mirrors the catalog ids but carries any
// extra parameters each variant requires.
export type GeoBoundarySetting =
  | { id: "DataKeptInGeo"; description?: string }
  | { id: "DataKeptInGeoUnlessIndicatedByCaller"; description?: string }
  | { id: "DataKeptInGeoUnlessCustomerAllowsXGeo"; description: string }
  | { id: "DataNotKeptInGeo"; description?: string };

// ---------- Post-subscription retention catalog ----------
//
// Describes how a node retains data after the customer subscription ends.

import postSubscriptionRetentionsData from "./data/postSubscriptionRetentions.json";

export interface PostSubscriptionRetentionDef {
  id: string;
  label: string;
  instanceMustSpecify?: boolean;
  requiresDayRange?: boolean;
  description?: string;
}

export const POST_SUBSCRIPTION_RETENTION_DEFS: readonly PostSubscriptionRetentionDef[] =
  postSubscriptionRetentionsData as readonly PostSubscriptionRetentionDef[];

export const POST_SUBSCRIPTION_RETENTION_LABELS: Record<string, string> =
  Object.fromEntries(
    POST_SUBSCRIPTION_RETENTION_DEFS.map((d) => [d.id, d.label])
  );

export const POST_SUBSCRIPTION_RETENTION_DEF_MAP: Readonly<
  Record<string, PostSubscriptionRetentionDef>
> = Object.freeze(
  Object.fromEntries(
    POST_SUBSCRIPTION_RETENTION_DEFS.map((d) => [d.id, d])
  )
);

export const POST_SUBSCRIPTION_RETENTION_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    POST_SUBSCRIPTION_RETENTION_DEFS.filter((d) => d.description).map((d) => [
      d.id,
      d.description!,
    ])
  );

export function postSubscriptionRetentionLabel(id: string): string {
  return POST_SUBSCRIPTION_RETENTION_LABELS[id] ?? id;
}

export function postSubscriptionRetentionDescription(
  id: string
): string | undefined {
  return POST_SUBSCRIPTION_RETENTION_DESCRIPTIONS[id];
}

export type PostSubscriptionRetention =
  | { id: "RetainedDaysRange"; minDays: number; maxDays: number }
  | { id: "ControlledByCallingService" };

// ---------- GDPR-handling catalog ----------

import gdprHandlingsData from "./data/gdprHandlings.json";

export interface GdprHandlingDef {
  id: string;
  label: string;
  description?: string;
}

export const GDPR_HANDLING_DEFS: readonly GdprHandlingDef[] =
  gdprHandlingsData as readonly GdprHandlingDef[];

export const GDPR_HANDLING_LABELS: Record<string, string> =
  Object.fromEntries(GDPR_HANDLING_DEFS.map((d) => [d.id, d.label]));

export const GDPR_HANDLING_DEF_MAP: Readonly<
  Record<string, GdprHandlingDef>
> = Object.freeze(
  Object.fromEntries(GDPR_HANDLING_DEFS.map((d) => [d.id, d]))
);

export const GDPR_HANDLING_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(
    GDPR_HANDLING_DEFS.filter((d) => d.description).map((d) => [
      d.id,
      d.description!,
    ])
  );

export function gdprHandlingLabel(id: string): string {
  return GDPR_HANDLING_LABELS[id] ?? id;
}

export function gdprHandlingDescription(id: string): string | undefined {
  return GDPR_HANDLING_DESCRIPTIONS[id];
}

export type GdprHandling =
  | { id: "NodeHandlesGdpr" }
  | { id: "NotInGDPRScope" }
  | { id: "CallingServiceResponsible" }
  | { id: "Unknown" };

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PsNode {
  id: string;
  dfdRoleOverride?: DfdValue;
  // Pinned before catalog hydration. False marks an authored adoption of defaults.
  dfdRoleLegacy?: boolean;
  metadata?: Record<string, string>;
  metadataFields?: MetadataField[];
  title: string;
  description: string;
  type: NodeType;
  serviceTreeId: string;
  endpointRegex: string;
  position: Position;
  // Measured canvas size used for deterministic boundary containment.
  // Optional for compatibility with older documents; normalization fills it.
  size?: Size;
  // Optional background color for the node on the diagram. Hex string from
  // NODE_COLORS, or undefined for the default white. Pure cosmetic — has
  // no semantic meaning and is not enforced by any analysis rule.
  color?: string;
  // Optional instance overrides for type-level settings. When undefined the
  // type's value is used as-is. When the type's value has
  // `instanceMustSpecify` (e.g. "DataKeptInGeoUnlessIndicatedByCaller" /
  // "ControlledByCallingService"), a concrete override is REQUIRED for the
  // node to pass analysis. normalizeDoc rejects deferred variants as
  // overrides (they would be circular) and validates the per-variant params.
  geoBoundary?: GeoBoundarySetting;
  postSubscriptionRetention?: PostSubscriptionRetention;
}

// Palette of node background colors offered via the right-click context
// menu. Soft pastels so titles stay legible against the dark border.
export interface NodeColor {
  name: string;
  value: string;
}
export const NODE_COLORS: readonly NodeColor[] = [
  { name: "Slate", value: "#e2e8f0" },
  { name: "Red", value: "#fecaca" },
  { name: "Orange", value: "#fed7aa" },
  { name: "Yellow", value: "#fef08a" },
  { name: "Green", value: "#bbf7d0" },
  { name: "Blue", value: "#bfdbfe" },
  { name: "Purple", value: "#ddd6fe" },
  { name: "Pink", value: "#fbcfe8" },
];

// -- Display + canonicalization helpers for the type-catalog value types --
//
// formatX(v) → user-facing text used by both the NodeDetails UI and the
// diff-engine change descriptions, so the two stay in lockstep.
// canonicalX(v|undefined) → comparison key used by the diff engine; safe to
// compare with === so two equivalent shapes don't produce false-positive
// changes regardless of extraneous fields.

export function formatGeoBoundary(v: GeoBoundarySetting | undefined): string {
  if (!v) return "(unset)";
  switch (v.id) {
    case "DataKeptInGeo":
      return "Data kept in geo";
    case "DataKeptInGeoUnlessIndicatedByCaller":
      return "Data kept in geo unless indicated by calling service";
    case "DataKeptInGeoUnlessCustomerAllowsXGeo": {
      const desc = (v.description ?? "").trim();
      return desc
        ? `Data kept in geo unless customer allows cross-geo (${desc})`
        : "Data kept in geo unless customer allows cross-geo";
    }
    case "DataNotKeptInGeo":
      return "Data not kept in geo";
    default:
      // Defensive: unknown id surfaced as the raw id.
      return (v as { id: string }).id;
  }
}

export function canonicalGeoBoundary(
  v: GeoBoundarySetting | undefined
): string {
  if (!v) return "";
  if (v.id === "DataKeptInGeoUnlessCustomerAllowsXGeo") {
    return `${v.id}|${(v.description ?? "").trim()}`;
  }
  return v.id;
}

export function formatPostSubscriptionRetention(
  v: PostSubscriptionRetention | undefined
): string {
  if (!v) return "(unset)";
  switch (v.id) {
    case "RetainedDaysRange":
      return `Retained ${v.minDays}-${v.maxDays} days`;
    case "ControlledByCallingService":
      return "Retention controlled by calling service";
    default:
      return (v as { id: string }).id;
  }
}

export function canonicalPostSubscriptionRetention(
  v: PostSubscriptionRetention | undefined
): string {
  if (!v) return "";
  if (v.id === "RetainedDaysRange") {
    return `${v.id}|${v.minDays}|${v.maxDays}`;
  }
  return v.id;
}

export function formatGdprHandling(v: GdprHandling | undefined): string {
  if (!v) return "(unset)";
  switch (v.id) {
    case "NodeHandlesGdpr":
      return "Node handles GDPR or facilitates customer";
    case "CallingServiceResponsible":
      return "Calling service responsible";
    default:
      return (v as { id: string }).id;
  }
}

export interface Waypoint extends Position {
  id: string;
}

// A reusable data item that can be attached to one or more edges.
// `sample` lets the user record an example value for documentation.
export interface PsData {
  id: string;
  name: string;
  classification: DataClassification;
  sample: string;
}

// A free-standing security-review work item — a brief description and an
// optional link to an external tracker (ADO/Jira/issue URL). Work items are
// not attached to any node or edge; they live alongside the model as a
// catalog the team manages through the "Manage Work Items" toolbar button.
export interface PsWorkItem {
  id: string;
  description: string;
  link: string;
}

export const REQUIRED_ACCESS_RIGHTS_MAX_LENGTH = 4000;

export function normalizeRequiredAccessRights(value: unknown, edgeId?: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > REQUIRED_ACCESS_RIGHTS_MAX_LENGTH) {
    throw new Error(`Edge ${edgeId ?? "(unidentified)"}: requiredAccessRights must be text of at most ${REQUIRED_ACCESS_RIGHTS_MAX_LENGTH} UTF-16 code units. Correct the field and retry; no text was truncated.`);
  }
  return value;
}

export function formatRequiredAccessRights(value: string | undefined): string {
  return value?.trim() ? value : "";
}

export interface PsEdge {
  id: string;
  metadata?: Record<string, string>;
  metadataFields?: MetadataField[];
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  title: string;
  description: string;
  // One optional communication profile shared by every scenario using the edge.
  // Missing means unspecified; it is not evidence of cleartext or encryption.
  protocolId?: ProtocolId;
  // Standalone caller application/client ID. Retained legacy identity data
  // remains in productionIdentity and is never silently overwritten.
  applicationId?: string;
  // Declared design intent, shared by every scenario using this edge.
  // Missing or blank is unspecified, not a claim that no rights are needed.
  requiredAccessRights?: string;
  // Stored as an array for file compatibility, but authored flows select at
  // most one method. Older imports with multiple values remain recoverable
  // and are flagged until the user chooses the method the call actually uses.
  authenticationTypes?: AuthenticationType[];
  // Read-only compatibility evidence from the retired Production identity
  // editor. New caller IDs use applicationId; this evidence is never inferred
  // as the identity of a rerouted caller.
  productionIdentity?: ProductionIdentity;
  audience?: string;
  constraints?: string;
  // True if this edge represents a problem flow (e.g. a forbidden
  // call). Pure cosmetic flag — rendered in red on the canvas and in
  // VSDX export — that lets reviewers visually flag flows for follow-up
  // without changing any analysis rules. Undefined or false means the
  // edge uses the default color.
  problem?: boolean;
  // Note: data attachments are per-scenario and per-direction
  // (request vs. response). See Scenario.edgeRequestData /
  // Scenario.edgeResponseData.
  // Intermediate spline control points between source and target. The full
  // spline runs through [source, ...waypoints, target]. New edges start with
  // one waypoint so the spline has N=3 points.
  waypoints: Waypoint[];
}

// Nonsemantic canvas text: never a flow endpoint, asset, or review target.
export interface PsTextAnnotation {
  id: string;
  text: string;
  position: Position;
  size: Size;
}

export interface PsBoundary {
  id: string;
  type: BoundaryType;
  // Subtype id from PRIVACY_BOUNDARY_TYPE_DEFS. Only meaningful when
  // `type === "privacy"`; for security boundaries this should be left unset.
  // Optional/undefined means "subtype not specified" (e.g. legacy boundaries
  // imported before this field existed).
  privacySubtype?: string;
  // Subtype id from SECURITY_BOUNDARY_TYPE_DEFS. Only meaningful when
  // `type === "security"`; mirrors privacySubtype for the security family.
  securitySubtype?: string;
  // Shared instance notes. Retained, but inactive, on privacy boundaries.
  inboundAllow?: string;
  inboundDeny?: string;
  outboundAllow?: string;
  outboundDeny?: string;
  title: string;
  position: Position;
  size: Size;
  // Nodes physically contained by this boundary. A node may belong to
  // multiple overlapping boundaries.
  nodeIds: string[];
}

export const BOUNDARY_NETWORK_FIELDS = [
  { key: "inboundAllow", label: "Inbound Allow" },
  { key: "inboundDeny", label: "Inbound Deny" },
  { key: "outboundAllow", label: "Outbound Allow" },
  { key: "outboundDeny", label: "Outbound Deny" },
] as const;

export function normalizeBoundaryNetworkText(value: unknown, label: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`Boundary ${label} must be plain text when supplied.`);
  }
  return value;
}

export function formatBoundaryNetworkText(value: string | undefined): string {
  return value?.trim() ? value : "";
}

// Per scenario, the edge sequence number lives on the scenario, not the edge.
// Data attachments are also per-scenario so the same node/edge can hold
// different data items in different scenarios.
export interface Scenario {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
  nodeScopeReasons?: Record<string, DfdValue>;
  nodeScopeReasonsRecovery?: InvalidDfdValue;
  // edgeIds in array order; the index+1 is the sequence number,
  // but we also store edgeNumbers as a map for clarity & to allow
  // gaps or custom numbering if the user prefers.
  edgeIds: string[];
  edgeNumbers: Record<string, number>;
  boundaryIds: string[];
  textAnnotationIds?: string[];
  // nodeId -> (dataId -> Retention)
  nodeData: Record<string, Record<string, Retention>>;
  // edgeId -> dataIds (treated as a set), split by direction.
  // Request data is the payload the source sends to the target; it flows in
  // the arrow direction and is validated against the TARGET node's policy.
  // Response data is what the target returns to the source; it flows against
  // the arrow direction and is validated against the SOURCE node's policy.
  edgeRequestData: Record<string, string[]>;
  edgeResponseData: Record<string, string[]>;
}

// A reply in a comment's discussion thread.
export interface CommentReply {
  id: string;
  text: string;
  createdAt: number;
}

export type CommentStatus = "Active" | "Resolved";

// A discussion comment attached to a (scenario, node|edge) pair. Comments are
// scoped to a scenario — the same node can carry different comments in
// different scenarios. Each comment owns a discussion thread (replies).
export interface PsComment {
  id: string;
  scenarioId: string;
  targetKind: "node" | "edge";
  targetId: string;
  text: string;
  status: CommentStatus;
  createdAt: number;
  replies: CommentReply[];
}

// A reply in an issue's discussion thread.
export interface IssueReply {
  id: string;
  text: string;
  createdAt: number;
}

export type IssueStatus = "Active" | "Resolved";

export const ISSUE_NOT_EVALUATED_LABELS = {
  "rule-unavailable": "Not re-evaluated: rule unavailable",
  "rule-retired": "Not re-evaluated: analyzer rule retired",
  "policy-unavailable": "Not re-evaluated: required policy definition unavailable",
  unknown: "Not re-evaluated: unrecognized evaluation state",
} as const;
export type IssueNotEvaluatedReason = keyof typeof ISSUE_NOT_EVALUATED_LABELS;

export function normalizeIssueNotEvaluatedReason(value: unknown): IssueNotEvaluatedReason | undefined {
  if (value === undefined) return undefined;
  if (value === "rule-unavailable" || value === "rule-retired" || value === "policy-unavailable") return value;
  return "unknown";
}

// An issue attached to a node or edge. Unlike a comment, an issue can span
// multiple scenarios (e.g. "Edge 1 in scenarios 2 and 3 carries customer
// data across a privacy boundary"). `scenarioIds` is the set of scenarios
// the issue applies to. An empty list means it applies regardless of
// scenario (e.g. structural problems on the node/edge itself).
export interface PsIssue {
  id: string;
  // Provenance captured from the exact AI guidance context when a finding is
  // accepted. It is reference metadata, not verified control evidence.
  guidanceReferences?: Array<{
    typeId: string;
    protocolId?: string;
    methodId?: string;
    definitionSource: "saved" | "available" | "core";
    revision: number;
    updatedOn: string;
    sources: string[];
  }>;
  // Only explicit Add threat note authoring sets this; absence is not provenance.
  origin?: "authored-threat";
  justification?: string;
  // Auto-generated issues are tagged with a stable rule identifier (e.g.
  // "Edge_must_have_data") so the analyzer can reconcile them on subsequent
  // runs: only a completely evaluated issue whose rule no longer triggers
  // is deleted. Existing findings preserve status/replies/createdAt.
  // Manually created issues leave this undefined and are never touched by
  // the analyzer.
  kind?: string;
  // Separate from human status. Absence does not certify a fresh evaluation.
  notEvaluatedReason?: IssueNotEvaluatedReason;
  targetKind: "node" | "edge";
  targetId: string;
  scenarioIds: string[];
  title: string;
  description: string;
  status: IssueStatus;
  createdAt: number;
  replies: IssueReply[];
  // Optional URL to remediation guidance. Auto-generated rules may set this
  // (e.g. deprecated-auth issues link to the BIC security guidance page) and
  // the UI surfaces it as a hyperlink in the issue row.
  resolutionLink?: string;
}

export const DEVIATION_KINDS = [
  "primary-application-flow", "resource-application", "network-endpoint",
  "network-flow", "key-vault-secret", "arm-resource", "other",
] as const;

export type DeviationKind = (typeof DEVIATION_KINDS)[number] | CatalogReferenceId;
export const DEVIATION_KIND_LABELS: Record<string, string> = Object.fromEntries(deviationTypes.map(def => [def.id, def.label]));
export function deviationKindLabel(id: string, saved?: readonly CatalogDefinitionSnapshot[], available?: readonly CatalogDefinitionSnapshot[]): string {
  return catalogReferenceLabel(id, catalogDefinitionsFor("deviation", saved, available));
}

export function catalogDefinitionsFor(
  kind: CatalogDefinitionKind,
  saved: readonly CatalogDefinitionSnapshot[] = [],
  availableClassifications?: readonly CatalogDefinitionSnapshot[],
): CatalogDefinitionSnapshot[] {
  const builtIns: readonly Pick<CatalogDefinitionSnapshot, "id" | "label" | "description" | "library">[] =
    kind === "classification" ? availableClassifications?.filter(def => def.kind === kind) ?? DATA_CLASSIFICATION_DEFS
      : kind === "tenant" ? PRODUCTION_IDENTITY_TENANT_DEFS
      : kind === "privacyBoundary" ? PRIVACY_BOUNDARY_TYPE_DEFS
      : kind === "securityBoundary" ? SECURITY_BOUNDARY_TYPE_DEFS
      : DEVIATION_KINDS.map((id) => ({ id, label: DEVIATION_KIND_LABELS[id] }));
  const definitions = new Map(builtIns.map(({ id, label, description, library }) => [id, {
    kind, id, label, ...(description ? { description } : {}), ...(library ? { library } : {}),
  }]));
  for (const def of availableClassifications ?? []) if (def.kind === kind) definitions.set(def.id, def);
  for (const def of saved) if (def.kind === kind) definitions.set(def.id, def);
  return [...definitions.values()];
}

// Saved definitions retain display meaning, not authoring availability.
export function catalogDefinitionChoices(
  kind: CatalogDefinitionKind,
  saved?: readonly CatalogDefinitionSnapshot[],
  available?: readonly CatalogDefinitionSnapshot[],
): CatalogDefinitionSnapshot[] {
  const availableIds = new Set((available ?? catalogDefinitionsFor(kind))
    .filter(def => def.kind === kind).map(def => def.id));
  return catalogDefinitionsFor(kind, saved, available).filter(def => availableIds.has(def.id));
}

export function assertCatalogSelection(
  kind: CatalogDefinitionKind, value: string | undefined,
  previous: string | undefined, available: readonly CatalogDefinitionSnapshot[],
): void {
  if (value === undefined || value === "" || value === previous) return;
  if (!isCatalogReferenceId(value) || !available.some(def => def.kind === kind && def.id === value)) {
    throw new Error(`The ${kind} choice "${value}" requires an available library definition. Existing values were not changed.`);
  }
}
export type DeviationStatus = "Active" | "Resolved";

export interface DeviationSampleCall {
  source: string;
  destination: string;
  count: number;
}

// A document-wide, evidence-backed exception found while reconciling the
// model with external service evidence. The stable key lets repeated reviews
// update or reopen the same finding instead of creating duplicates.
export interface PsDeviation {
  id: string;
  key: string;
  kind: DeviationKind;
  title: string;
  description: string;
  explanation: string;
  status: DeviationStatus;
  evidenceIds: string[];
  sampleCalls?: DeviationSampleCall[];
  targetKind?: "node" | "edge";
  targetId?: string;
  scenarioIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PsDocument {
  version: 1;
  // Portable referenced definitions, not the user's profile library.
  authenticationDefinitions?: AuthTypeDef[];
  // Portable saved definitions referenced by this document; never profile preferences.
  protocolDefinitions?: ProtocolTypeDef[];
  // Data-only display definitions; never installed packages or authentication preferences.
  catalogDefinitions?: CatalogDefinitionSnapshot[];
  // User-extendable catalog of node types ({id, label}). Catalog-backed
  // entries share their id with a NodeTypeDef; ad-hoc entries created at
  // authoring time get a random uid("nt") for id so the label can be
  // renamed without breaking PsNode.type references.
  nodeTypes: NodeTypeRef[];
  nodes: PsNode[];
  edges: PsEdge[];
  boundaries: PsBoundary[];
  textAnnotations?: PsTextAnnotation[];
  scenarios: Scenario[];
  data: PsData[];
  comments: PsComment[];
  issues: PsIssue[];
  deviations: PsDeviation[];
  // Catalog of security-review work items. Free-standing — not attached
  // to any node or edge. Optional in legacy docs; normalizeDoc defaults
  // missing entries to an empty array.
  workItems: PsWorkItem[];
}

export function emptyDocument(): PsDocument {
  return {
    version: 1,
    authenticationDefinitions: [],
    protocolDefinitions: [],
    catalogDefinitions: [],
    nodeTypes: [...DEFAULT_NODE_TYPES],
    nodes: [],
    edges: [],
    boundaries: [],
    scenarios: [],
    data: [],
    comments: [],
    issues: [],
    deviations: [],
    workItems: [],
  };
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}
