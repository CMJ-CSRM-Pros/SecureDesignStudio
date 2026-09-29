import type { NodeTypeDef, PsNode } from "./types";
import { DEFAULT_INVENTORY_FIELD, inventoryIdError } from "./inventoryIdentity";

// Blank identities and an unspecified "^$" pattern are absence of supplied
// metadata, not instructions to erase an existing instance value.
export function nodeTypeMetadataDefaults(
  definition: Pick<NodeTypeDef, "serviceTreeId" | "endpointRegex" | "policyStatus"> | undefined,
  inventoryField = DEFAULT_INVENTORY_FIELD,
): {
  values: Partial<Pick<PsNode, "serviceTreeId" | "endpointRegex">>;
  error?: string;
} {
  if (!definition) return { values: {} };
  const identityError = inventoryIdError(definition.serviceTreeId, inventoryField);
  if (identityError) return { values: {}, error: `This type supplies an invalid ${inventoryField.label}. ${identityError}` };
  try { new RegExp(definition.endpointRegex); }
  catch {
    return { values: {}, error: "This type supplies an invalid endpoint expression. Edit its definition before applying metadata defaults." };
  }
  return { values: {
    ...(definition.serviceTreeId.trim() ? { serviceTreeId: definition.serviceTreeId } : {}),
    ...(definition.endpointRegex.trim()
        && (definition.policyStatus !== "Unspecified" || definition.endpointRegex.trim() !== "^$")
      ? { endpointRegex: definition.endpointRegex } : {}),
  } };
}
