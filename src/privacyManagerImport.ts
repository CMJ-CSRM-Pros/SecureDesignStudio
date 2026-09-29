// Parser for the Privacy Manager data inventory export (`*.pmexp`).
//
// The file is the raw JSON envelope returned by the
// `GetDataInventoryModelsByReviewId` API endpoint:
//
//   { code, message, data: Array<Record> }
//
// where each Record describes one data element discovered for the review,
// scoped to a single service tree id. This module turns that into a
// SecureDesignStudio-friendly shape grouped by service, with classifications mapped
// to the local enum and a coarse retention heuristic applied. The store
// layer consumes the result and decides how to merge it into the doc.

import {
  type DataClassification,
  type Retention,
} from "./types";

// One SecureDesignStudio data item derived from one (record, classification) pair.
// Records with comma-separated classifications expand to multiple entries
// (one per classification) with disambiguated names — see parsePrivExp.
export interface ParsedDataItem {
  // Display name for the eventual PsData item.
  name: string;
  classification: DataClassification;
  sample: string;
  // Mapped retention derived from dataRetainDuration / dataStoreBoundary.
  retention: Retention;
  // Verbatim source strings, kept so the store layer or a future UI can
  // surface "we guessed this from X" details if needed.
  rawClassification: string;
  rawRetention: string;
  rawStoreBoundary: string;
}

export interface ServiceGroup {
  // serviceId (service tree GUID) as it appears in the file (preserved
  // casing). Empty string when the source mentioned the service by name
  // only (e.g. "MDS (Warm Path)" — parens contain a discriminator, not a
  // GUID). Use `canonicalServiceId` for auto-matching against existing
  // PsNode.serviceTreeId.
  serviceId: string;
  canonicalServiceId: string;
  // Stable key for the group, used everywhere a Map is keyed by service
  // (decisions, autoMapped, dedup). Equal to `canonicalServiceId` when a
  // GUID was present, otherwise `"name:" + lowercased trimmed name`.
  key: string;
  serviceName: string;
  items: ParsedDataItem[];
}

export interface ParsedPrivExp {
  groups: ServiceGroup[];
  recordCount: number;
  // Count of records that fell through to "Other" because we didn't
  // recognize their dataClassification string. Surfaced in the import
  // summary so the user knows the input had unknowns.
  unknownClassificationCount: number;
}

// Maps Privacy Manager's verbose classification labels to SecureDesignStudio ids.
// Keys cover both "Pseudonymized" and the variant "Pseudonymous" spelling
// observed in the wild, and singular/plural "Organization" variants.
const CLASSIFICATION_MAP: Record<string, DataClassification> = {
  "Customer Content": "Customer Content",
  "Customer Data": "Customer Data",
  "Customer data": "Customer Data",
  "Administrator Data": "Administrator Data",
  "Administrator data": "Administrator Data",
  "End User Identifiable Information (EUII)": "EUII",
  "End User Pseudonymized Information (EUPI)": "EUPI",
  "End User Pseudonymous Information (EUPI)": "EUPI",
  "End User Pseudonymized Identifier (EUPI)": "EUPI",
  "End User Pseudonymized Identifiers (EUPI)": "EUPI",
  "Organizational Identifiable Information (OII)": "OII",
  "Organization Identifiable Information (OII)": "OII",
  "System Metadata": "System Metadata",
  "Feedback Data": "Feedback Data",
  "Access Control Data": "Access Control Data",
  "Support Data": "Support Data",
  "Account Data": "Account Data",
};

// Splits a comma-separated classification cell into individual mapped ids.
// Returns at least one classification per call; unknown strings become
// "Other". Tracks whether anything mapped to "Other" so the import
// summary can mention it.
export interface ClassificationMapResult {
  classifications: DataClassification[];
  hadUnknown: boolean;
}

