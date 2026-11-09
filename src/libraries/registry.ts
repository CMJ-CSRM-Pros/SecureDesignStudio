import { AUTH_TYPE_DEFS, validateAuthenticationDefinitions } from "../authentication";
import { DEFAULT_CLASSIFICATION_LIBRARY } from "../classificationLibrary";
import { CATALOG_DEFINITION_KINDS, NODE_TYPE_DEFS, catalogDefinitionsFor } from "../types";
import { ANALYZER_RULES } from "../IssueManager";
import { DEFAULT_INVENTORY_FIELD, inventoryIdError } from "../inventoryIdentity";
import { validateLibraryPackage, validateMetadataFields } from "./validation";
import {
  MAX_LIBRARIES, MAX_LIBRARY_SET_BYTES, type LibraryCandidate,
  type LibraryPackage, type LibraryRegistry, type LibraryStatus,
} from "./contracts";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

const coreFields = validateMetadataFields([
  DEFAULT_INVENTORY_FIELD,
  { id: "endpointRegex", target: "node", storage: "endpointRegex", label: "EndpointRegex" },
]);
const coreTaxonomy = CATALOG_DEFINITION_KINDS.filter(kind => kind !== "classification")
  .flatMap(kind => catalogDefinitionsFor(kind));
const coreNodes = NODE_TYPE_DEFS.map(({ id, label, ...definition }) => ({ id, label, definition }));
const coreRuleIds = Object.values(ANALYZER_RULES).flatMap(rule => [...rule.kinds]);
const key = (category: string, id: string) => `${category}/${id}`.toLowerCase();
export const taxonomyKey = (kind: string, id: string) => key(`taxonomy/${kind}`, id);

function contributions(pkg: LibraryPackage): string[] {
  return [
    ...pkg.catalogs.authentication.map(item => key("authentication", item.id)),
    ...(pkg.catalogs.classifications ? ["classifications/default"] : []),
    ...pkg.catalogs.nodes.map(item => key("nodes", item.id)),
    ...pkg.catalogs.taxonomy.map(item => taxonomyKey(item.kind, item.id)),
    ...pkg.fields.map(item => key("fields", item.id)),
    ...pkg.rules.map(item => key("rules", item.id)),
    ...pkg.help.map(item => key("help", item.id)),
  ];
}

function replace<T>(existing: readonly T[], incoming: readonly T[], identify: (value: T) => string): T[] {
  const values = new Map(existing.map(value => [identify(value).toLowerCase(), value]));
  for (const value of incoming) values.set(identify(value).toLowerCase(), value);
  return [...values.values()];
}

