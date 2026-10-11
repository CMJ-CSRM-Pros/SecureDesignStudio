import { validateAuthenticationDefinitions, isAuthenticationType } from "../authentication";
import { validateClassificationLibrary } from "../classificationLibrary";
import { validateCatalogDefinitions } from "../catalogDefinitions";
import {
  isCatalogReferenceId, isGuid, RETENTION_TYPES, NODE_TYPE_DEFS,
  GEO_BOUNDARY_SETTING_DEF_MAP, POST_SUBSCRIPTION_RETENTION_DEF_MAP, GDPR_HANDLING_DEF_MAP,
  type NodeTypeRef, type GeoBoundarySetting, type PostSubscriptionRetention, type GdprHandling,
} from "../types";
import { safeNavigationHref } from "../urlSafety";
import { inventoryIdError } from "../inventoryIdentity";
import { isDfdRole } from "../dfdSemantics";
import { validateAiDesignGuidance } from "../../shared/aiDesignGuidance";
import nodeIconKeys from "../data/nodeIconKeys.json";
import {
  LIBRARY_FORMAT, LIBRARY_API_VERSION, MAX_LIBRARY_BYTES,
  type LibraryPackage, type MetadataField, type LibraryRule,
} from "./contracts";

export function object(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}: expected an object.`);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error(`${where}: unsupported field.`);
  return raw;
}

export function text(value: unknown, where: string, limit = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${where}: expected nonblank text, at most ${limit} characters.`);
  }
  return value.trim();
}

export function id(value: unknown): string {
  if (!isCatalogReferenceId(value) || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error("Invalid library contribution ID.");
  }
  return value;
}

function version(value: unknown): string {
  const result = text(value, "version", 64);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(result)) {
    throw new Error("Library versions must be numeric major.minor.patch values.");
  }
  return result;
}