export function mapClassification(raw: string): ClassificationMapResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { classifications: ["Other" as DataClassification], hadUnknown: true };
  }
  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { classifications: ["Other" as DataClassification], hadUnknown: true };
  }
  const seen = new Set<DataClassification>();
  const out: DataClassification[] = [];
  let hadUnknown = false;
  for (const p of parts) {
    // Source-schema aliases remain stable even when the active authoring list
    // does not include the resulting ID.
    const mapped = Object.hasOwn(CLASSIFICATION_MAP, p) ? CLASSIFICATION_MAP[p] : undefined;
    if (mapped == null) {
      hadUnknown = true;
      const other: DataClassification = "Other";
      if (!seen.has(other)) {
        seen.add(other);
        out.push(other);
      }
      continue;
    }
    const cls = mapped;
    if (!seen.has(cls)) {
      seen.add(cls);
      out.push(cls);
    }
  }
  return { classifications: out, hadUnknown };
}

// Coarse mapping from Privacy Manager's free-form retention text to one
// of the SecureDesignStudio retention buckets. The user can refine after import.
//
// Order matters: explicit "not stored" wins over any time mention, and
// short windows win over a generic non-blank string (which defaults to
// the longest bucket — conservative for privacy review).
export function mapRetention(
  rawRetainDuration: string,
  rawStoreBoundary: string,
): Retention {
  const text = `${rawRetainDuration} ${rawStoreBoundary}`.toLowerCase();
  if (!text.trim()) return "";

  // "Not stored" / in-memory patterns -> ProcessingNoStorage.
  if (
    /\bnot\s+stored\b/.test(text) ||
    /\bno\s+storage\b/.test(text) ||
    /\bin\s+memory\b/.test(text) ||
    /\bmemory\s+only\b/.test(text) ||
    /\bnot\s+persisted\b/.test(text) ||
    /\bn\/?a\s*-\s*data\s+not\s+stored\b/.test(text)
  ) {
    return "ProcessingNoStorage";
  }

  // Short-retention patterns (<48h) -> StorageUnder48Hours.
  if (
    /\bunder\s*48\b/.test(text) ||
    /\bless\s+than\s+48\b/.test(text) ||
    /\b<\s*48\b/.test(text) ||
    /\b24\s*hours?\b/.test(text) ||
    /\bone\s*day\b/.test(text) ||
    /\b1\s*day\b/.test(text)
  ) {
    return "StorageUnder48Hours";
  }

  // Explicit hour count below 48.
  const hourMatch = text.match(/(\d{1,3})\s*(?:hours?|hrs?)/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    if (hours < 48) return "StorageUnder48Hours";
    return "StorageOver48Hours";
  }

  // Any other non-blank retention description (days, weeks, months, years,
  // "in sync with...", etc.) is assumed to be long-term. Conservative
  // default; the user can edit it down.
  if (rawRetainDuration.trim()) return "StorageOver48Hours";

  // dataStoreBoundary was set to something we didn't recognize as
  // "not stored", but retention itself is blank — leave unset.
  return "";
}

// Splits the time-window heuristic out of mapRetention so the dependency
// path (which already knows storage vs processing from storeDependency)
// can choose only the time bucket.
function timeBucket(rawRetainDuration: string): Retention {
  const text = rawRetainDuration.toLowerCase();
  if (
    /\bunder\s*48\b/.test(text) ||
    /\bless\s+than\s+48\b/.test(text) ||
    /\b<\s*48\b/.test(text) ||
    /\b24\s*hours?\b/.test(text) ||
    /\bone\s*day\b/.test(text) ||
    /\b1\s*day\b/.test(text)
  ) {
    return "StorageUnder48Hours";
  }
  const hourMatch = text.match(/(\d{1,3})\s*(?:hours?|hrs?)/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    if (hours < 48) return "StorageUnder48Hours";
    return "StorageOver48Hours";
  }
  if (rawRetainDuration.trim()) return "StorageOver48Hours";
  // Storage was indicated but no duration — still treat as long-term so
  // it doesn't silently default to processing.
  return "StorageOver48Hours";
}

// True if `boundary` ("dataStoreBoundary" or "storeDependency" raw
// value) is a sentinel meaning the data is not stored at this service.
function isNotStoredSentinel(boundary: string): boolean {
  const t = boundary.trim().toLowerCase();
  if (!t) return true;
  if (
    /^n\/?a\b/.test(t) &&
    /(not\s+stored|no\s+storage|not\s+persisted)/.test(t)
  ) {
    return true;
  }
  if (/^\s*not\s+stored\b/.test(t)) return true;
  return false;
}