export function resolveLibraries(candidates: readonly LibraryCandidate[] = []): LibraryRegistry {
  let registry: LibraryRegistry = {
    statuses: [], authentication: [...AUTH_TYPE_DEFS], classifications: DEFAULT_CLASSIFICATION_LIBRARY,
    nodes: coreNodes, taxonomy: coreTaxonomy, fields: coreFields, rules: [], help: [], coreRuleIds,
    provenance: Object.fromEntries([
      ...AUTH_TYPE_DEFS.map(item => key("authentication", item.id)), "classifications/default",
      ...coreNodes.map(item => key("nodes", item.id)),
      ...coreTaxonomy.map(item => taxonomyKey(item.kind, item.id)),
      ...coreFields.map(item => key("fields", item.id)),
      ...coreRuleIds.map(item => key("rules", item)),
    ].map(identity => [identity, "core"])),
  };
  const statuses: LibraryStatus[] = [];
  if (candidates.length > MAX_LIBRARIES
      || new TextEncoder().encode(JSON.stringify(candidates)).byteLength > MAX_LIBRARY_SET_BYTES) {
    return freeze({ ...registry, statuses: [{
      source: "Deployment configuration", state: "rejected",
      message: "Library set exceeds the 16-package or 4 MiB limit.", contributions: [],
    }] });
  }
  const packages: { pkg: LibraryPackage; status: LibraryStatus; keys: string[] }[] = [];
  for (const candidate of candidates) {
    const status: LibraryStatus = {
      source: typeof candidate.source === "string" ? candidate.source.slice(0, 160) : "Configured library",
      state: "unavailable", contributions: [],
    };
    statuses.push(status);
    if (candidate.error) {
      status.message = candidate.error.slice(0, 400);
      continue;
    }
    try {
      const pkg = validateLibraryPackage(candidate.value);
      status.identity = { id: pkg.id, name: pkg.name, version: pkg.version };
      const keys = contributions(pkg);
      status.contributions = keys;
      packages.push({ pkg, status, keys });
    } catch (error) {
      status.state = "rejected";
      status.message = error instanceof Error ? error.message : "Invalid library package.";
    }
  }
  const reject = (entry: typeof packages[number], message: string) => {
    entry.status.state = "rejected";
    entry.status.message = message;
  };
  for (const entry of packages) {
    if (packages.filter(other => other.pkg.id.toLowerCase() === entry.pkg.id.toLowerCase()).length > 1) {
      reject(entry, "Duplicate library identity; no copy was selected.");
    }
    for (const other of packages) {
      if (other === entry) continue;
      const collisions = entry.keys.filter(key => other.keys.includes(key));
      for (const collision of collisions) {
        const orderedOverlay = (overlay: typeof entry, base: typeof entry, visited = new Set<string>()): boolean => {
          if (visited.has(overlay.pkg.id)) return false;
          visited.add(overlay.pkg.id);
          const priorOwner = overlay.pkg.overrides.find(rule => rule.key.toLowerCase() === collision)?.from;
          const prior = packages.find(item => item.pkg.id === priorOwner);
          if (!prior || !overlay.pkg.dependencies.some(dep => dep.id === prior.pkg.id && dep.version === prior.pkg.version)) return false;
          return prior === base || orderedOverlay(prior, base, visited);
        };
        if (!orderedOverlay(entry, other) && !orderedOverlay(other, entry)) {
          reject(entry, `Ambiguous contribution collision: ${collision}.`);
          reject(other, `Ambiguous contribution collision: ${collision}.`);
        }
      }
    }
  }
  const pending = packages.filter(entry => entry.status.state !== "rejected")
    .sort((a, b) => a.pkg.id.localeCompare(b.pkg.id, "en"));
  while (pending.length) {
    const index = pending.findIndex(entry => entry.pkg.dependencies.every(dep =>
      !pending.some(other => other.pkg.id === dep.id)));
    if (index === -1) {
      for (const entry of pending) reject(entry, "Dependency cycle or dependency on a cyclic package.");
      break;
    }
    const entry = pending.splice(index, 1)[0];
    const { pkg, status, keys } = entry;
    try {
      for (const dep of pkg.dependencies) {
        if (!statuses.some(item => item.state === "loaded"
            && item.identity?.id === dep.id && item.identity.version === dep.version)) {
          throw new Error(`Required library unavailable or version mismatch: ${dep.id}.`);
        }
      }
      for (const override of pkg.overrides) {
        const contribution = override.key.toLowerCase();
        if (!keys.includes(contribution) || registry.provenance[contribution] !== override.from
            || (override.from !== "core" && !pkg.dependencies.some(dep => dep.id === override.from))) {
          throw new Error(`Invalid explicit override: ${contribution}.`);
        }
        if (contribution.startsWith("rules/") && registry.provenance[contribution] === "core") {
          throw new Error("Core analyzer rules cannot be replaced in this checkpoint.");
        }
      }
      for (const contribution of keys) {
        const owner = registry.provenance[contribution];
        if (owner && !pkg.overrides.some(rule => rule.key.toLowerCase() === contribution && rule.from === owner)) {
          throw new Error(`Contribution requires an explicit override of ${owner}: ${contribution}.`);
        }
      }
      const authentication = validateAuthenticationDefinitions(replace(registry.authentication, pkg.catalogs.authentication, item => item.id));
      for (const field of pkg.fields) {
        const existing = registry.fields.find(item => item.id === field.id);
        if (existing && (existing.storage !== field.storage || existing.target !== field.target)) {
          throw new Error(`Field storage bindings are stable: ${field.id}.`);
        }
      }
      const fields = validateMetadataFields(replace(registry.fields, pkg.fields, item => item.id));
      for (const node of pkg.catalogs.nodes) {
        const field = fields.find(field => field.storage === "serviceTreeId");
        const error = inventoryIdError(node.definition?.serviceTreeId ?? "", field);
        if (error) throw new Error(error);
      }
      const rules = replace(registry.rules, pkg.rules, item => item.id);
      for (const rule of rules) {
        if (!fields.some(field => field.id === rule.fieldId && field.target === rule.target)) {
          throw new Error(`Rule requires an unavailable metadata field: ${rule.fieldId}.`);
        }
      }
      const classifications = pkg.catalogs.classifications ?? registry.classifications;
      const taxonomy = replace(registry.taxonomy, pkg.catalogs.taxonomy, item => taxonomyKey(item.kind, item.id));
      for (const node of pkg.catalogs.nodes) {
        for (const method of node.definition?.allowedAuthMethods ?? []) {
          if (method.id !== "*" && !authentication.some(def => def.id === method.id)) throw new Error("Node policy references an unavailable authentication definition.");
        }
        for (const data of node.definition?.allowedDataTypes ?? []) {
          if (data.id !== "*" && !classifications.classifications.some(def => def.id === data.id)) throw new Error("Node policy references an unavailable classification definition.");
        }
        if (node.definition?.defaultPrivacyBoundary && !taxonomy.some(def =>
          def.kind === "privacyBoundary" && def.id === node.definition?.defaultPrivacyBoundary)) {
          throw new Error("Node policy references an unavailable privacy boundary definition.");
        }
      }
      registry = {
        ...registry, authentication, classifications, fields, rules,
        nodes: replace(registry.nodes, pkg.catalogs.nodes, item => item.id),
        taxonomy,
        help: replace(registry.help, pkg.help, item => item.id),
        provenance: { ...registry.provenance, ...Object.fromEntries(keys.map(key => [key, pkg.id])) },
      };
      status.state = "loaded";
    } catch (error) {
      reject(entry, error instanceof Error ? error.message : "Library registration failed.");
    }
  }
  return freeze({ ...registry, statuses });
}

export const CORE_LIBRARIES = resolveLibraries();
