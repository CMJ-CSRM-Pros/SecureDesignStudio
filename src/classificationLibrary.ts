import defaults from "./data/classificationLibraryDefaults.json";
import shippedTypes from "./data/dataClassifications.json";
import {
  dataClassificationLabel, isCatalogReferenceId,
  type CatalogDefinitionSnapshot, type DataClassification,
  type PsDocument, resolveNodeTypeDef,
} from "./types";
import { catalogReferences } from "./catalogDefinitions";
import { safeNavigationHref } from "./urlSafety";

export interface ClassificationPresentation {
  color: string;
  foreground: string;
  priority: number;
}

export interface ClassificationDefinition {
  id: DataClassification;
  label: string;
  description?: string;
  disabled: boolean;
  presentation?: ClassificationPresentation;
}

export interface ClassificationLibrary {
  id: string;
  name: string;
  revision: string;
  defaultId: DataClassification;
  guidanceUrl?: string;
  classifications: readonly ClassificationDefinition[];
}

export const CLASSIFICATION_CATALOG_FORMAT = "secure-design-studio-classification-catalog";
export const CLASSIFICATION_STORAGE_KEY = "secure-design-studio:classification-library:v1";
type LibraryStorage = Pick<Storage, "getItem" | "setItem">;

function record(value: unknown, where: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}: expected an object.`);
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new Error(`${where}: unsupported field "${key.slice(0, 80)}".`);
  }
  return raw;
}

function text(value: unknown, where: string, limit: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > limit || (!allowEmpty && !value.trim())
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${where}: expected ${allowEmpty ? "" : "nonblank "}text, at most ${limit} characters.`);
  }
  return value.trim();
}

