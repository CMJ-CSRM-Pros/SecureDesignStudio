import { isGuid } from "./types";
import type { MetadataField } from "./libraries/contracts";

export const DEFAULT_INVENTORY_FIELD: MetadataField = Object.freeze({
  id: "serviceTreeId", target: "node", storage: "serviceTreeId", label: "Inventory ID",
});

export function inventoryFieldFor(fields: readonly MetadataField[]): MetadataField {
  return fields.find(field => field.target === "node" && field.storage === "serviceTreeId") ?? DEFAULT_INVENTORY_FIELD;
}

export function inventoryIdError(value: unknown, field = DEFAULT_INVENTORY_FIELD): string | undefined {
  if (typeof value !== "string" || value.length > 4000 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return `${field.label} must be text of at most 4000 characters without control characters.`;
  }
  if (value.trim() && field.validation === "guid" && !isGuid(value)) return `${field.label} must be a GUID or blank.`;
  return undefined;
}