// Service references mentioned in a *Dependency cell.
export interface DependencyEntry {
  // Service tree GUID, lowercased (canonical). Empty when not present.
  canonicalServiceId: string;
  // Original-cased GUID, empty when not present.
  serviceId: string;
  // Display name (preferred verbatim from source, whitespace collapsed).
  serviceName: string;
  // Stable dictionary key: GUID if present, else `"name:" + lower(name)`.
  key: string;
}

// GUID anywhere in a substring. Optional close-paren — some source rows
// have malformed `Name (GUID, Next (GUID)` patterns we still want to
// recover from.
const GUID_RE =
  /\(\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\)?/i;

// True for "N/A - ..." sentinel entries that mean "no dependency in this
// role" rather than naming a real service.
function isDependencySentinel(piece: string): boolean {
  const t = piece.trim().toLowerCase();
  if (!t) return true;
  if (/^n\/?a\b/.test(t)) return true;
  if (/^none\b/.test(t)) return true;
  return false;
}

// Parses a *Dependency cell into a deduped list of service references.
// Splits on `,` and `;` at the top level (service names themselves may
// contain parenthesized qualifiers like "MDS (Warm Path)" but commas
// inside such qualifiers have not been observed in the wild). Tolerates
// embedded newlines from the source, missing close-paren, and sentinel
// rows.
export function parseDependencyList(raw: string): DependencyEntry[] {
  if (!raw) return [];
  const pieces = raw
    .split(/[,;]/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: DependencyEntry[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    if (isDependencySentinel(piece)) continue;
    const m = piece.match(GUID_RE);
    let serviceId = "";
    let name = piece;
    if (m) {
      serviceId = m[1];
      // Strip the matched "(guid...)" from the piece; whatever remains
      // is the display name. Do NOT also strip a trailing ")" — names
      // commonly contain disambiguators like "Microsoft 365 Copilot
      // (BizChat Experiences)" or "Azure Data Explorer (Kusto)" that
      // legitimately end in a close-paren.
      name = piece.replace(GUID_RE, "").trim();
    }
    if (!name) continue;
    const canonicalServiceId = serviceId.toLowerCase();
    const key = canonicalServiceId
      ? canonicalServiceId
      : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      canonicalServiceId,
      serviceId,
      serviceName: name,
      key,
    });
  }
  return out;
}

// "More storage-y" comparator used when a service-data pair is observed
// in multiple records with different retentions: pick the strongest.
// Order: StorageOver48Hours > StorageUnder48Hours > ProcessingNoStorage > "".
function retentionWeight(r: Retention): number {
  switch (r) {
    case "StorageOver48Hours":
      return 3;
    case "StorageUnder48Hours":
      return 2;
    case "ProcessingNoStorage":
      return 1;
    default:
      return 0;
  }
}



// Coerces an arbitrary value to a trimmed string; returns "" for null /
// undefined / non-strings. Keeps the parser tolerant of partial records.
function asStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

export interface PrivExpParseError extends Error {
  isPrivExpParseError: true;
}

function err(message: string): never {
  const e = new Error(message) as PrivExpParseError;
  e.isPrivExpParseError = true;
  throw e;
}