function list(value: unknown, where: string, max = 2000): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${where}: too many or invalid entries.`);
  return value;
}

function url(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const raw = text(value, "URL", 2048);
  const safe = safeNavigationHref(raw);
  if (!safe || !/^https?:\/\//i.test(safe)) throw new Error("Library links must use absolute HTTP(S) URLs.");
  const parsed = new URL(safe);
  if (parsed.username || parsed.password) throw new Error("Library links cannot contain credentials.");
  return safe;
}

export function validateMetadataFields(value: unknown): MetadataField[] {
  const fields = list(value, "Metadata fields", 100).map((value): MetadataField => {
    const raw = object(value, ["id", "target", "storage", "label", "description", "validation", "library"], "Metadata field");
    if (raw.target !== "node" && raw.target !== "edge") throw new Error("Invalid metadata target.");
    if (raw.storage !== "metadata" && !(raw.target === "node"
        && (raw.storage === "serviceTreeId" || raw.storage === "endpointRegex"))) {
      throw new Error("Invalid metadata storage binding.");
    }
    const field: MetadataField = {
      id: id(raw.id), target: raw.target, storage: raw.storage,
      label: text(raw.label, "Field label"),
    };
    if (raw.validation !== undefined) {
      if (raw.validation !== "guid" || raw.storage !== "serviceTreeId") {
        throw new Error("GUID field validation is supported only on the inventory identity binding; use a declarative rule for other metadata.");
      }
      field.validation = "guid";
    }
    if (raw.description !== undefined) field.description = text(raw.description, "Field description", 4000);
    if (raw.library !== undefined) {
      const owner = object(raw.library, ["id", "version"], "Field library");
      field.library = { id: id(owner.id), version: version(owner.version) };
    }
    return field;
  });
  unique(fields.map(field => field.id));
  unique(fields.map(field => `${field.target}/${field.storage === "metadata" ? field.id : field.storage}`));
  return fields;
}

export function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length > 100) throw new Error("Metadata must contain at most 100 string fields.");
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    id(key);
    if (typeof item !== "string" || item.length > 4000) throw new Error("Metadata values must be strings of at most 4000 characters.");
    result[key] = item;
  }

  return result;
}

export function normalizeEntityMetadata(
  entity: { metadata?: unknown; metadataFields?: unknown }, target: "node" | "edge",
): { metadata?: Record<string, string>; metadataFields?: MetadataField[] } {
  const metadata = normalizeMetadata(entity.metadata);
  const fields = validateMetadataFields(entity.metadataFields).filter(field =>
    field.target === target && field.storage === "metadata" && metadata && Object.hasOwn(metadata, field.id));
  return { ...(metadata ? { metadata } : {}), ...(fields.length ? { metadataFields: fields } : {}) };
}

function unique(keys: string[]) {
  if (new Set(keys.map(key => key.toLowerCase())).size !== keys.length) {
    throw new Error("Duplicate contribution identity or storage binding.");
  }
}

function nodeType(value: unknown): NodeTypeRef {
  const raw = object(value, ["id", "label", "definition"], "Node type");
  if (!isCatalogReferenceId(raw.id)) throw new Error("Invalid node type ID: use a bounded, nonblank saved reference.");
  const definition = object(raw.definition, [
    "serviceTreeId", "endpointRegex", "allowedAuthMethods", "allowedDataTypes", "policyStatus",
    "description", "category", "templateHints", "defaultPrivacyBoundary",
    "catalogSource", "resourceProviders", "documentationUrl", "icon",
    "geoBoundary", "postSubscriptionRetention", "gdprHandling", "defaultDfdRole", "aiDesignGuidance",
  ], "Library node definition");
  const serviceTreeId = definition.serviceTreeId ?? "";
  const aiDesignGuidance = validateAiDesignGuidance(definition.aiDesignGuidance);
  if (definition.defaultDfdRole !== undefined && !isDfdRole(definition.defaultDfdRole)) {
    throw new Error("Invalid default DFD role.");
  }
  const identityError = inventoryIdError(serviceTreeId);
  if (identityError) throw new Error(identityError);
  const endpointRegex = text(definition.endpointRegex ?? "^$", "Endpoint expression", 1000);
  try { new RegExp(endpointRegex); } catch { throw new Error("Invalid node endpoint expression."); }
  if (definition.policyStatus !== undefined && definition.policyStatus !== "Unspecified") throw new Error("Invalid node policy status.");
  const allowedAuthMethods = list(definition.allowedAuthMethods, "Auth policy").map(value => {
    const rule = object(value, ["id", "status"], "Auth policy");
    if ((rule.id !== "*" && !isAuthenticationType(rule.id))
        || (rule.status !== "Allowed" && rule.status !== "Deprecated")) throw new Error("Invalid auth policy.");
    return { id: rule.id, status: rule.status };
  });
  const allowedDataTypes = list(definition.allowedDataTypes, "Data policy").map(value => {
    const rule = object(value, ["id", "retention", "action"], "Data policy");
    if ((rule.id !== "*" && !isCatalogReferenceId(rule.id))
        || (rule.retention !== "*" && !(RETENTION_TYPES as readonly unknown[]).includes(rule.retention))
        || (rule.action !== "Allow" && rule.action !== "Deny")) throw new Error("Invalid data policy.");
    return { id: rule.id, retention: rule.retention, action: rule.action };
  });
  if (definition.policyStatus !== "Unspecified"
      && allowedDataTypes.filter(rule => rule.id === "*" && rule.retention === "*").length !== 1) {
    throw new Error("A curated data policy requires exactly one wildcard fallback.");
  }
  if (definition.policyStatus === "Unspecified" && allowedDataTypes.length) {
    throw new Error("An unspecified policy cannot also declare data acceptance rules.");
  }
  if (definition.defaultPrivacyBoundary !== undefined && !isCatalogReferenceId(definition.defaultPrivacyBoundary)) {
    throw new Error("Invalid default privacy boundary ID.");
  }
  let geoBoundary: GeoBoundarySetting | undefined;
  if (definition.geoBoundary !== undefined) {
    const geo = object(definition.geoBoundary, ["id", "description"], "Geo boundary");
    if (typeof geo.id !== "string" || !Object.hasOwn(GEO_BOUNDARY_SETTING_DEF_MAP, geo.id)) throw new Error("Unsupported geo policy definition.");
    geoBoundary = geo.id === "DataKeptInGeoUnlessCustomerAllowsXGeo"
      ? { id: geo.id, description: text(geo.description, "Geo policy description", 4000) }
      : { id: geo.id as Exclude<GeoBoundarySetting["id"], "DataKeptInGeoUnlessCustomerAllowsXGeo"> };
    if (geoBoundary && geo.description !== undefined) geoBoundary = { ...geoBoundary, description: text(geo.description, "Geo policy description", 4000) };
  }
  let postSubscriptionRetention: PostSubscriptionRetention | undefined;
  if (definition.postSubscriptionRetention !== undefined) {
    const retention = object(definition.postSubscriptionRetention, ["id", "minDays", "maxDays"], "Post-subscription retention");
    if (typeof retention.id !== "string" || !Object.hasOwn(POST_SUBSCRIPTION_RETENTION_DEF_MAP, retention.id)) throw new Error("Unsupported post-subscription retention.");
    if (retention.id === "RetainedDaysRange") {
      const { minDays, maxDays } = retention;
      if (typeof minDays !== "number" || typeof maxDays !== "number" || !Number.isSafeInteger(minDays)
          || !Number.isSafeInteger(maxDays) || minDays < 0 || maxDays < minDays) throw new Error("Invalid retention day range.");
      postSubscriptionRetention = { id: "RetainedDaysRange", minDays, maxDays };
    } else postSubscriptionRetention = { id: "ControlledByCallingService" };
  }
  let gdprHandling: GdprHandling | undefined;
  if (definition.gdprHandling !== undefined) {
    const gdpr = object(definition.gdprHandling, ["id"], "GDPR handling");
    if (typeof gdpr.id !== "string" || !Object.hasOwn(GDPR_HANDLING_DEF_MAP, gdpr.id)) throw new Error("Unsupported GDPR policy.");
    gdprHandling = { id: gdpr.id as GdprHandling["id"] };
  }
  const icon = definition.icon;
  if (icon !== undefined && (typeof icon !== "string"
      || !nodeIconKeys.includes(icon))) {
    throw new Error("Library icons must reference an existing bundled icon; external assets are unsupported.");
  }
  return {
    id: raw.id, label: text(raw.label, "Node label"),
    definition: {
      ...(aiDesignGuidance ? { aiDesignGuidance } : {}),
      ...(isDfdRole(definition.defaultDfdRole) ? { defaultDfdRole: definition.defaultDfdRole } : {}),
      serviceTreeId: (serviceTreeId as string).trim(), endpointRegex,
      allowedAuthMethods: allowedAuthMethods as NonNullable<NodeTypeRef["definition"]>["allowedAuthMethods"],
      allowedDataTypes: allowedDataTypes as NonNullable<NodeTypeRef["definition"]>["allowedDataTypes"],
      ...(definition.policyStatus === "Unspecified" ? { policyStatus: "Unspecified" as const } : {}),
      description: definition.description === undefined ? "" : text(definition.description, "Node description", 4000),
      category: definition.category === undefined ? "Custom" : text(definition.category, "Node category"),
      templateHints: [...new Set(list(definition.templateHints, "Template hints", 50).map(value => text(value, "Template hint", 200)))],
      ...(typeof definition.defaultPrivacyBoundary === "string" ? { defaultPrivacyBoundary: definition.defaultPrivacyBoundary } : {}),
      ...(geoBoundary ? { geoBoundary } : {}),
      ...(postSubscriptionRetention ? { postSubscriptionRetention } : {}),
      ...(gdprHandling ? { gdprHandling } : {}),
      icon: typeof icon === "string" ? icon : "generic/component.svg",
      ...(definition.documentationUrl === undefined ? {} : { documentationUrl: url(definition.documentationUrl) }),
      catalogSource: definition.catalogSource === undefined ? "Document" : text(definition.catalogSource, "Catalog source"),
      resourceProviders: [...new Set(list(definition.resourceProviders, "Resource providers", 50).map(value => text(value, "Resource provider", 160)))],
    },
  };
}

export function validateLibraryPackage(value: unknown): LibraryPackage {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_LIBRARY_BYTES) throw new Error("Library exceeds the 1 MiB limit.");
  const raw = object(value, ["format", "apiVersion", "id", "name", "version", "dependencies", "overrides", "catalogs", "fields", "rules", "help"], "Library");
  if (raw.format !== LIBRARY_FORMAT || raw.apiVersion !== LIBRARY_API_VERSION) throw new Error("Unsupported library format or core API version.");
  const identity = { id: id(raw.id), name: text(raw.name, "Library name"), version: version(raw.version) };
  if (identity.id.toLowerCase() === "core") throw new Error("The core library identity is reserved.");
  const catalogs = object(raw.catalogs ?? {}, ["authentication", "classifications", "nodes", "taxonomy"], "Catalogs");
  const fields = validateMetadataFields(raw.fields).map(field => ({ ...field, library: { id: identity.id, version: identity.version } }));
  const rules = list(raw.rules, "Rules", 100).map((value): LibraryRule => {
    const rule = object(value, ["id", "target", "fieldId", "check", "title", "description", "resolutionLink"], "Rule");
    if ((rule.target !== "node" && rule.target !== "edge") || (rule.check !== "required" && rule.check !== "guid")) {
      throw new Error("Unsupported declarative rule target or check.");
    }
    return {
      id: id(rule.id), target: rule.target, fieldId: id(rule.fieldId), check: rule.check,
      title: text(rule.title, "Rule title"), description: text(rule.description, "Rule description", 4000),
      ...(rule.resolutionLink === undefined ? {} : { resolutionLink: url(rule.resolutionLink) }),
    };
  });
  const help = list(raw.help, "Help", 100).map(value => {
    const entry = object(value, ["id", "title", "text", "url"], "Help");
    return {
      id: id(entry.id), title: text(entry.title, "Help title"), text: text(entry.text, "Help text", 16000),
      ...(entry.url === undefined ? {} : { url: url(entry.url) }),
    };
  });
  const nodes = list(catalogs.nodes, "Node catalog").map(nodeType);
  const taxonomy = validateCatalogDefinitions(catalogs.taxonomy ?? []).map(def => {
    if (def.kind === "classification") throw new Error("Use the classification library contract for classification contributions.");
    return { ...def, library: { id: identity.id, version: identity.version } };
  });
  unique(taxonomy.map(def => `${def.kind}/${def.id}`));
  const dependencies = list(raw.dependencies, "Dependencies", 16).map(value => {
    const dep = object(value, ["id", "version"], "Dependency");
    return { id: id(dep.id), version: version(dep.version) };
  });
  const overrides = list(raw.overrides, "Overrides").map(value => {
    const overlay = object(value, ["key", "from"], "Override");
    return { key: text(overlay.key, "Override key", 260), from: id(overlay.from) };
  });
  for (const items of [nodes, fields, rules, help, dependencies]) unique(items.map(item => item.id));
  unique(overrides.map(item => item.key));
  return {
    format: LIBRARY_FORMAT, apiVersion: LIBRARY_API_VERSION, ...identity, dependencies, overrides,
    catalogs: {
      authentication: validateAuthenticationDefinitions(catalogs.authentication ?? []), nodes, taxonomy,
      ...(catalogs.classifications === undefined ? {} : { classifications: validateClassificationLibrary(catalogs.classifications) }),
    },
    fields, rules, help,
  };
}
