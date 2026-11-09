import {
  CATALOG_DEFINITION_KINDS, catalogDefinitionsFor, isCatalogReferenceId,
  type CatalogDefinitionKind, type CatalogDefinitionSnapshot, type PsDocument,
} from "./types";

export function catalogDefinitionKey(def: Pick<CatalogDefinitionSnapshot, "kind" | "id">): string {
  return JSON.stringify([def.kind, def.id]);
}

function record(value: unknown, where: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}: expected an object.`);
  }
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) throw new Error(`${where}: unsupported field "${key}".`);
  }
  return result;
}

function text(value: unknown, where: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${where}: expected nonblank text of at most ${limit} characters.`);
  }
  return value;
}

export function validateCatalogDefinitions(value: unknown): CatalogDefinitionSnapshot[] {
  if (!Array.isArray(value) || value.length > 2000) {
    throw new Error("Catalog definitions: expected an array of at most 2000 snapshots.");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const where = `Catalog definitions[${index}]`;
    const raw = record(entry, where, ["kind", "id", "label", "description", "library"]);
    if (!CATALOG_DEFINITION_KINDS.some((kind) => kind === raw.kind)) {
      throw new Error(`${where}: unsupported catalog kind.`);
    }
    if (!isCatalogReferenceId(raw.id)) throw new Error(`${where}: invalid catalog reference ID.`);
    const definition: CatalogDefinitionSnapshot = {
      kind: raw.kind as CatalogDefinitionKind,
      id: raw.id,
      label: text(raw.label, `${where}.label`, 160),
    };
    if (raw.description !== undefined) {
      definition.description = text(raw.description, `${where}.description`, 4000);
    }
    if (raw.library !== undefined) {
      const library = record(raw.library, `${where}.library`, ["id", "version"]);
      if (!isCatalogReferenceId(library.id)) throw new Error(`${where}.library: invalid library ID.`);
      definition.library = {
        id: library.id, version: text(library.version, `${where}.library.version`, 128),
      };
    }
    const key = catalogDefinitionKey(definition);
    if (seen.has(key)) throw new Error(`${where}: duplicate kind/ID (${definition.kind}, ${definition.id}).`);
    seen.add(key);
    return definition;
  });
}

export function catalogReferences(doc: PsDocument): Pick<CatalogDefinitionSnapshot, "kind" | "id">[] {
  const refs = new Map<string, Pick<CatalogDefinitionSnapshot, "kind" | "id">>();
  const add = (kind: CatalogDefinitionKind, id: unknown) => {
    if (isCatalogReferenceId(id)) refs.set(catalogDefinitionKey({ kind, id }), { kind, id });
  };
  for (const item of doc.data) add("classification", item.classification);
  for (const edge of doc.edges) {
    if (edge.productionIdentity?.kind === "AppId") add("tenant", edge.productionIdentity.tenant);
  }
  for (const boundary of doc.boundaries) {
    if (boundary.type === "privacy") add("privacyBoundary", boundary.privacySubtype);
    else add("securityBoundary", boundary.securitySubtype);
  }
  for (const deviation of doc.deviations) add("deviation", deviation.kind);
  for (const type of doc.nodeTypes) {
    if (!type.definition) continue;
    add("privacyBoundary", type.definition.defaultPrivacyBoundary);
    for (const rule of type.definition.allowedDataTypes) add("classification", rule.id);
  }
  return [...refs.values()];
}

// Snapshots are document dependencies, not an installed catalog. Saved versions
// win, but unused definitions do not travel with a saved model.
export function withCatalogDefinitions(
  doc: PsDocument, availableClassifications?: readonly CatalogDefinitionSnapshot[],
): PsDocument {
  const references = catalogReferences(doc);
  const referencedKeys = new Set(references.map(catalogDefinitionKey));
  const original = validateCatalogDefinitions(doc.catalogDefinitions ?? []);
  const saved = original.filter((def) => referencedKeys.has(catalogDefinitionKey(def)));
  const keys = new Set(saved.map(catalogDefinitionKey));
  const added: CatalogDefinitionSnapshot[] = [];
  for (const reference of references) {
    const key = catalogDefinitionKey(reference);
    if (keys.has(key)) continue;
    const definition = catalogDefinitionsFor(reference.kind, undefined, availableClassifications)
      .find((def) => def.id === reference.id);
    if (!definition) continue;
    added.push({ ...definition });
    keys.add(key);
  }
  if (saved.length + added.length > 2000) {
    throw new Error("Catalog snapshots exceed the 2000-definition limit. Reduce the number of referenced definitions before saving this model.");
  }
  return added.length || saved.length !== original.length
    ? { ...doc, catalogDefinitions: [...saved, ...added] } : doc;
}

export function referencedCatalogDefinitions(
  doc: PsDocument, availableClassifications?: readonly CatalogDefinitionSnapshot[],
): CatalogDefinitionSnapshot[] {
  const captured = withCatalogDefinitions(doc, availableClassifications);
  const keys = new Set(catalogReferences(doc).map(catalogDefinitionKey));
  return (captured.catalogDefinitions ?? []).filter((def) => keys.has(catalogDefinitionKey(def)));
}

export function mergeCatalogDefinitions(
  current: readonly CatalogDefinitionSnapshot[], incoming: readonly CatalogDefinitionSnapshot[],
): CatalogDefinitionSnapshot[] {
  const result = new Map(validateCatalogDefinitions(current).map((def) => [catalogDefinitionKey(def), def]));
  for (const definition of validateCatalogDefinitions(incoming)) {
    const key = catalogDefinitionKey(definition);
    const existing = result.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
      throw new Error(`Catalog definition conflict (${definition.kind}, ${definition.id}). The diagram keeps its saved definition; no import was applied.`);
    }
    result.set(key, definition);
  }
  return validateCatalogDefinitions([...result.values()]);
}