export function parsePrivExp(text: string): ParsedPrivExp {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    err(
      `File is not valid JSON: ${
        (e as Error).message ?? "(no message)"
      }`,
    );
  }

  let records: unknown[];
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (
    parsed != null &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { data?: unknown }).data)
  ) {
    records = (parsed as { data: unknown[] }).data;
  } else {
    err(
      "File does not look like a PMEXP inventory — expected a JSON " +
        "array, or an object with a top-level `data` array.",
    );
  }

  // groupIndex preserves first-seen order so the dialog shows services
  // in the order they first appear in the file.
  const groupIndex = new Map<string, ServiceGroup>();
  const groups: ServiceGroup[] = [];
  // Per-group dedup of (name|classification) pairs across records.
  const seenItemKey = new Map<string, Map<string, ParsedDataItem>>();
  let unknownCount = 0;

  // Helper: get-or-create a ServiceGroup for the given reference,
  // anchoring it to the first-seen serviceName for stability.
  const ensureGroup = (
    key: string,
    serviceId: string,
    canonicalServiceId: string,
    serviceName: string,
  ): ServiceGroup => {
    let g = groupIndex.get(key);
    if (g) return g;
    g = {
      serviceId,
      canonicalServiceId,
      key,
      serviceName: serviceName || "(unnamed service)",
      items: [],
    };
    groupIndex.set(key, g);
    groups.push(g);
    seenItemKey.set(key, new Map());
    return g;
  };

  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const primaryServiceId = asStr(r.serviceId);
    if (!primaryServiceId) continue;
    const primaryCanonical = primaryServiceId.toLowerCase();
    const primaryName = asStr(r.serviceName) || "(unnamed service)";
    const primaryKey = primaryCanonical || `name:${primaryName.toLowerCase()}`;
    ensureGroup(primaryKey, primaryServiceId, primaryCanonical, primaryName);

    const elementName = asStr(r.elementName) || "(unnamed element)";
    const sample = asStr(r.sampleData);
    const rawClassification = asStr(r.dataClassification);
    const rawRetention = asStr(r.dataRetainDuration);
    const rawBoundary = asStr(r.dataStoreBoundary);
    const rawStoreDep = asStr(r.storeDependency);
    const rawProcessDep = asStr(r.processDependency);
    const rawDownstreamDep = asStr(r.downstreamDependency);

    const { classifications, hadUnknown } =
      mapClassification(rawClassification);
    if (hadUnknown) unknownCount++;
    const multi = classifications.length > 1;

    // Parse the three dependency lists. Storage-set is the union of keys
    // mentioned in storeDependency (which lists where the data is
    // actually persisted).
    const storeDeps = parseDependencyList(rawStoreDep);
    const processDeps = parseDependencyList(rawProcessDep);
    const downstreamDeps = parseDependencyList(rawDownstreamDep);
    const storeKeys = new Set(storeDeps.map((d) => d.key));

    // Build the set of services involved in this record (primary +
    // every dependency mention). Map<key, DependencyEntry> dedups
    // mentions that appear in multiple dependency columns.
    const involved = new Map<string, DependencyEntry>();
    involved.set(primaryKey, {
      canonicalServiceId: primaryCanonical,
      serviceId: primaryServiceId,
      serviceName: primaryName,
      key: primaryKey,
    });
    for (const dep of [...storeDeps, ...processDeps, ...downstreamDeps]) {
      if (!involved.has(dep.key)) involved.set(dep.key, dep);
    }

    // Did the primary service itself store the data (independent of
    // whether storeDependency listed it)? Use the same boundary
    // heuristic from before.
    const primaryStores = !isNotStoredSentinel(rawBoundary);

    for (const dep of involved.values()) {
      const isStoreHere =
        storeKeys.has(dep.key) ||
        (dep.key === primaryKey && primaryStores);
      const retention: Retention = isStoreHere
        ? timeBucket(rawRetention)
        : "ProcessingNoStorage";

      const group = ensureGroup(
        dep.key,
        dep.serviceId,
        dep.canonicalServiceId,
        dep.serviceName,
      );
      const dedup = seenItemKey.get(dep.key)!;

      for (const cls of classifications) {
        const name = multi ? `${elementName} (${cls})` : elementName;
        const trimmedName = name.trim();
        const dedupKey = `${trimmedName}|${cls}`;
        const existing = dedup.get(dedupKey);
        if (existing) {
          // Same (service, data) seen previously — upgrade retention if
          // this record is more-storage-y, and fill sample if missing.
          if (
            retentionWeight(retention) > retentionWeight(existing.retention)
          ) {
            existing.retention = retention;
            existing.rawRetention = rawRetention;
            existing.rawStoreBoundary = rawBoundary;
          }
          if (!existing.sample && sample) existing.sample = sample;
          continue;
        }
        const item: ParsedDataItem = {
          name: trimmedName,
          classification: cls,
          sample,
          retention,
          rawClassification,
          rawRetention,
          rawStoreBoundary: rawBoundary,
        };
        dedup.set(dedupKey, item);
        group.items.push(item);
      }
    }
  }

  return {
    groups,
    recordCount: records.length,
    unknownClassificationCount: unknownCount,
  };
}
