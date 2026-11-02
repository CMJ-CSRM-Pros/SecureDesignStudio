import {
  AUTH_TYPES,
  AUTH_TYPE_DEFS,
  DATA_CLASSIFICATION_DEFS,
  RETENTION_TYPE_DEFS,
  resolveNodeTypeDef,
  type AllowedDataAction,
  type AllowedDataType,
  type AuthenticationType,
  type AuthTypeDef,
  type DataClassification,
  type NodeTypeDef,
  type NodeTypeRef,
  type PsNode,
  type Retention,
} from "./types";

// Returns the node-type definition for a node, or undefined if the node's
// type is a free-form value that doesn't match any catalog entry.
export function nodeTypeDefFor(
  node: PsNode | undefined,
  nodeTypes?: readonly NodeTypeRef[],
): NodeTypeDef | undefined {
  if (!node) return undefined;
  return resolveNodeTypeDef(node.type, nodeTypes);
}

function curatedPolicyFor(
  node: PsNode | undefined,
  nodeTypes?: readonly NodeTypeRef[],
): NodeTypeDef | undefined {
  const def = nodeTypeDefFor(node, nodeTypes);
  return def?.policyStatus === "Unspecified" ? undefined : def;
}

// Returns the auth-method status on the target node, or undefined if the
// node's type is unknown (in which case all auth methods are implicitly
// allowed) or the auth id isn't listed by the type. A wildcard entry
// (id === "*") acts as the fallback when no explicit entry matches.
export function authMethodStatusOnNode(
  node: PsNode | undefined,
  authId: AuthenticationType,
  nodeTypes?: readonly NodeTypeRef[],
): "Allowed" | "Deprecated" | undefined {
  const def = curatedPolicyFor(node, nodeTypes);
  if (!def) return undefined;
  const exact = def.allowedAuthMethods.find((a) => a.id === authId);
  if (exact) return exact.status;
  const wildcard = def.allowedAuthMethods.find((a) => a.id === "*");
  return wildcard?.status;
}

// Returns the set of auth methods accepted (Allowed or Deprecated) by the
// target node. When the node's type is unknown, every auth method in the
// catalog is allowed. A wildcard entry (id === "*") also expands to every
// catalog method.
export function allowedAuthMethodsForNode(
  node: PsNode | undefined,
  nodeTypes?: readonly NodeTypeRef[],
  catalog: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
): AuthenticationType[] {
  const def = curatedPolicyFor(node, nodeTypes);
  if (!def) return catalog.map(method => method.id);
  if (def.allowedAuthMethods.some((a) => a.id === "*")) return catalog.map(method => method.id);
  return def.allowedAuthMethods
    .map((a) => a.id)
    .filter((id): id is AuthenticationType => id !== "*");
}

// Resolve the policy action for a (classification, retention) pair against a
// rule list. The most specific matching rule wins:
//   specificity score = (id-matches ? 2 : 0) + (retention-matches ? 1 : 0)
// Ties are broken by later position in the array. The required "*"/"*"
// default guarantees there is always at least one match.
export function resolveDataPolicy(
  rules: readonly AllowedDataType[],
  classification: DataClassification,
  retention: Retention
): AllowedDataAction | undefined {
  let bestScore = -1;
  let best: AllowedDataType | undefined;
  for (const rule of rules) {
    const idMatches = rule.id === "*" || rule.id === classification;
    const retentionMatches =
      rule.retention === "*" || rule.retention === retention;
    if (!idMatches || !retentionMatches) continue;
    const score = (rule.id !== "*" ? 2 : 0) + (rule.retention !== "*" ? 1 : 0);
    if (score >= bestScore) {
      bestScore = score;
      best = rule;
    }
  }
  return best?.action;
}

// True if there exists at least one *concrete* retention value (i.e. not the
// "unset" sentinel) under which the target node would Allow this
// classification. Used to decide whether a data item can even be attached.
// Unknown node types are permissive (return true).
export function isClassificationAllowedByNode(
  node: PsNode | undefined,
  classification: DataClassification,
  nodeTypes?: readonly NodeTypeRef[],
): boolean {
  const def = curatedPolicyFor(node, nodeTypes);
  if (!def) return true;
  for (const def_ of RETENTION_TYPE_DEFS) {
    const action = resolveDataPolicy(
      def.allowedDataTypes,
      classification,
      def_.id as Retention
    );
    if (action === "Allow") return true;
  }
  return false;
}

// True if a specific (classification, retention) pair is allowed by the node.
// Unknown node types are permissive.
export function isAttachmentAllowedByNode(
  node: PsNode | undefined,
  classification: DataClassification,
  retention: Retention,
  nodeTypes?: readonly NodeTypeRef[],
): boolean {
  const def = curatedPolicyFor(node, nodeTypes);
  if (!def) return true;
  return resolveDataPolicy(def.allowedDataTypes, classification, retention) === "Allow";
}

// Membership is list-specific, not validation of a saved reference.
export function isKnownClassification(
  v: string, definitions: readonly { id: string }[] = DATA_CLASSIFICATION_DEFS,
): v is DataClassification {
  return definitions.some(definition => definition.id === v);
}