export function validateClassificationLibrary(value: unknown): ClassificationLibrary {
  const raw = record(value, "Classification Library", ["id", "name", "revision", "defaultId", "guidanceUrl", "classifications"]);
  if (!isCatalogReferenceId(raw.id) || !isCatalogReferenceId(raw.defaultId)) {
    throw new Error("Classification Library: invalid library or default classification ID.");
  }
  if (!Array.isArray(raw.classifications) || raw.classifications.length === 0 || raw.classifications.length > 2000) {
    throw new Error("Classification Library: expected 1-2000 classifications.");
  }
  const ids = new Set<string>();
  const labels = new Set<string>();
  const classifications = raw.classifications.map((entry, index): ClassificationDefinition => {
    const where = `Classification[${index}]`;
    const item = record(entry, where, ["id", "label", "description", "disabled", "presentation"]);
    if (!isCatalogReferenceId(item.id)) throw new Error(`${where}: invalid classification ID.`);
    const label = text(item.label, `${where}.label`, 160);
    if (ids.has(item.id.toLowerCase()) || labels.has(label.toLowerCase())) {
      throw new Error(`${where}: duplicate classification ID or label (case-insensitive).`);
    }
    ids.add(item.id.toLowerCase());
    labels.add(label.toLowerCase());
    if (item.disabled !== undefined && typeof item.disabled !== "boolean") throw new Error(`${where}.disabled: expected a boolean.`);
    const definition: ClassificationDefinition = { id: item.id, label, disabled: item.disabled === true };
    if (item.description !== undefined) {
      const description = text(item.description, `${where}.description`, 4000, true);
      if (description) definition.description = description;
    }
    if (item.presentation !== undefined) {
      const presentation = record(item.presentation, `${where}.presentation`, ["color", "foreground", "priority"]);
      if (typeof presentation.color !== "string" || !/^#[0-9a-f]{6}$/i.test(presentation.color)
          || typeof presentation.foreground !== "string" || !/^#[0-9a-f]{6}$/i.test(presentation.foreground)
          || typeof presentation.priority !== "number" || !Number.isInteger(presentation.priority)
          || presentation.priority < 0 || presentation.priority > 100) {
        throw new Error(`${where}.presentation: expected six-digit hex colors and integer display priority 0-100.`);
      }
      definition.presentation = {
        color: presentation.color, foreground: presentation.foreground, priority: presentation.priority,
      };
    }
    return definition;
  });
  if (!classifications.some(item => item.id === raw.defaultId && !item.disabled)) {
    throw new Error("Classification Library: defaultId must identify an enabled classification in this list.");
  }
  const library: ClassificationLibrary = {
    id: raw.id, name: text(raw.name, "Classification Library.name", 120),
    revision: text(raw.revision, "Classification Library.revision", 128),
    defaultId: raw.defaultId, classifications,
  };
  if (raw.guidanceUrl !== undefined) {
    const guidance = text(raw.guidanceUrl, "Classification Library.guidanceUrl", 2048);
    const safe = safeNavigationHref(guidance);
    if (!safe || !/^https?:\/\//i.test(safe)) throw new Error("Classification Library.guidanceUrl: expected an absolute HTTP(S) URL.");
    const url = new URL(safe);
    if (url.username || url.password) throw new Error("Classification Library.guidanceUrl: embedded credentials are not allowed.");
    library.guidanceUrl = safe;
  }
  return library;
}

export const DEFAULT_CLASSIFICATION_LIBRARY = validateClassificationLibrary({
  ...defaults, classifications: shippedTypes,
});
for (const definition of DEFAULT_CLASSIFICATION_LIBRARY.classifications) {
  if (definition.presentation) Object.freeze(definition.presentation);
  Object.freeze(definition);
}
Object.freeze(DEFAULT_CLASSIFICATION_LIBRARY.classifications);
Object.freeze(DEFAULT_CLASSIFICATION_LIBRARY);

export function parseClassificationCatalog(value: unknown): ClassificationLibrary {
  const raw = record(value, "Classification catalog", [
    "format", "version", "id", "name", "revision", "defaultId", "guidanceUrl", "classifications",
  ]);
  if (raw.format !== CLASSIFICATION_CATALOG_FORMAT || raw.version !== 1) {
    throw new Error(`Expected "${CLASSIFICATION_CATALOG_FORMAT}", version 1.`);
  }
  const { format: _format, version: _version, ...library } = raw;
  return validateClassificationLibrary(library);
}

export function exportClassificationCatalog(library: ClassificationLibrary): string {
  return JSON.stringify({
    format: CLASSIFICATION_CATALOG_FORMAT, version: 1, ...validateClassificationLibrary(library),
  }, null, 2);
}

export function loadClassificationLibrary(storage?: LibraryStorage, defaults = DEFAULT_CLASSIFICATION_LIBRARY): {
  library: ClassificationLibrary; source: "shipped" | "profile"; error: string | null;
  storedValue?: string | null;
} {
  let storedValue: string | null | undefined;
  try {
    storedValue = (storage ?? window.localStorage).getItem(CLASSIFICATION_STORAGE_KEY);
    return storedValue === null
      ? { library: defaults, source: "shipped", error: null, storedValue }
      : { library: parseClassificationCatalog(JSON.parse(storedValue)), source: "profile", error: null, storedValue };
  } catch (cause) {
    return {
      library: defaults, source: "shipped", storedValue,
      error: `Classification Library could not be loaded: ${cause instanceof Error ? cause.message : String(cause)} Using shipped defaults; stored data was not overwritten. Back up and repair the profile configuration.`,
    };
  }
}

export function mergeClassificationLibrary(
  current: ClassificationLibrary, incoming: ClassificationLibrary,
): ClassificationLibrary {
  const before = validateClassificationLibrary(current);
  const imported = validateClassificationLibrary(incoming);
  const entries = new Map(before.classifications.map(item => [item.id, item]));
  for (const item of imported.classifications) entries.set(item.id, item);
  return validateClassificationLibrary({ ...before, classifications: [...entries.values()] });
}

export function classificationReferencesInDocument(doc: PsDocument): Set<string> {
  const ids = new Set(catalogReferences(doc).filter(ref => ref.kind === "classification").map(ref => ref.id));
  for (const type of new Set(doc.nodes.map(node => node.type))) {
    for (const rule of resolveNodeTypeDef(type, doc.nodeTypes)?.allowedDataTypes ?? []) {
      if (rule.id !== "*") ids.add(rule.id);
    }
  }
  return ids;
}

export function repairClassificationLibrary(
  library: ClassificationLibrary, expectedCorruptValue: string, storage?: LibraryStorage,
): void {
  const serialized = exportClassificationCatalog(library);
  try {
    const target = storage ?? window.localStorage;
    const raw = target.getItem(CLASSIFICATION_STORAGE_KEY);
    if (raw !== expectedCorruptValue) throw new Error("Stored configuration changed. Reload before repairing it.");
    let invalid = false;
    try { parseClassificationCatalog(JSON.parse(raw)); } catch { invalid = true; }
    if (!invalid) throw new Error("Stored configuration is now valid. Reload instead of overwriting it.");
    target.setItem(CLASSIFICATION_STORAGE_KEY, serialized);
  } catch (cause) {
    throw new Error(`Classification Library was not repaired: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export function persistClassificationLibrary(
  library: ClassificationLibrary, expected: ClassificationLibrary, storage?: LibraryStorage, defaults = DEFAULT_CLASSIFICATION_LIBRARY,
): void {
  const serialized = exportClassificationCatalog(library);
  try {
    const target = storage ?? window.localStorage;
    const raw = target.getItem(CLASSIFICATION_STORAGE_KEY);
    const current = raw === null ? defaults : parseClassificationCatalog(JSON.parse(raw));
    if (exportClassificationCatalog(current) !== exportClassificationCatalog(expected)) {
      throw new Error("The Classification Library changed in another tab. Reload before applying changes.");
    }
    target.setItem(CLASSIFICATION_STORAGE_KEY, serialized);
  } catch (cause) {
    throw new Error(`Classification Library was not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export function classificationDefinitionsForLibrary(library: ClassificationLibrary): CatalogDefinitionSnapshot[] {
  return library.classifications.map(({ id, label, description }) => ({
    kind: "classification", id, label, ...(description ? { description } : {}),
    library: { id: library.id, version: library.revision },
  }));
}

export function classificationOptions(
  library: ClassificationLibrary, saved: readonly CatalogDefinitionSnapshot[] | undefined, currentId?: string,
): { id: string; label: string; disabled: boolean; saved: boolean }[] {
  const available = classificationDefinitionsForLibrary(library);
  const ids = library.classifications.filter(item => !item.disabled).map(item => String(item.id));
  if (currentId && isCatalogReferenceId(currentId) && !ids.includes(currentId)) ids.push(currentId);
  return ids.map(id => ({
    id, label: dataClassificationLabel(id, saved, available),
    disabled: !library.classifications.some(item => item.id === id && !item.disabled),
    saved: saved?.some(def => def.kind === "classification" && def.id === id) ?? false,
  }));
}

export function isEnabledClassification(library: ClassificationLibrary, id: string): id is DataClassification {
  return library.classifications.some(item => item.id === id && !item.disabled);
}
