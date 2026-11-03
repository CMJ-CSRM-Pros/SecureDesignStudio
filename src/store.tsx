import { SERVICES } from "./services";
import { normalizeWorkItem } from "./workItems";
import { normalizeTextAnnotations, normalizeTextAnnotationIds } from "./textAnnotations";
import type { PsTextAnnotation } from "./types";
import { normalizeDfdValue, normalizeNodeScope, resolveNodeReviewScope } from "./dfdSemantics";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ChangeItem, ChangeTarget } from "./diff";
import type { AssistantAnalysisSnapshot, AssistantFinding } from "./designAssistant";
import { propagateScenarioEdgeData } from "./dataPropagation";
import { applyDesignerResult, buildDesignerContext, buildDesignPlanContext, designerDocumentKey, describeDesignerChanges, type DesignRequestSnapshot } from "./threatModelDesigner";
import { loadAutosaveRaw, saveAutosave } from "./autosave";
import { useUiShell } from "./uiShell";
import { resetDetailsTab } from "./components/detailsTabStore";
import type { ParsedPrivExp } from "./privacyManagerImport";
import { readEmbeddedDoc } from "./embeddedDoc";
import { mergeCatalogDefinitions, referencedCatalogDefinitions, validateCatalogDefinitions, withCatalogDefinitions } from "./catalogDefinitions";
import {
  classificationDefinitionsForLibrary, isEnabledClassification, loadClassificationLibrary,
  classificationReferencesInDocument, exportClassificationCatalog,
  persistClassificationLibrary, repairClassificationLibrary, validateClassificationLibrary,
  type ClassificationLibrary,
} from "./classificationLibrary";
import {
  SECURE_DESIGN_STUDIO_DOCUMENT_FORMAT,
  SECURE_DESIGN_STUDIO_NODE_CATALOG_FORMAT,
} from "./documentFormat";
import { useCollab, type CollabState } from "./collab/useCollab";
import { calculateScenarioDeletionImpact } from "./scenarioDeletion";
import {
  AUTH_TYPES,
  AUTH_TYPE_DEFS,
  AUTH_TYPE_LABELS,
  DATA_CLASSIFICATIONS,
  DATA_CLASSIFICATION_DEFS,
  DATA_CLASSIFICATION_LABELS,
  NODE_TYPE_DEFS,
  NODE_TYPE_DEF_MAP,
  PRIVACY_BOUNDARY_TYPE_DEFS,
  PRIVACY_BOUNDARY_TYPE_LABELS,
  SECURITY_BOUNDARY_TYPE_DEFS,
  SECURITY_BOUNDARY_TYPE_LABELS,
  BOUNDARY_NETWORK_FIELDS,
  normalizeBoundaryNetworkText,
  GEO_BOUNDARY_SETTING_DEFS,
  GEO_BOUNDARY_SETTING_DEF_MAP,
  GEO_BOUNDARY_SETTING_LABELS,
  POST_SUBSCRIPTION_RETENTION_DEFS,
  POST_SUBSCRIPTION_RETENTION_DEF_MAP,
  POST_SUBSCRIPTION_RETENTION_LABELS,
  GDPR_HANDLING_DEFS,
  GDPR_HANDLING_DEF_MAP,
  GDPR_HANDLING_LABELS,
  PRODUCTION_IDENTITY_TENANT_DEFS,
  PRODUCTION_IDENTITY_TENANT_LABELS,
  AUTH_TYPES_REQUIRING_PRODUCTION_IDENTITY,
  edgeRequiresApplicationId,
  edgeRequiresProductionIdentity,
  isCatalogReferenceId,
  assertCatalogSelection,
  isGuid,
  formatProductionIdentity,
  canonicalProductionIdentity,
  normalizeRequiredAccessRights,
  productionIdentityTenantLabel,
  type ProductionIdentity,
  type ProductionIdentityTenant,
  type AuthenticationType,
  type CommentReply,
  type CommentStatus,
  type DataClassification,
  type CatalogDefinitionSnapshot,
  type DeviationSampleCall,
  type DeviationKind,
  type DeviationStatus,
  type EdgeDataDirection,
  type GeoBoundarySetting,
  type IssueReply,
  type IssueStatus,
  type PostSubscriptionRetention,
  type NodeTypeDefinition,
  type NodeTypeRef,
  type PsBoundary,
  type PsComment,
  type PsData,
  type PsDeviation,
  type PsDocument,
  type PsEdge,
  type PsIssue,
  type PsNode,
  type Position,
  type Retention,
  type Scenario,
  type Size,
  type Waypoint,
  type PsWorkItem,
  RETENTION_TYPES,
  emptyNodeTypeDefinition,
  emptyDocument,
  resolveNodeTypeDef,
  uid,
} from "./types";
import { IssueManager } from "./IssueManager";
import { normalizeIssueNotEvaluatedReason } from "./types";
import { isAuthoredThreatNote, removeThreatNoteScenario, threatNoteFields, validateThreatNotes } from "./threatNotes";
import { safeNavigationHref } from "./urlSafety";
import { useLibraries } from "./libraries/LibraryProvider";
import { libraryNodeTypes, withLibraryDefinitions } from "./libraries/document";
import { validateAiDesignGuidance, validateNodeTypeGuidanceEntries, type AiDesignGuidance } from "../shared/aiDesignGuidance";
import { withNodeTypeGuidance } from "./aiDesignGuidance";
import { normalizeEntityMetadata } from "./libraries/validation";
import { inventoryIdError, inventoryFieldFor } from "./inventoryIdentity";
import { allowedAuthMethodsForNode } from "./policy";
import {
  authenticationCatalogFor, authenticationCompatibilityFor, authenticationReferences, authenticationWarnings,
  builtInAuthentication, installedAuthentication, isPackageAuthenticationId, authenticationUnavailableReason,
  assertInstalledAuthenticationContracts, validatePortableAuthenticationDefinitions,
  isAuthenticationType, loadAuthenticationLibrary,
  mergeAuthenticationLibrary, normalizeAuthenticationValue, parseAuthenticationCatalog,
  persistAuthenticationLibrary, sameAuthenticationDefinition, validateAuthenticationDefinitions,
  withAuthenticationDefinitions, withAuthenticationGuidance, UNKNOWN_AUTH_BEHAVIOR,
  type AuthTypeDef, type AuthenticationCompatibility,
} from "./authentication";
import {
  loadProtocolLibrary, persistProtocolLibrary, validateProtocolDefinitions, validateProtocolReference,
  resolveProtocolReference, withProtocolDefinitions,
  type ProtocolTypeDef,
} from "./protocols";
import {
  DEFAULT_NODE_SIZE,
  boundaryRect,
  clampRectInside,
  expandRectToContain,
  nodeRect,
  overlapRatio,
  placeNodeOutsideBoundary,
} from "./boundaryGeometry";

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "boundary"; id: string }
  | { kind: "annotation"; id: string }
  | { kind: "waypoint"; edgeId: string; waypointId: string }
  | null;

export interface FilterState {
  text: string;
  nodeType: string;
  authType: AuthenticationType | "";
  dataClassification: DataClassification | "";
}

const emptyFilter: FilterState = {
  text: "",
  nodeType: "",
  authType: "",
  dataClassification: "",
};

function normalizeFilterState(
  doc: PsDocument,
  value: unknown,
): FilterState {
  if (!value || typeof value !== "object") return { ...emptyFilter };
  const filter = value as Partial<FilterState>;
  const validNodeTypeIds = new Set(doc.nodeTypes.map((type) => type.id));
  return {
    text: typeof filter.text === "string" ? filter.text : "",
    nodeType:
      typeof filter.nodeType === "string" &&
      validNodeTypeIds.has(filter.nodeType)
        ? filter.nodeType
        : "",
    authType:
      typeof filter.authType === "string" &&
      isAuthenticationType(filter.authType)
        ? (filter.authType as FilterState["authType"])
        : "",
    dataClassification:
      isCatalogReferenceId(filter.dataClassification)
        ? filter.dataClassification
        : "",
  };
}

function adoptNodeIntoOverlappingBoundaries(
  nodes: PsNode[],
  boundaries: PsBoundary[],
  nodeId: string,
  candidateBoundaryIds?: ReadonlySet<string>,
): { nodes: PsNode[]; boundaries: PsBoundary[] } {
  const nodeIndex = nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex < 0) return { nodes, boundaries };

  let node = nodes[nodeIndex];
  let nextBoundaries = boundaries;
  const memberships = new Set(
    boundaries
      .filter((boundary) => boundary.nodeIds.includes(nodeId))
      .map((boundary) => boundary.id),
  );

  for (let index = 0; index < nextBoundaries.length; index += 1) {
    const boundary = nextBoundaries[index];
    if (candidateBoundaryIds && !candidateBoundaryIds.has(boundary.id)) continue;
    if (memberships.has(boundary.id)) continue;
    if (overlapRatio(nodeRect(node), boundaryRect(boundary)) <= 0.5) continue;

    memberships.add(boundary.id);
    let nextBoundary = boundary;
    if (
      boundary.size.width < (node.size ?? DEFAULT_NODE_SIZE).width ||
      boundary.size.height < (node.size ?? DEFAULT_NODE_SIZE).height
    ) {
      const expanded = expandRectToContain(boundaryRect(boundary), nodeRect(node));
      nextBoundary = {
        ...boundary,
        position: expanded.position,
        size: expanded.size,
        nodeIds: [...boundary.nodeIds, nodeId],
      };
    } else {
      node = {
        ...node,
        position: clampRectInside(nodeRect(node), boundaryRect(boundary)),
      };
      nextBoundary = {
        ...boundary,
        nodeIds: [...boundary.nodeIds, nodeId],
      };
    }
    nextBoundaries = nextBoundaries.map((item, itemIndex) =>
      itemIndex === index ? nextBoundary : item,
    );
  }

  nextBoundaries = nextBoundaries.map((boundary) => {
    if (!memberships.has(boundary.id)) return boundary;
    const expanded = expandRectToContain(boundaryRect(boundary), nodeRect(node));
    return {
      ...boundary,
      position: expanded.position,
      size: expanded.size,
      nodeIds: boundary.nodeIds.includes(nodeId)
        ? boundary.nodeIds
        : [...boundary.nodeIds, nodeId],
    };
  });

  const nextNodes =
    node === nodes[nodeIndex]
      ? nodes
      : nodes.map((item, index) => (index === nodeIndex ? node : item));
  return { nodes: nextNodes, boundaries: nextBoundaries };
}

function adoptNodesIntoBoundary(
  nodes: PsNode[],
  boundaries: PsBoundary[],
  boundaryId: string,
): { nodes: PsNode[]; boundaries: PsBoundary[] } {
  let nextNodes = nodes;
  let nextBoundaries = boundaries;
  const candidates = new Set([boundaryId]);
  for (const node of nodes) {
    const adopted = adoptNodeIntoOverlappingBoundaries(
      nextNodes,
      nextBoundaries,
      node.id,
      candidates,
    );
    nextNodes = adopted.nodes;
    nextBoundaries = adopted.boundaries;
  }
  return { nodes: nextNodes, boundaries: nextBoundaries };
}

function normalizeNodeTypeDefinition(
  value: unknown,
): NodeTypeDefinition | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const fallback = emptyNodeTypeDefinition();
  const aiDesignGuidance = validateAiDesignGuidance(raw.aiDesignGuidance);

  const endpointCandidate =
    typeof raw.endpointRegex === "string" &&
    raw.endpointRegex.length <= 1000
      ? raw.endpointRegex.trim()
      : "^$";
  let endpointRegex = "^$";
  try {
    new RegExp(endpointCandidate);
    endpointRegex = endpointCandidate || "^$";
  } catch {
    endpointRegex = "^$";
  }

  const allowedAuthMethods = Array.isArray(raw.allowedAuthMethods)
    ? raw.allowedAuthMethods.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const auth = entry as Record<string, unknown>;
        const id = typeof auth.id === "string" ? auth.id : "";
        const status = auth.status;
        if (
          (id === "*" || isAuthenticationType(id)) &&
          (status === "Allowed" || status === "Deprecated")
        ) {
          return [
            {
              id: id as AuthenticationType | "*",
              status: status as "Allowed" | "Deprecated",
            },
          ];
        }
        return [];
      })
    : [];

  const allowedDataTypes = Array.isArray(raw.allowedDataTypes)
    ? raw.allowedDataTypes.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const rule = entry as Record<string, unknown>;
        const id = typeof rule.id === "string" ? rule.id : "";
        const retention =
          typeof rule.retention === "string" ? rule.retention : "";
        const action = rule.action;
        if (
          (id === "*" || isCatalogReferenceId(id)) &&
          (retention === "*" ||
            (RETENTION_TYPES as readonly string[]).includes(retention)) &&
          (action === "Allow" || action === "Deny")
        ) {
          return [
            {
              id: id as DataClassification | "*",
              retention: retention as Retention | "*",
              action: action as "Allow" | "Deny",
            },
          ];
        }
        return [];
      })
    : [];

  const hasFallback =
    allowedDataTypes.filter(
      (rule) => rule.id === "*" && rule.retention === "*",
    ).length === 1;
  const policyStatus =
    raw.policyStatus === "Unspecified" || !hasFallback
      ? "Unspecified"
      : undefined;

  const gdprIds = new Set(GDPR_HANDLING_DEFS.map((def) => def.id));
  const defaultPrivacyBoundary =
    isCatalogReferenceId(raw.defaultPrivacyBoundary)
      ? raw.defaultPrivacyBoundary
      : undefined;
  const gdprId =
    raw.gdprHandling &&
    typeof raw.gdprHandling === "object" &&
    typeof (raw.gdprHandling as Record<string, unknown>).id === "string"
      ? ((raw.gdprHandling as Record<string, unknown>).id as string)
      : "";

  const icon =
    typeof raw.icon === "string" &&
    !raw.icon.includes("..") &&
    /^[a-z0-9][a-z0-9._/-]*\.svg$/i.test(raw.icon)
      ? raw.icon
      : fallback.icon;
  const documentationUrl =
    typeof raw.documentationUrl === "string" &&
    /^https?:\/\//i.test(raw.documentationUrl)
      ? raw.documentationUrl
      : undefined;
  const rawGeo =
    raw.geoBoundary && typeof raw.geoBoundary === "object"
      ? (raw.geoBoundary as Record<string, unknown>)
      : null;
  const geoId = typeof rawGeo?.id === "string" ? rawGeo.id : "";
  let geoBoundary: GeoBoundarySetting | undefined;
  if (geoId === "DataKeptInGeo") {
    geoBoundary = { id: "DataKeptInGeo" };
  } else if (geoId === "DataKeptInGeoUnlessIndicatedByCaller") {
    geoBoundary = { id: "DataKeptInGeoUnlessIndicatedByCaller" };
  } else if (geoId === "DataNotKeptInGeo") {
    geoBoundary = { id: "DataNotKeptInGeo" };
  } else if (
    geoId === "DataKeptInGeoUnlessCustomerAllowsXGeo" &&
    typeof rawGeo?.description === "string" &&
    rawGeo.description.trim()
  ) {
    geoBoundary = {
      id: "DataKeptInGeoUnlessCustomerAllowsXGeo",
      description: rawGeo.description.trim(),
    };
  }

  const rawRetention =
    raw.postSubscriptionRetention &&
    typeof raw.postSubscriptionRetention === "object"
      ? (raw.postSubscriptionRetention as Record<string, unknown>)
      : null;
  if (geoBoundary && typeof rawGeo?.description === "string" && rawGeo.description.trim()) {
    geoBoundary = { ...geoBoundary, description: rawGeo.description.trim() };
  }
  let postSubscriptionRetention: PostSubscriptionRetention | undefined;
  if (rawRetention?.id === "ControlledByCallingService") {
    postSubscriptionRetention = { id: "ControlledByCallingService" };
  } else if (rawRetention?.id === "RetainedDaysRange") {
    const minDays = Number(rawRetention.minDays);
    const maxDays = Number(rawRetention.maxDays);
    if (
      Number.isInteger(minDays) &&
      Number.isInteger(maxDays) &&
      minDays >= 0 &&
      maxDays >= minDays
    ) {
      postSubscriptionRetention = {
        id: "RetainedDaysRange",
        minDays,
        maxDays,
      };
    }
  }

  return {
    ...(aiDesignGuidance ? { aiDesignGuidance } : {}),
    ...(raw.defaultDfdRole !== undefined ? { defaultDfdRole: normalizeDfdValue(raw.defaultDfdRole, 128) } : {}),
    serviceTreeId:
      typeof raw.serviceTreeId === "string" &&
      !inventoryIdError(raw.serviceTreeId)
        ? raw.serviceTreeId.trim()
        : "",
    endpointRegex,
    templateHints: Array.isArray(raw.templateHints)
      ? [
          ...new Set(
            raw.templateHints
              .filter((hint): hint is string => typeof hint === "string")
              .map((hint) => hint.trim())
              .filter(Boolean),
          ),
        ]
      : [],
    allowedAuthMethods,
    allowedDataTypes: policyStatus ? [] : allowedDataTypes,
    policyStatus,
    category:
      typeof raw.category === "string" && raw.category.trim()
        ? raw.category.trim()
        : "Custom",
    catalogSource: "Document",
    resourceProviders: Array.isArray(raw.resourceProviders)
      ? [
          ...new Set(
            raw.resourceProviders
              .filter(
                (provider): provider is string =>
                  typeof provider === "string",
              )
              .map((provider) => provider.trim())
              .filter(Boolean),
          ),
        ]
      : [],
    documentationUrl,
    icon,
    defaultPrivacyBoundary,
    geoBoundary,
    postSubscriptionRetention,
    gdprHandling: gdprIds.has(gdprId)
      ? ({ id: gdprId } as NodeTypeDefinition["gdprHandling"])
      : undefined,
    description:
      typeof raw.description === "string" ? raw.description : "",
  };
}

function applyNodeTypeMetadata(
  nodes: readonly PsNode[],
  id: string,
  previous: Pick<NodeTypeDefinition, "serviceTreeId" | "endpointRegex"> | undefined,
  next: Pick<NodeTypeDefinition, "serviceTreeId" | "endpointRegex">,
): PsNode[] {
  return nodes.map((node) => {
    if (node.type !== id) return node;
    if (!previous) {
      return {
        ...node,
        endpointRegex: node.endpointRegex.trim()
          ? node.endpointRegex
          : next.endpointRegex,
        serviceTreeId: node.serviceTreeId.trim()
          ? node.serviceTreeId
          : next.serviceTreeId,
      };
    }
    return {
      ...node,
      endpointRegex:
        node.endpointRegex === previous.endpointRegex
          ? next.endpointRegex
          : node.endpointRegex,
      serviceTreeId:
        node.serviceTreeId === previous.serviceTreeId
          ? next.serviceTreeId
          : node.serviceTreeId,
    };
  });
}

// Drop the given edge id from both request and response data buckets on a
// scenario. Used by bulk operations (delete node, delete edge, remove edge
// from scenario, remove node from scenario) that need to clean up data
// attachments for edges that are going away.
function pruneEdgesFromScenarioBuckets(
  s: Scenario,
  edgesToRemove: Set<string>,
): { edgeRequestData: Record<string, string[]>; edgeResponseData: Record<string, string[]> } {
  const edgeRequestData: Record<string, string[]> = {};
  for (const [eid, ids] of Object.entries(s.edgeRequestData)) {
    if (!edgesToRemove.has(eid)) edgeRequestData[eid] = ids;
  }
  const edgeResponseData: Record<string, string[]> = {};
  for (const [eid, ids] of Object.entries(s.edgeResponseData)) {
    if (!edgesToRemove.has(eid)) edgeResponseData[eid] = ids;
  }
  return { edgeRequestData, edgeResponseData };
}

// Decision per service when importing a Privacy Manager data inventory:
// reuse an existing node, create a new node (titled from the service
// name), or skip the service entirely.
export type ServiceImportDecision =
  | { kind: "use-existing"; nodeId: string }
  | { kind: "create-new" }
  | { kind: "ignore" };

// Re-exported so callers can pass the parser output without separately
// importing the type.
export type ImportPrivacyManagerInput = ParsedPrivExp;

// Summary returned by `importPrivacyManagerData` for the post-import
// confirmation alert.
export interface ImportPrivacyManagerSummary {
  servicesMapped: number;
  servicesCreated: number;
  servicesIgnored: number;
  dataItemsCreated: number;
  dataItemsReused: number;
  attachmentsAdded: number;
  attachmentsSkipped: number;
}

interface StoreApi {
  doc: PsDocument;
  documentSessionId: number;
  prepareThreatModelDesign: (scope?: readonly string[], protocolScope?: readonly string[], authenticationScope?: readonly string[]) => DesignRequestSnapshot;
  prepareThreatModelDesignPlan: () => ReturnType<typeof buildDesignPlanContext>;
  applyThreatModelDesign: (result: unknown, expected: DesignRequestSnapshot) => { scenarioId: string | null; changed: boolean; summary: string; warning?: string; partial?: boolean };
  authenticationLibrary: readonly AuthTypeDef[];
  protocolLibrary: readonly ProtocolTypeDef[];
  protocolStorageError: string | null;
  applyProtocolLibrary: (next: readonly ProtocolTypeDef[], expected: readonly ProtocolTypeDef[]) => void;
  useLibraryProtocolDefinition: (id: string) => void;
  authenticationCatalog: readonly AuthTypeDef[];
  authenticationWarnings: string[];
  authenticationCompatibility: AuthenticationCompatibility | null;
  authenticationStorageError: string | null;
  catalogSnapshotError: string | null;
  documentRecoveryError: string | null;
  classificationLibrary: ClassificationLibrary;
  classificationDefinitions: readonly CatalogDefinitionSnapshot[];
  availableCatalogDefinitions: readonly CatalogDefinitionSnapshot[];
  nodeTypeCatalog: readonly NodeTypeRef[];
  classificationLibrarySource: "shipped" | "profile" | "configured library";
  classificationStorageError: string | null;
  classificationRecoveryRaw: string | null;
  applyClassificationLibrary: (next: ClassificationLibrary, expected: ClassificationLibrary, repairRaw?: string) => void;
  classificationDeleteReason: (id: string) => string | null;
  deleteClassification: (id: string, expected: ClassificationLibrary) => void;
  useLibraryClassificationDefinition: (id: string, expected: ClassificationLibrary) => void;
  saveAuthenticationMethod: (method: { id: string; label: string; description: string; aiDesignGuidance?: AiDesignGuidance }) => void;
  saveAuthenticationGuidance: (id: string, guidance: AiDesignGuidance | undefined, expectedDefinition?: AuthTypeDef) => void;
  setAuthenticationMethodDisabled: (id: string, disabled: boolean) => void;
  deleteAuthenticationMethod: (id: string) => void;
  resetAuthenticationMethod: (id: string) => void;
  importAuthenticationCatalog: (data: unknown) => void;
  useLibraryAuthenticationDefinition: (id: string) => void;
  activeScenarioId: string | null;
  setActiveScenarioId: (id: string | null) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  // Additional node/boundary IDs selected beyond `selection` (multi-select via
  // Ctrl/Cmd + click). Edges are never included — the requirement is that
  // edges are not multiselectable.
  multiSelectedIds: string[];
  // Toggle a node/boundary in the multi-selection. If `id` matches the
  // current single selection, that selection is cleared (and, if the multi
  // set is non-empty, another id is promoted to the single selection so the
  // side panel still has a focus). Otherwise, adds or removes `id` from the
  // additional set.
  toggleAdditionalSelection: (kind: "node" | "boundary" | "annotation", id: string) => void;
  clearMultiSelection: () => void;
  filter: FilterState;
  setFilter: (f: Partial<FilterState>) => void;
  clearFilter: () => void;
  // Which edge is currently in inline-title-edit mode. Lives in the store so
  // it survives FlowEdge remounts (React Flow + StrictMode remounts the edge
  // component on every selection/render churn).
  editingEdgeTitleId: string | null;
  setEditingEdgeTitleId: (id: string | null) => void;
  // Live value of the edge-title editor — also store-backed so the user's
  // in-progress typing isn't lost when FlowEdge transiently remounts.
  editingEdgeTitleValue: string;
  setEditingEdgeTitleValue: (value: string) => void;
  // Latest AI Analysis findings. Store-backed because SidePanel unmounts the
  // whole inspector when it is dismissed, which would otherwise discard the
  // results, and because the inspector tab badge counts them.
  assistantFindings: AssistantFinding[];
  setAssistantFindings: Dispatch<SetStateAction<AssistantFinding[]>>;
  assistantAnalysis: AssistantAnalysisSnapshot | null;
  setAssistantAnalysis: Dispatch<SetStateAction<AssistantAnalysisSnapshot | null>>;
  // Findings already accepted into Issues or Work Items. Kept beside the
  // findings themselves so a dismissed inspector cannot re-enable the accept
  // buttons and let the same finding be added twice.
  acceptedFindingIds: ReadonlySet<string>;
  setAcceptedFindingIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  // Right-pane "all comments" view (replaces the normal SidePanel when on).
  allCommentsViewOpen: boolean;
  setAllCommentsViewOpen: (open: boolean) => void;
  // Right-pane "all issues" view (replaces the normal SidePanel when on).
  // Mutually exclusive with allCommentsViewOpen — opening one closes the
  // other.
  allIssuesViewOpen: boolean;
  setAllIssuesViewOpen: (open: boolean) => void;
  // Right-pane "Compare to previous" view. Hosts the diff result against a
  // previously-uploaded version of the document. Mutually exclusive with
  // allCommentsViewOpen / allIssuesViewOpen.
  diffViewOpen: boolean;
  setDiffViewOpen: (open: boolean) => void;
  diffChanges: ChangeItem[];
  diffFileName: string | null;
  // The change currently focused inside the diff panel (for visual highlight
  // and split-pane detail rendering). Cleared automatically when the diagram
  // selection drifts away from the change's target.
  diffSelectedTarget: ChangeTarget | null;
  setDiffSelectedTarget: (target: ChangeTarget | null) => void;
  loadDiff: (changes: ChangeItem[], fileName: string) => void;
  clearDiff: () => void;
  // One-shot "please pan/zoom the diagram to this target." DiagramCanvas
  // consumes and clears it.
  focusTarget: { kind: "node" | "edge" | "boundary" | "annotation"; id: string } | null;
  setFocusTarget: (target: { kind: "node" | "edge" | "boundary" | "annotation"; id: string } | null) => void;
  // Which visualisation of the underlying graph data is shown in the main
  // canvas area. Pure UI state — not persisted to the document, not
  // undoable. The data model is always the graph; "sequence" is just an
  // alternate read-only-ish rendering of the same nodes/edges.
  viewMode: "graph" | "sequence";
  setViewMode: (mode: "graph" | "sequence") => void;

  // Nodes
  createNode: (position: Position) => PsNode;
  updateNode: (id: string, patch: Partial<PsNode>) => void;
  setNodeScopeReason: (scenarioId: string, nodeId: string, reason: string, editSession?: symbol) => void;
  deleteNode: (id: string) => void;
  moveNode: (id: string, position: Position) => void;
  finishNodeMove: (id: string, position: Position, size: Size) => void;
  setNodeSize: (id: string, size: Size) => void;
  moveDiagramItems: (
    moves: Array<{
      id: string;
      kind: "node" | "boundary" | "annotation";
      position: Position;
      size?: Size;
    }>,
    finished: boolean,
  ) => void;

  // Edges
  createEdge: (
    source: string,
    target: string,
    sourceHandle?: string,
    targetHandle?: string
  ) => PsEdge | null;
  updateEdge: (id: string, patch: Partial<PsEdge>) => void;
  deleteEdge: (id: string) => void;

  // Edge waypoints
  addEdgeWaypoint: (edgeId: string, index: number, pos: Position) => Waypoint | null;
  updateEdgeWaypoint: (edgeId: string, waypointId: string, pos: Position) => void;
  removeEdgeWaypoint: (edgeId: string, waypointId: string) => void;

  // Data items
  createData: (classification?: DataClassification) => PsData;
  updateData: (id: string, patch: Partial<PsData>) => void;
  deleteData: (id: string) => void;

  // Security work items (free-standing catalog).
  createWorkItem: (initial?: Pick<PsWorkItem, "title" | "description" | "severity" | "workItemType" | "weaknessType">) => PsWorkItem;
  getCurrentWorkItem: (id: string) => PsWorkItem | undefined;
  updateWorkItem: (id: string, patch: Partial<PsWorkItem>) => void;
  deleteWorkItem: (id: string) => void;

  // Data attachments (per-scenario)
  attachDataToNode: (
    scenarioId: string,
    nodeId: string,
    dataId: string,
    retention?: Retention
  ) => void;
  detachDataFromNode: (
    scenarioId: string,
    nodeId: string,
    dataId: string
  ) => void;
  setNodeDataRetention: (
    scenarioId: string,
    nodeId: string,
    dataId: string,
    retention: Retention
  ) => void;
  attachDataToEdge: (
    scenarioId: string,
    edgeId: string,
    direction: EdgeDataDirection,
    dataId: string
  ) => void;
  detachDataFromEdge: (
    scenarioId: string,
    edgeId: string,
    direction: EdgeDataDirection,
    dataId: string
  ) => void;

  // Processing actions
  propagateEdgeDataToNodes: (scenarioId: string) => void;

  // Comments
  addComment: (
    scenarioId: string,
    targetKind: "node" | "edge",
    targetId: string,
    text: string
  ) => PsComment;
  updateCommentText: (commentId: string, text: string) => void;
  setCommentStatus: (commentId: string, status: CommentStatus) => void;
  deleteComment: (commentId: string) => void;
  addCommentReply: (commentId: string, text: string) => CommentReply | null;
  updateCommentReply: (
    commentId: string,
    replyId: string,
    text: string
  ) => void;
  deleteCommentReply: (commentId: string, replyId: string) => void;

  // Issues
  addIssue: (
    targetKind: "node" | "edge",
    targetId: string,
    scenarioIds: string[],
    title: string,
    description: string,
    threatNote?: { origin: "authored-threat"; justification?: string },
    guidanceReferences?: PsIssue["guidanceReferences"]
  ) => PsIssue;
  updateIssue: (
    id: string,
    patch: Partial<Pick<PsIssue, "title" | "description" | "scenarioIds" | "justification">>
  ) => void;
  setIssueStatus: (id: string, status: IssueStatus) => void;
  deleteIssue: (id: string) => void;
  addIssueReply: (issueId: string, text: string) => IssueReply | null;
  updateIssueReply: (issueId: string, replyId: string, text: string) => void;
  deleteIssueReply: (issueId: string, replyId: string) => void;
  // Deviations
  addDeviation: (
    input: Omit<PsDeviation, "id" | "createdAt" | "updatedAt">
  ) => PsDeviation;
  upsertDeviation: (
    input: Omit<PsDeviation, "id" | "createdAt" | "updatedAt">
  ) => PsDeviation;
  updateDeviation: (
    id: string,
    patch: Partial<
      Pick<
        PsDeviation,
        | "key"
        | "kind"
        | "title"
        | "description"
        | "explanation"
        | "evidenceIds"
        | "targetKind"
        | "targetId"
        | "scenarioIds"
      >
    >
  ) => void;
  setDeviationStatus: (id: string, status: DeviationStatus) => void;
  deleteDeviation: (id: string) => void;
  // Runs the analyzer: propagates edge data to nodes and reconciles typed
  // issues against the current state of the diagram. Returns the number of
  // active typed issues found after the pass (callers can show "no issues
  // found" UX based on this).
  analyze: () => number;

  // Boundaries
  createBoundary: (
    type: "security" | "privacy",
    position: Position,
    size: Size
  ) => PsBoundary;
  updateBoundary: (id: string, patch: Partial<PsBoundary>) => void;
  deleteBoundary: (id: string) => void;
  moveBoundary: (id: string, position: Position) => void;
  finishBoundaryMove: (id: string) => void;
  resizeBoundary: (id: string, size: Size, position?: Position) => void;
  finishBoundaryResize: (id: string) => void;
  removeNodeFromBoundary: (nodeId: string, boundaryId: string) => void;

  // Scenarios
  createScenario: (name: string, description?: string) => Scenario;
  cloneScenario: (
    sourceId: string,
    name: string,
    description?: string
  ) => Scenario | null;
  renameScenario: (id: string, name: string) => void;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  deleteScenario: (id: string) => void;
  addNodeToScenario: (scenarioId: string, nodeId: string) => void;
  removeNodeFromScenario: (scenarioId: string, nodeId: string) => void;
  addEdgeToScenario: (scenarioId: string, edgeId: string) => void;
  removeEdgeFromScenario: (scenarioId: string, edgeId: string) => void;
  addBoundaryToScenario: (scenarioId: string, boundaryId: string) => void;
  removeBoundaryFromScenario: (scenarioId: string, boundaryId: string) => void;
  moveEdgeInScenario: (
    scenarioId: string,
    edgeId: string,
    direction: -1 | 1
  ) => void;
  setEdgeNumberInScenario: (
    scenarioId: string,
    edgeId: string,
    num: number
  ) => void;
  renumberScenario: (scenarioId: string) => void;

  // Node types
  // Add a user-defined node type by label. Returns the id assigned to the
  // entry — a random uid("nt") for new labels, or the existing entry's id
  // if a case-insensitive label match already exists. Returns undefined
  // if the label is blank.
  addNodeType: (label: string) => string | undefined;
  saveNodeType: (nodeType: NodeTypeRef) => boolean;
  saveNodeTypeGuidance: (id: string, guidance: AiDesignGuidance | undefined) => void;
  removeNodeType: (
    id: string,
  ) => "deleted" | "reset" | "in-use" | "missing";
  importNodeTypeCatalog: (data: unknown) => number;
  exportNodeTypeCatalog: () => string;

  // JSON I/O
  importJson: (data: unknown) => void;
  exportJson: () => string;
  // Replace the current document with a brand-new empty one. Snapshots the
  // outgoing doc onto the undo stack so it can be recovered with Ctrl+Z.
  newDocument: () => void;
  // Merge a parsed Privacy Manager data inventory into the current doc.
  // For each service group, decisions[serviceId] tells whether to use a
  // specific existing node, create a new one, or ignore. Implicit
  // "use existing node with matching serviceTreeId" auto-matches must
  // already be folded into decisions by the caller.
  importPrivacyManagerData: (
    parsed: ImportPrivacyManagerInput,
    decisions: Record<string, ServiceImportDecision>,
  ) => ImportPrivacyManagerSummary;

  // History
  snapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Realtime collaboration. `collab` reflects the current connection
  // state. `joinRoom` joins a Web Pub/Sub group identified by `room`,
  // encrypting all on-the-wire payloads with the AES-GCM `key` (a
  // base64url-encoded 32-byte secret carried in the URL hash). The
  // local document is mirrored into a shared Y.Doc and changes flow
  // both ways for as long as the room is joined. `leaveRoom` tears
  // everything down.
  //
  // Pass `seed: true` when the caller wants the current local doc to
  // populate a fresh room (the Share-button case). Pass `seed: false`
  // when joining a link from someone else (the HashRoomJoiner case)
  // so a stale autosave can't pollute an established room.
  collab: CollabState;
  joinRoom: (
    room: string,
    key: string,
    options?: { seed?: boolean }
  ) => boolean;
  leaveRoom: () => void;

  // Derived
  activeScenario: Scenario | null;
  visibleNodes: PsNode[];
  visibleEdges: PsEdge[];
  visibleBoundaries: PsBoundary[];
  visibleTextAnnotations: PsTextAnnotation[];
  createTextAnnotation: (position: Position) => PsTextAnnotation;
  updateTextAnnotation: (id: string, patch: Partial<Omit<PsTextAnnotation, "id">>, snapshotBefore?: boolean) => void;
  deleteTextAnnotation: (id: string) => void;
  setTextAnnotationMembership: (scenarioId: string, id: string, included: boolean) => void;
  edgeNumberFor: (edgeId: string) => number | null;
}

const StoreContext = createContext<StoreApi | null>(null);

interface HistoryEntry {
  doc: PsDocument;
  authenticationLibrary?: AuthTypeDef[];
  classificationLibrary?: ClassificationLibrary;
  // Local editor context only; autosave and collaboration carry document snapshots.
  scopeReason?: { scenarioId: string; nodeId: string };
}

interface DocumentHistoryState {
  doc: PsDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  ordinarySnapshot: { renderDoc: PsDocument; entry: HistoryEntry } | null;
  scopeReasonEdit: {
    session: symbol;
    scenarioId: string;
    nodeId: string;
    doc: PsDocument;
  } | null;
}

const HISTORY_LIMIT = 100;

function appendHistory(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...entries, entry].slice(-HISTORY_LIMIT);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { autosaveIntervalMs, openInspector } = useUiShell();
  const libraries = useLibraries();
  const libraryNodes = useMemo(() => libraries.nodes.filter(type =>
    libraries.provenance[`nodes/${type.id.toLowerCase()}`] !== "core"), [libraries]);
  const libraryInitial = useMemo(() => loadAuthenticationLibrary(libraries.authentication), [libraries]);
  const protocolInitial = useMemo(() => loadProtocolLibrary(), []);
  const [protocolLibrary, setProtocolLibraryState] = useState(protocolInitial.definitions);
  const [protocolStorageError, setProtocolStorageError] = useState(protocolInitial.error);
  const protocolLibraryRef = useRef(protocolLibrary);
  const setProtocolLibrary = useCallback((next: ProtocolTypeDef[]) => {
    protocolLibraryRef.current = next;
    setProtocolLibraryState(next);
  }, []);
  const classificationInitial = useMemo(() => loadClassificationLibrary(undefined, libraries.classifications), [libraries]);
  const [classificationLibrary, setClassificationLibraryState] = useState(classificationInitial.library);
  const [classificationLibrarySource, setClassificationLibrarySource] = useState<StoreApi["classificationLibrarySource"]>(
    classificationInitial.source === "shipped" && libraries.provenance["classifications/default"] !== "core"
      ? "configured library" : classificationInitial.source,
  );
  const [classificationStorageError, setClassificationStorageError] = useState(classificationInitial.error);
  const [classificationRecoveryRaw, setClassificationRecoveryRaw] = useState(
    classificationInitial.error && typeof classificationInitial.storedValue === "string"
      ? classificationInitial.storedValue : null,
  );
  const classificationLibraryRef = useRef(classificationLibrary);
  const classificationDefinitions = useMemo(
    () => classificationDefinitionsForLibrary(classificationLibrary), [classificationLibrary],
  );
  const classificationDefinitionsRef = useRef(classificationDefinitions);
  const setClassificationLibrary = useCallback((next: ClassificationLibrary) => {
    classificationLibraryRef.current = next;
    classificationDefinitionsRef.current = classificationDefinitionsForLibrary(next);
    setClassificationLibraryState(next);
  }, []);
  const captureCatalogDefinitions = useCallback(
    (document: PsDocument, classifications: readonly CatalogDefinitionSnapshot[] = classificationDefinitionsRef.current) =>
      withCatalogDefinitions(
        withProtocolDefinitions(document, protocolLibraryRef.current),
        [...classifications, ...libraries.taxonomy],
      ),
    [libraries],
  );
  const [authenticationLibrary, setAuthenticationLibraryState] = useState(libraryInitial.methods);
  const [authenticationStorageError, setAuthenticationStorageError] = useState(libraryInitial.error);
  const [catalogSnapshotError, setCatalogSnapshotError] = useState<string | null>(null);
  const libraryRef = useRef(authenticationLibrary);
  const setAuthenticationLibrary = useCallback((next: AuthTypeDef[]) => {
    libraryRef.current = next;
    setAuthenticationLibraryState(next);
  }, []);
  // Rehydrate from autosave once on mount. If anything is malformed we
  // fall back to a blank doc so a corrupt entry can never white-screen the
  // app. History entries are best-effort: bad ones are dropped, good ones
  // kept.
  //
  // Standalone-HTML exports embed the document inside the file via
  // `<script type="application/json" id="ps-embedded-doc">…</script>`.
  // When such a script is present, we seed FROM IT instead of from
  // autosave so opening an exported file is a self-contained
  // experience. Autosave still picks up subsequent edits per-origin
  // (file:// URLs get a localStorage partition per file).
  const initial = useMemo(() => {
    const documentRecoveryFailure = (value: unknown, history: unknown[] = []) => {
      if (!value || typeof value !== "object") return null;
      try {
        if ("catalogDefinitions" in value) validateCatalogDefinitions(value.catalogDefinitions);
        for (const [collection, target] of [["nodes", "node"], ["edges", "edge"]] as const) {
          if (collection in value) {
            const entities = (value as Record<string, unknown>)[collection];
            if (Array.isArray(entities)) for (const entity of entities) {
              if (entity && typeof entity === "object") normalizeEntityMetadata(entity, target);
            }
          }
        }
        for (const saved of [value, ...history]) {
          if (saved && typeof saved === "object") {
            validateNodeTypeGuidanceEntries((saved as Partial<PsDocument>).nodeTypes);
            const annotations = normalizeTextAnnotations(saved as Partial<PsDocument>);
            for (const scenario of (saved as Partial<PsDocument>).scenarios ?? []) {
              normalizeTextAnnotationIds(scenario, annotations ?? []);
            }
          }
          if (saved && typeof saved === "object") validateThreatNotes(saved as Partial<PsDocument>);
          if (saved && typeof saved === "object" && "workItems" in saved && Array.isArray(saved.workItems)) {
            saved.workItems.forEach(normalizeWorkItem);
          }
          if (saved && typeof saved === "object" && "edges" in saved && Array.isArray(saved.edges)) {
            for (const edge of saved.edges) {
              if (edge && typeof edge === "object") {
                normalizeRequiredAccessRights(edge.requiredAccessRights, typeof edge.id === "string" ? edge.id : undefined);
              }
            }
          }
          if (saved && typeof saved === "object" && "boundaries" in saved && Array.isArray(saved.boundaries)) {
            for (const boundary of saved.boundaries) {
              if (boundary && typeof boundary === "object") {
                for (const { key, label } of BOUNDARY_NETWORK_FIELDS) {
                  normalizeBoundaryNetworkText(boundary[key], label);
                }
              }
            }
          }
        }
        return null;
      } catch (error) {
        return {
          ...readView(emptyDocument(), null, [], []),
          recoveryError: `Saved diagram recovery is paused: ${error instanceof Error ? error.message : String(error)} Stored data was not overwritten. Open a valid backup or explicitly choose File > New before continuing.`,
        };
      }
    };
    const safeNorm = (v: unknown): PsDocument | null => {
      try {
        if (!v || typeof v !== "object") return null;
        return withLibraryDefinitions(normalizeDoc(v as Partial<PsDocument>, libraryNodes), libraries,
          libraryRef.current, classificationDefinitionsRef.current);
      } catch {
        return null;
      }
    };

    // Tolerant unwrap of either the {format, version, doc, view} wrapper
    // emitted by exportJson() or a bare PsDocument — mirrors importJson.
    const unwrap = (
      raw: unknown,
    ): { doc: unknown; view: Record<string, unknown> | null } | null => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      if ("doc" in obj && obj.doc && typeof obj.doc === "object") {
        const view =
          "view" in obj && obj.view && typeof obj.view === "object"
            ? (obj.view as Record<string, unknown>)
            : null;
        return { doc: obj.doc, view };
      }
      return { doc: obj, view: null };
    };

    const embedded = unwrap(readEmbeddedDoc());
    if (embedded) {
      const failure = documentRecoveryFailure(embedded.doc);
      if (failure) return failure;
      const doc = safeNorm(embedded.doc);
      if (doc) {
        return readView(doc, embedded.view, [], []);
      }
    }

    const raw = loadAutosaveRaw();
    if (!raw) return null;
    const failure = documentRecoveryFailure(raw.doc, [...raw.past, ...raw.future]);
    if (failure) return failure;
    const doc = safeNorm(raw.doc);
    if (!doc) return null;
    const history = raw.authenticationHistory && typeof raw.authenticationHistory === "object"
      ? raw.authenticationHistory as Record<string, unknown> : {};
    const classificationHistory = raw.classificationHistory && typeof raw.classificationHistory === "object"
      ? raw.classificationHistory as Record<string, unknown> : {};
    let historyError: string | undefined;
    let classificationHistoryError: string | undefined;
    const restoreHistory = (values: unknown[], libraryHistory: unknown, classifications: unknown): HistoryEntry[] =>
      values.flatMap((value, index) => {
        const doc = safeNorm(value);
        if (!doc) return [];
        const saved = Array.isArray(libraryHistory) ? libraryHistory[index] : null;
        const savedClassifications = Array.isArray(classifications) ? classifications[index] : null;
        try {
          if (saved != null && savedClassifications != null) {
            throw new Error("A history entry cannot contain two profile-library transactions.");
          }
          const authenticationLibrary = saved == null ? undefined : validateAuthenticationDefinitions(saved, libraries.authentication);
          const classificationLibrary = savedClassifications == null ? undefined
            : validateClassificationLibrary(savedClassifications);
          return [{ doc, authenticationLibrary, classificationLibrary }];
        } catch (cause) {
          const message = `Library undo history could not be restored: ${(cause as Error).message}. Current model and libraries are unchanged; invalid history entries were excluded.`;
          if (savedClassifications != null) classificationHistoryError = message;
          else historyError = message;
          return [];
        }
      });
    const past = restoreHistory(raw.past, history.past, classificationHistory.past);
    const future = restoreHistory(raw.future, history.future, classificationHistory.future);

    return { ...readView(
      doc,
      raw.view as Record<string, unknown> | null | undefined,
      past,
      future,
    ), historyError, classificationHistoryError };
  }, []);

  function readView(
    doc: PsDocument,
    view: Record<string, unknown> | null | undefined,
    past: HistoryEntry[],
    future: HistoryEntry[],
  ): {
    doc: PsDocument;
    past: HistoryEntry[];
    future: HistoryEntry[];
    activeScenarioId: string | null;
    filter: FilterState;
    historyError?: string;
    classificationHistoryError?: string;
    recoveryError?: string;
  } {
    let activeScenarioId: string | null = null;
    let filter: FilterState = { ...emptyFilter };
    if (view && typeof view === "object") {
      const asid = view.activeScenarioId;
      if (
        typeof asid === "string" &&
        doc.scenarios.some((s) => s.id === asid)
      ) {
        activeScenarioId = asid;
      }
      if (view.filter && typeof view.filter === "object") {
        filter = normalizeFilterState(doc, view.filter);
      }
    }
    return { doc, past, future, activeScenarioId, filter };
  }
  useEffect(() => {
    if (initial?.historyError) setAuthenticationStorageError(initial.historyError);
    if (initial?.classificationHistoryError) setClassificationStorageError(initial.classificationHistoryError);
  }, [initial]);
  const [documentRecoveryError, setDocumentRecoveryError] = useState(initial?.recoveryError ?? null);
  const [documentSessionId, setDocumentSessionId] = useState(0);

  const [documentHistory, setDocumentHistory] = useState<DocumentHistoryState>(() => ({
    doc: initial?.doc ?? emptyDocument(),
    past: initial?.past ?? [],
    future: initial?.future ?? [],
    ordinarySnapshot: null,
    scopeReasonEdit: null,
  }));
  const documentHistoryRef = useRef(documentHistory);
  const { doc, past, future } = documentHistory;
  const ordinaryRenderDocRef = useRef(doc);
  useLayoutEffect(() => {
    ordinaryRenderDocRef.current = doc;
  }, [doc]);
  const docRef = useMemo(() => ({ get current() { return documentHistoryRef.current.doc; } }), []);
  const pastRef = useMemo(() => ({ get current() { return documentHistoryRef.current.past; } }), []);
  const futureRef = useMemo(() => ({ get current() { return documentHistoryRef.current.future; } }), []);
  const updateDocumentHistory = useCallback((transition: (previous: DocumentHistoryState) => DocumentHistoryState) => {
    // Evaluate once in action order, before publishing an immutable render snapshot.
    // React may batch renders; it must not replay storage/UI work or reset queued state.
    const previous = documentHistoryRef.current;
    const next = transition(previous);
    if (next === previous) return;
    documentHistoryRef.current = next;
    setDocumentHistory(next);
  }, []);
  const setDoc = useCallback<Dispatch<SetStateAction<PsDocument>>>(update => {
    const profile = libraryRef.current;
    const classifications = classificationDefinitionsRef.current;
    updateDocumentHistory(previous => {
      const nextDoc = withLibraryDefinitions(
        typeof update === "function" ? update(previous.doc) : update,
        libraries, profile, classifications,
      );
      return nextDoc === previous.doc ? previous : { ...previous, doc: nextDoc, scopeReasonEdit: null };
    });
  }, [libraries, updateDocumentHistory]);
  const nodeTypeCatalog = useMemo(() => libraryNodeTypes(doc, libraries), [doc, libraries]);
  const availableCatalogDefinitions = useMemo(() => [...classificationDefinitions, ...libraries.taxonomy], [classificationDefinitions, libraries]);
  const authenticationCatalog = useMemo(
    () => authenticationCatalogFor(doc, authenticationLibrary, libraries.authentication), [doc, authenticationLibrary, libraries],
  );
  const authWarnings = useMemo(
    () => authenticationWarnings(doc, authenticationLibrary, libraries.authentication), [doc, authenticationLibrary, libraries],
  );
  const authenticationCompatibility = useMemo(
    () => authenticationCompatibilityFor(doc, authenticationLibrary), [doc, authenticationLibrary],
  );
  const [activeScenarioId, setActiveScenarioIdRaw] = useState<string | null>(
    () => initial?.activeScenarioId ?? null
  );
  const activeScenarioIdRef = useRef<string | null>(activeScenarioId);
  const [selection, setSelectionRaw] = useState<Selection>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const selectionRef = useRef<Selection>(null);
  selectionRef.current = selection;
  const multiSelectedIdsRef = useRef<string[]>(multiSelectedIds);
  multiSelectedIdsRef.current = multiSelectedIds;
  // Wrapping setSelection so that any single-selection change also clears
  // the multi-selection set — this matches "click without ctrl" semantics
  // for every existing call site (delete handlers, list clicks, etc.).
  const setSelection = useCallback((s: Selection) => {
    updateDocumentHistory(state => state.scopeReasonEdit &&
      (s?.kind !== "node" || s.id !== state.scopeReasonEdit.nodeId)
      ? { ...state, scopeReasonEdit: null } : state);
    setSelectionRaw(s);
    setMultiSelectedIds([]);
  }, [updateDocumentHistory]);
  const setActiveScenarioId = useCallback((id: string | null) => {
    updateDocumentHistory(state => state.scopeReasonEdit && state.scopeReasonEdit.scenarioId !== id
      ? { ...state, scopeReasonEdit: null } : state);
    activeScenarioIdRef.current = id;
    setActiveScenarioIdRaw(id);
    if (id === null) return;
    const scenario = docRef.current.scenarios.find(
      (candidate) => candidate.id === id,
    );
    setSelectionRaw((current) => {
      if (!current || !scenario) return null;
      if (current.kind === "node") {
        return scenario.nodeIds.includes(current.id) ? current : null;
      }
      if (current.kind === "edge") {
        return scenario.edgeIds.includes(current.id) ? current : null;
      }
      if (current.kind === "boundary") {
        return scenario.boundaryIds.includes(current.id) ? current : null;
      }
      if (current.kind === "annotation") {
        return scenario.textAnnotationIds?.includes(current.id) ? current : null;
      }
      return scenario.edgeIds.includes(current.edgeId) ? current : null;
    });
    setMultiSelectedIds((current) =>
      current.filter(
        (selectedId) =>
          scenario?.nodeIds.includes(selectedId) ||
          scenario?.boundaryIds.includes(selectedId) ||
          scenario?.textAnnotationIds?.includes(selectedId),
      ),
    );
  }, [updateDocumentHistory]);
  const clearMultiSelection = useCallback(() => {
    setMultiSelectedIds([]);
  }, []);
  const toggleAdditionalSelection = useCallback(
    (kind: "node" | "boundary" | "annotation", id: string) => {
      const prevSel = selectionRef.current;
      const prevMulti = multiSelectedIdsRef.current;
      // Case A: id is the current single selection — deselect. If the multi
      // set has entries, promote one so the side panel keeps a focus.
      if (prevSel && "id" in prevSel && prevSel.id === id) {
        if (prevMulti.length === 0) {
          setSelectionRaw(null);
        } else {
          const [head, ...rest] = prevMulti;
          const doc = docRef.current;
          const promotedKind: "node" | "boundary" | "annotation" = doc.nodes.some(
            (n) => n.id === head
          )
            ? "node"
            : doc.boundaries.some(b => b.id === head) ? "boundary" : "annotation";
          setSelectionRaw({ kind: promotedKind, id: head });
          setMultiSelectedIds(rest);
        }
        return;
      }
      // Case B: id is in the additional set — remove it.
      if (prevMulti.includes(id)) {
        setMultiSelectedIds(prevMulti.filter((x) => x !== id));
        return;
      }
      // Case C: nothing is selected — promote to single selection.
      if (!prevSel) {
        setSelectionRaw({ kind, id });
        return;
      }
      // Case D: add id to the additional multi-selection set.
      setMultiSelectedIds([...prevMulti, id]);
    },
    []
  );
  const [filter, setFilterStateRaw] = useState<FilterState>(
    () => initial?.filter ?? emptyFilter
  );
  const filterRef = useRef(filter);
  const setFilterState = useCallback<Dispatch<SetStateAction<FilterState>>>(update => {
    const next = typeof update === "function" ? update(filterRef.current) : update;
    filterRef.current = next;
    setFilterStateRaw(next);
  }, []);
  const [editingEdgeTitleId, setEditingEdgeTitleId] = useState<string | null>(
    null
  );
  const [editingEdgeTitleValue, setEditingEdgeTitleValue] = useState("");
  const [assistantFindings, setAssistantFindings] = useState<AssistantFinding[]>(
    []
  );
  const [assistantAnalysis, setAssistantAnalysis] = useState<AssistantAnalysisSnapshot | null>(null);
  const [acceptedFindingIds, setAcceptedFindingIds] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [allCommentsViewOpen, setAllCommentsViewOpenRaw] = useState(false);
  const [allIssuesViewOpen, setAllIssuesViewOpenRaw] = useState(false);
  const [diffViewOpen, setDiffViewOpenRaw] = useState(false);
  const [diffChanges, setDiffChanges] = useState<ChangeItem[]>([]);
  const [diffFileName, setDiffFileName] = useState<string | null>(null);
  const [diffSelectedTarget, setDiffSelectedTarget] =
    useState<ChangeTarget | null>(null);
  // Mutually exclusive — opening one closes the others so the side pane only
  // ever hosts one "all X" list at a time.
  const setAllCommentsViewOpen = useCallback((open: boolean) => {
    setAllCommentsViewOpenRaw(open);
    if (open) {
      setAllIssuesViewOpenRaw(false);
      setDiffViewOpenRaw(false);
    }
  }, []);
  const setAllIssuesViewOpen = useCallback((open: boolean) => {
    setAllIssuesViewOpenRaw(open);
    if (open) {
      setAllCommentsViewOpenRaw(false);
      setDiffViewOpenRaw(false);
    }
  }, []);
  const setDiffViewOpen = useCallback((open: boolean) => {
    setDiffViewOpenRaw(open);
    if (open) {
      setAllCommentsViewOpenRaw(false);
      setAllIssuesViewOpenRaw(false);
    }
  }, []);
  const loadDiff = useCallback(
    (changes: ChangeItem[], fileName: string) => {
      setDiffChanges(changes);
      setDiffFileName(fileName);
      setDiffSelectedTarget(null);
      setDiffViewOpen(true);
    },
    [setDiffViewOpen]
  );
  const clearDiff = useCallback(() => {
    setDiffChanges([]);
    setDiffFileName(null);
    setDiffSelectedTarget(null);
    setDiffViewOpenRaw(false);
  }, []);
  const [focusTarget, setFocusTarget] = useState<{
    kind: "node" | "edge" | "boundary" | "annotation";
    id: string;
  } | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "sequence">("graph");
  // -------- Realtime collaboration --------
  // Null when not joined. Populated by joinRoom() and cleared by
  // leaveRoom(); the useCollab hook below brings up / tears down the
  // Y.Doc + WebPubSubProvider in response to changes here. Note that
  // setDoc itself does NOT call snapshot(), so passing it as the
  // remote-write callback keeps remote edits out of the local undo
  // stack — exactly what we want for collaborative undo semantics.
  const [collabRoom, setCollabRoom] = useState<{
    room: string;
    key: string;
    seed: boolean;
  } | null>(null);
  const setDocFromCollab = useCallback(
    (
      nextDoc: PsDocument,
      options: { resetHistory: boolean },
    ) => {
      updateDocumentHistory(previous => ({
        ...previous,
        doc: nextDoc,
        past: options.resetHistory ? [] : previous.past,
        future: options.resetHistory ? [] : previous.future,
        ordinarySnapshot: null,
        scopeReasonEdit: null,
      }));
      const nodeIds = new Set(nextDoc.nodes.map((node) => node.id));
      const edgeIds = new Set(nextDoc.edges.map((edge) => edge.id));
      const boundaryIds = new Set(
        nextDoc.boundaries.map((boundary) => boundary.id),
      );
      const annotationIds = new Set(nextDoc.textAnnotations?.map(annotation => annotation.id));
      setSelectionRaw((current) => {
        if (!current) return null;
        if (current.kind === "node") {
          return nodeIds.has(current.id) ? current : null;
        }
        if (current.kind === "edge") {
          return edgeIds.has(current.id) ? current : null;
        }
        if (current.kind === "boundary") {
          return boundaryIds.has(current.id) ? current : null;
        }
        if (current.kind === "annotation") return annotationIds.has(current.id) ? current : null;
        const edge = nextDoc.edges.find(
          (candidate) => candidate.id === current.edgeId,
        );
        return edge?.waypoints.some(
          (waypoint) => waypoint.id === current.waypointId,
        )
          ? current
          : null;
      });
      setMultiSelectedIds((current) =>
        current.filter(
          (id) => nodeIds.has(id) || boundaryIds.has(id) || annotationIds.has(id),
        ),
      );
    },
    [updateDocumentHistory],
  );
  const collabState = useCollab({
    room: collabRoom?.room ?? null,
    key: collabRoom?.key ?? null,
    doc,
    classificationDefinitions,
    setDocFromCollab,
    seedFromLocal: collabRoom?.seed ?? false,
  });
  const joinRoom = useCallback(
    (room: string, key: string, options?: { seed?: boolean }) => {
      if (!SERVICES.collaboration.enabled) return false;
      setCollabRoom({ room, key, seed: options?.seed ?? true });
      return true;
    },
    []
  );
  const leaveRoom = useCallback(() => {
    setCollabRoom(null);
  }, []);

  const setFilter = useCallback((partial: Partial<FilterState>) => {
    setFilterState((f) => ({ ...f, ...partial }));
  }, []);
  const clearFilter = useCallback(() => setFilterState(emptyFilter), []);

  // -------- History --------
  const snapshot = useCallback((
    includeLibrary: boolean | "classification" = false,
    prepared?: { doc: PsDocument; past: HistoryEntry[] },
  ) => {
    const savedLibrary = includeLibrary === true ? libraryRef.current : undefined;
    const savedClassifications = includeLibrary === "classification" ? classificationLibraryRef.current : undefined;
    const renderDoc = ordinaryRenderDocRef.current;
    updateDocumentHistory(state => {
      const cur = prepared?.doc ?? state.doc;
      const previous = prepared?.past ?? state.past;
      // Preserve ordinary compound affordances, but snapshot their queued predecessor.
      const duplicate = !includeLibrary && previous.length > 0 &&
        state.ordinarySnapshot?.renderDoc === renderDoc &&
        previous[previous.length - 1] === state.ordinarySnapshot.entry;
      const entry: HistoryEntry = {
        doc: cur, authenticationLibrary: savedLibrary, classificationLibrary: savedClassifications,
      };
      return {
        ...state,
        past: duplicate ? previous : appendHistory(previous, entry),
        future: [],
        ordinarySnapshot: includeLibrary ? null : duplicate ? state.ordinarySnapshot : { renderDoc, entry },
        scopeReasonEdit: null,
      };
    });
  }, [updateDocumentHistory]);

  const designerCatalog = useCallback(() => {
    const current = docRef.current;
    const resolved = authenticationCatalogFor(current, libraryRef.current, libraries.authentication);
    return {
      nodeTypes: libraryNodeTypes(current, libraries),
      authentication: resolved.filter(method =>
        !method.disabled && !method.legacy && !method.unavailableReason &&
        libraryRef.current.some(item => item.id === method.id && !item.disabled)),
      // Full saved-first catalog resolves guidance for methods already on flows.
      authenticationDefinitions: resolved,
      classifications: classificationLibraryRef.current,
      protocols: protocolLibraryRef.current,
    };
  }, [libraries]);

  const prepareThreatModelDesign = useCallback((
    scope?: readonly string[], protocolScope?: readonly string[], authenticationScope?: readonly string[],
  ): DesignRequestSnapshot => {
    const current = docRef.current;
    const scenarioId = current.scenarios.length ? activeScenarioIdRef.current : null;
    const catalog = designerCatalog();
    return {
      scenarioId, documentKey: designerDocumentKey(current), catalogKey: JSON.stringify(catalog),
      ...(scope ? { scope: [...scope] } : {}),
      ...(protocolScope ? { protocolScope: [...protocolScope] } : {}),
      ...(authenticationScope ? { authenticationScope: [...authenticationScope] } : {}),
      context: buildDesignerContext(current, scenarioId, catalog, scope, protocolScope, authenticationScope),
    };
  }, [designerCatalog]);

  const prepareThreatModelDesignPlan = useCallback(() => {
    const current = docRef.current;
    const scenarioId = current.scenarios.length ? activeScenarioIdRef.current : null;
    return buildDesignPlanContext(current, scenarioId, designerCatalog());
  }, [designerCatalog]);

  const applyThreatModelDesign = useCallback((result: unknown, expected: DesignRequestSnapshot) => {
    const current = prepareThreatModelDesign(expected.scope, expected.protocolScope, expected.authenticationScope);
    if (current.scenarioId !== expected.scenarioId || current.documentKey !== expected.documentKey ||
        current.catalogKey !== expected.catalogKey ||
        JSON.stringify(current.context) !== JSON.stringify(expected.context)) {
      throw new Error("The model, scenario or catalog changed while AI was working. No changes were applied; send your prompt again.");
    }
    const previous = docRef.current;
    const applied = applyDesignerResult(previous, current.scenarioId, result, designerCatalog(),
      expected.scope, expected.protocolScope, expected.authenticationScope);
    const changed = applied.doc !== previous;
    if (changed) {
      const next = withCatalogDefinitions(
        withLibraryDefinitions(applied.doc, libraries, libraryRef.current, classificationDefinitionsRef.current),
        [...classificationDefinitionsRef.current, ...libraries.taxonomy],
      );
      updateDocumentHistory(state => ({
        ...state, doc: next, past: appendHistory(state.past, { doc: state.doc }), future: [],
        ordinarySnapshot: null, scopeReasonEdit: null,
      }));
      setSelection(null);
      setActiveScenarioId(applied.scenarioId);
    }
    return { scenarioId: applied.scenarioId, changed, summary: describeDesignerChanges(previous, applied.doc),
      warning: applied.warning, partial: applied.partial };
  }, [designerCatalog, prepareThreatModelDesign, libraries, updateDocumentHistory, setSelection, setActiveScenarioId]);

  const restoreHistorySelection = useCallback((entry: HistoryEntry, previousDoc: PsDocument) => {
    const context = entry.scopeReason;
    const scenario = context && entry.doc.scenarios.find(item => item.id === context.scenarioId);
    const currentScenario = context && previousDoc.scenarios.find(item => item.id === context.scenarioId);
    if (context && activeScenarioIdRef.current === context.scenarioId &&
        currentScenario?.nodeIds.includes(context.nodeId) && scenario?.nodeIds.includes(context.nodeId) &&
        previousDoc.nodes.some(node => node.id === context.nodeId) && entry.doc.nodes.some(node => node.id === context.nodeId)) {
      setSelection({ kind: "node", id: context.nodeId });
      resetDetailsTab();
      openInspector("properties");
    } else {
      setSelection(null);
    }
  }, [openInspector, setSelection]);

  const undo = useCallback(() => {
    const state = documentHistoryRef.current;
    const p = state.past;
    if (p.length === 0) return;
    const prev = p[p.length - 1];
    const current = state.doc;
    const currentLibrary = libraryRef.current;
    const currentClassifications = classificationLibraryRef.current;
    if (prev.authenticationLibrary && prev.classificationLibrary) {
      setClassificationStorageError("Undo was not applied: a history entry cannot change two profile libraries.");
      return;
    }
    const restoredDoc = withLibraryDefinitions(
      prev.doc, libraries, prev.authenticationLibrary ?? currentLibrary,
      prev.classificationLibrary ? classificationDefinitionsForLibrary(prev.classificationLibrary)
        : classificationDefinitionsRef.current,
    );
    const restored: DocumentHistoryState = {
      ...state,
      doc: restoredDoc,
      past: state.past.slice(0, -1),
      future: appendHistory(state.future, {
        doc: current, authenticationLibrary: prev.authenticationLibrary ? currentLibrary : undefined,
        classificationLibrary: prev.classificationLibrary ? currentClassifications : undefined,
        ...(prev.scopeReason ? { scopeReason: prev.scopeReason } : {}),
      }),
      ordinarySnapshot: null,
      scopeReasonEdit: null,
    };
    if (prev.authenticationLibrary) {
      try { persistAuthenticationLibrary(prev.authenticationLibrary, currentLibrary, libraries.authentication); }
      catch (cause) { setAuthenticationStorageError((cause as Error).message); return; }
    }
    if (prev.classificationLibrary) {
      try { persistClassificationLibrary(prev.classificationLibrary, currentClassifications, undefined, libraries.classifications); }
      catch (cause) { setClassificationStorageError((cause as Error).message); return; }
    }
    updateDocumentHistory(() => restored);
    if (prev.authenticationLibrary) setAuthenticationLibrary(prev.authenticationLibrary);
    if (prev.classificationLibrary) {
      setClassificationLibrary(prev.classificationLibrary);
      setClassificationLibrarySource("profile");
      setClassificationStorageError(null);
      setClassificationRecoveryRaw(null);
    }
    restoreHistorySelection({ ...prev, doc: restoredDoc }, current);
  }, [restoreHistorySelection, libraries, updateDocumentHistory, setAuthenticationLibrary, setClassificationLibrary]);

  const redo = useCallback(() => {
    const state = documentHistoryRef.current;
    const f = state.future;
    if (f.length === 0) return;
    const next = f[f.length - 1];
    const current = state.doc;
    const currentLibrary = libraryRef.current;
    const currentClassifications = classificationLibraryRef.current;
    if (next.authenticationLibrary && next.classificationLibrary) {
      setClassificationStorageError("Redo was not applied: a history entry cannot change two profile libraries.");
      return;
    }
    const restoredDoc = withLibraryDefinitions(
      next.doc, libraries, next.authenticationLibrary ?? currentLibrary,
      next.classificationLibrary ? classificationDefinitionsForLibrary(next.classificationLibrary)
        : classificationDefinitionsRef.current,
    );
    const restored: DocumentHistoryState = {
      ...state,
      doc: restoredDoc,
      past: appendHistory(state.past, {
        doc: current, authenticationLibrary: next.authenticationLibrary ? currentLibrary : undefined,
        classificationLibrary: next.classificationLibrary ? currentClassifications : undefined,
        ...(next.scopeReason ? { scopeReason: next.scopeReason } : {}),
      }),
      future: state.future.slice(0, -1),
      ordinarySnapshot: null,
      scopeReasonEdit: null,
    };
    if (next.authenticationLibrary) {
      try { persistAuthenticationLibrary(next.authenticationLibrary, currentLibrary, libraries.authentication); }
      catch (cause) { setAuthenticationStorageError((cause as Error).message); return; }
    }
    if (next.classificationLibrary) {
      try { persistClassificationLibrary(next.classificationLibrary, currentClassifications, undefined, libraries.classifications); }
      catch (cause) { setClassificationStorageError((cause as Error).message); return; }
    }
    updateDocumentHistory(() => restored);
    if (next.authenticationLibrary) setAuthenticationLibrary(next.authenticationLibrary);
    if (next.classificationLibrary) {
      setClassificationLibrary(next.classificationLibrary);
      setClassificationLibrarySource("profile");
      setClassificationStorageError(null);
      setClassificationRecoveryRaw(null);
    }
    restoreHistorySelection({ ...next, doc: restoredDoc }, current);
  }, [restoreHistorySelection, libraries, updateDocumentHistory, setAuthenticationLibrary, setClassificationLibrary]);

  // Replace the current document with a fresh empty one. Snapshots first so
  // the user can recover with Ctrl+Z. Also clears all view state that's
  // scoped to the outgoing doc.
  const newDocument = useCallback(() => {
    snapshot();
    setDoc(emptyDocument());
    setDocumentSessionId(current => current + 1);
    setAssistantFindings([]);
    setAssistantAnalysis(null);
    setAcceptedFindingIds(new Set());
    setDocumentRecoveryError(null);
    setActiveScenarioId(null);
    setSelection(null);
    setFilterState(emptyFilter);
    setEditingEdgeTitleId(null);
    setEditingEdgeTitleValue("");
    clearDiff();
  }, [snapshot, clearDiff]);

  // -------- Autosave --------
  //
  // Persist {doc, past, future, view} to localStorage with a debounce so
  // rapid edits coalesce. The cleanup-as-debounce pattern can't guarantee
  // the timeout fires before tab close, so we also flush synchronously on
  // pagehide and when the document becomes hidden.
  const flushAutosave = useCallback(() => {
    if (documentRecoveryError) return;
    const b = documentHistoryRef.current;
    const classifications = classificationDefinitionsRef.current;
    let savedDoc: PsDocument;
    let savedPast: PsDocument[];
    let savedFuture: PsDocument[];
    try {
      savedDoc = captureCatalogDefinitions(b.doc, classifications);
      const captureHistory = (entry: HistoryEntry) => captureCatalogDefinitions(entry.doc,
        entry.classificationLibrary ? classificationDefinitionsForLibrary(entry.classificationLibrary)
          : classifications);
      savedPast = b.past.map(captureHistory);
      savedFuture = b.future.map(captureHistory);
    } catch (error) {
      setCatalogSnapshotError(`Autosave was not updated: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setCatalogSnapshotError(null);
    saveAutosave({
      doc: savedDoc,
      past: savedPast,
      future: savedFuture,
      authenticationHistory: {
        past: b.past.map(entry => entry.authenticationLibrary ?? null),
        future: b.future.map(entry => entry.authenticationLibrary ?? null),
      },
      classificationHistory: {
        past: b.past.map(entry => entry.classificationLibrary ?? null),
        future: b.future.map(entry => entry.classificationLibrary ?? null),
      },
      view: { activeScenarioId: activeScenarioIdRef.current, filter: filterRef.current },
    });
  }, [documentRecoveryError]);

  useEffect(() => {
    const handle = window.setTimeout(flushAutosave, autosaveIntervalMs);
    return () => window.clearTimeout(handle);
  }, [doc, past, future, activeScenarioId, filter, flushAutosave, autosaveIntervalMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    window.addEventListener("pagehide", flushAutosave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushAutosave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushAutosave]);


  // -------- Node ops --------
  const createNode = useCallback((position: Position): PsNode => {
    snapshot();
    const node: PsNode = {
      id: uid("n"),
      dfdRoleLegacy: false,
      title: "New Node",
      description: "",
      type: "",
      serviceTreeId: "",
      endpointRegex: "",
      position,
      size: { ...DEFAULT_NODE_SIZE },
    };
    setDoc((d) => {
      const adopted = adoptNodeIntoOverlappingBoundaries(
        [...d.nodes, node],
        d.boundaries,
        node.id,
      );
      return { ...d, nodes: adopted.nodes, boundaries: adopted.boundaries };
    });
    return node;
  }, [snapshot]);

  const updateNode = useCallback((id: string, patch: Partial<PsNode>) => {
    snapshot();
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        if (n.id !== id) return n;
        // Clear instance overrides when the node's type changes — overrides
        // are scoped to a specific type's deferred settings and would be
        // stale (and potentially confusing) once the type changes.
        const typeChanged =
          patch.type !== undefined && patch.type !== n.type;
        if (typeChanged) {
          const merged: PsNode = { ...n, ...patch };
          delete (merged as Partial<PsNode>).geoBoundary;
          delete (merged as Partial<PsNode>).postSubscriptionRetention;
          return merged;
        }
        return { ...n, ...patch };
      }),
    }));
  }, [snapshot]);

  const setNodeScopeReason = useCallback((scenarioId: string, nodeId: string, reason: string, editSession?: symbol) => {
    const state = documentHistoryRef.current;
    const current = state.doc;
    const scenario = current.scenarios.find(item => item.id === scenarioId);
    const node = current.nodes.find(item => item.id === nodeId);
    if (!node || !scenario?.nodeIds.includes(nodeId)) {
      window.alert("Select a scenario containing this node before editing its scope.");
      return;
    }
    if (reason.length > 16000) {
      window.alert("Scope reasons must be 16000 characters or fewer.");
      return;
    }
    if (reason.trim() && resolveNodeReviewScope(node, scenario, current.nodeTypes).role.role === "ExternalInteractor") {
      window.alert("External Interactors are black boxes, not out-of-scope infrastructure.");
      return;
    }
    const storedReason = Object.hasOwn(scenario.nodeScopeReasons ?? {}, nodeId)
      ? scenario.nodeScopeReasons?.[nodeId] : undefined;
    if (storedReason === reason || (storedReason === undefined && reason === "")) return;
    const group = state.scopeReasonEdit;
    const continuesEdit = editSession !== undefined && group?.session === editSession &&
      group.scenarioId === scenarioId && group.nodeId === nodeId && group.doc === current;
    const next = withLibraryDefinitions({ ...current, scenarios: current.scenarios.map(item => {
      if (item.id !== scenarioId) return item;
      const reasons = { ...item.nodeScopeReasons, [nodeId]: reason };
      if (!reason) delete reasons[nodeId];
      return { ...item, nodeScopeReasons: reasons };
    }) }, libraries, libraryRef.current, classificationDefinitionsRef.current);
    updateDocumentHistory(() => ({
      doc: next,
      past: continuesEdit ? state.past : appendHistory(state.past, {
        doc: current, scopeReason: { scenarioId, nodeId },
      }),
      future: [],
      ordinarySnapshot: null,
      scopeReasonEdit: editSession === undefined ? null
        : { session: editSession, scenarioId, nodeId, doc: next },
    }));
  }, [updateDocumentHistory, libraries]);

  // moveNode is called repeatedly during a drag — snapshot is taken by the
  // drag-start handler in DiagramCanvas, not here.
  const moveNode = useCallback((id: string, position: Position) => {
    setDoc((d) => {
      const nodes = d.nodes.map((node) =>
        node.id === id ? { ...node, position } : node,
      );
      const moved = nodes.find((node) => node.id === id);
      if (!moved) return d;
      const boundaries = d.boundaries.map((boundary) => {
        if (!boundary.nodeIds.includes(id)) return boundary;
        const expanded = expandRectToContain(
          boundaryRect(boundary),
          nodeRect(moved),
        );
        return {
          ...boundary,
          position: expanded.position,
          size: expanded.size,
        };
      });
      return { ...d, nodes, boundaries };
    });
  }, []);

  const finishNodeMove = useCallback(
    (id: string, position: Position, size: Size) => {
      setDoc((d) => {
        const nodes = d.nodes.map((node) =>
          node.id === id ? { ...node, position, size } : node,
        );
        const adopted = adoptNodeIntoOverlappingBoundaries(
          nodes,
          d.boundaries,
          id,
        );
        return { ...d, nodes: adopted.nodes, boundaries: adopted.boundaries };
      });
    },
    [],
  );

  const setNodeSize = useCallback((id: string, size: Size) => {
    setDoc((d) => {
      const current = d.nodes.find((node) => node.id === id);
      if (
        !current ||
        (current.size?.width === size.width &&
          current.size?.height === size.height)
      ) {
        return d;
      }
      const nodes = d.nodes.map((node) =>
        node.id === id ? { ...node, size } : node,
      );
      const measured = nodes.find((node) => node.id === id);
      if (!measured) return d;
      const boundaries = d.boundaries.map((boundary) => {
        if (!boundary.nodeIds.includes(id)) return boundary;
        const expanded = expandRectToContain(
          boundaryRect(boundary),
          nodeRect(measured),
        );
        return {
          ...boundary,
          position: expanded.position,
          size: expanded.size,
        };
      });
      return { ...d, nodes, boundaries };
    });
  }, []);

  const moveDiagramItems = useCallback(
    (
      moves: Array<{
        id: string;
        kind: "node" | "boundary" | "annotation";
        position: Position;
        size?: Size;
      }>,
      finished: boolean,
    ) => {
      setDoc((d) => {
        const directNodeMoves = new Map(
          moves
            .filter((move) => move.kind === "node")
            .map((move) => [move.id, move]),
        );
        const boundaryMoves = new Map(
          moves
            .filter((move) => move.kind === "boundary")
            .map((move) => [move.id, move]),
        );
        const movedBoundaryIds = new Set(boundaryMoves.keys());
        const boundaryDeltas = new Map<string, Position>();
        for (const boundary of d.boundaries) {
          const move = boundaryMoves.get(boundary.id);
          if (move) {
            boundaryDeltas.set(boundary.id, {
              x: move.position.x - boundary.position.x,
              y: move.position.y - boundary.position.y,
            });
          }
        }

        const movedNodeIds = new Set<string>();
        let nodes = d.nodes.map((node) => {
          const direct = directNodeMoves.get(node.id);
          if (direct) {
            movedNodeIds.add(node.id);
            return {
              ...node,
              position: direct.position,
              size: direct.size ?? node.size,
            };
          }
          const movingBoundary = d.boundaries.find(
            (boundary) =>
              movedBoundaryIds.has(boundary.id) &&
              boundary.nodeIds.includes(node.id),
          );
          if (!movingBoundary) return node;
          const delta = boundaryDeltas.get(movingBoundary.id);
          if (!delta) return node;
          movedNodeIds.add(node.id);
          return {
            ...node,
            position: {
              x: node.position.x + delta.x,
              y: node.position.y + delta.y,
            },
          };
        });

        let boundaries = d.boundaries.map((boundary) => {
          const move = boundaryMoves.get(boundary.id);
          return move ? { ...boundary, position: move.position } : boundary;
        });

        for (const node of nodes) {
          if (!movedNodeIds.has(node.id)) continue;
          boundaries = boundaries.map((boundary) => {
            if (
              movedBoundaryIds.has(boundary.id) ||
              !boundary.nodeIds.includes(node.id)
            ) {
              return boundary;
            }
            const expanded = expandRectToContain(
              boundaryRect(boundary),
              nodeRect(node),
            );
            return {
              ...boundary,
              position: expanded.position,
              size: expanded.size,
            };
          });
        }

        if (finished) {
          for (const nodeId of directNodeMoves.keys()) {
            const adopted = adoptNodeIntoOverlappingBoundaries(
              nodes,
              boundaries,
              nodeId,
            );
            nodes = adopted.nodes;
            boundaries = adopted.boundaries;
          }
          for (const boundaryId of movedBoundaryIds) {
            const adopted = adoptNodesIntoBoundary(
              nodes,
              boundaries,
              boundaryId,
            );
            nodes = adopted.nodes;
            boundaries = adopted.boundaries;
          }
        }

        const annotationMoves = new Map(moves.filter(move => move.kind === "annotation").map(move => [move.id, move]));
        return { ...d, nodes, boundaries, ...(d.textAnnotations ? {
          textAnnotations: d.textAnnotations.map(annotation => {
            const move = annotationMoves.get(annotation.id);
            return move ? { ...annotation, position: move.position } : annotation;
          }),
        } : {}) };
      });
    },
    [],
  );

  const deleteNode = useCallback((id: string) => {
    snapshot();
    setDoc((d) => {
      const edgesToRemove = new Set(
        d.edges.filter((e) => e.source === id || e.target === id).map((e) => e.id)
      );
      return {
        ...d,
        nodes: d.nodes.filter((n) => n.id !== id),
        boundaries: d.boundaries.map((boundary) =>
          boundary.nodeIds.includes(id)
            ? {
                ...boundary,
                nodeIds: boundary.nodeIds.filter((nodeId) => nodeId !== id),
              }
            : boundary,
        ),
        edges: d.edges.filter((e) => !edgesToRemove.has(e.id)),
        // Drop comments attached to this node or any edge being removed with it.
        comments: d.comments.filter(
          (c) =>
            !(c.targetKind === "node" && c.targetId === id) &&
            !(c.targetKind === "edge" && edgesToRemove.has(c.targetId))
        ),
        // Same cleanup for issues — drop any whose target is this node or
        // a transitively removed edge.
        issues: d.issues.filter(
          (i) =>
            !(i.targetKind === "node" && i.targetId === id) &&
            !(i.targetKind === "edge" && edgesToRemove.has(i.targetId))
        ),
        scenarios: d.scenarios.map((s) => {
          const remainingEdges = s.edgeIds.filter((eid) => !edgesToRemove.has(eid));
          const newNumbers: Record<string, number> = {};
          remainingEdges.forEach((eid, i) => (newNumbers[eid] = i + 1));
          const { [id]: _droppedNode, ...nodeData } = s.nodeData;
          void _droppedNode;
          const { edgeRequestData, edgeResponseData } =
            pruneEdgesFromScenarioBuckets(s, edgesToRemove);
          return {
            ...s,
            ...normalizeNodeScope(s, new Set(d.nodes.filter(node => node.id !== id).map(node => node.id))),
            nodeIds: s.nodeIds.filter((nid) => nid !== id),
            edgeIds: remainingEdges,
            edgeNumbers: newNumbers,
            nodeData,
            edgeRequestData,
            edgeResponseData,
          };
        }),
      };
    });
  }, [snapshot]);

  // -------- Edge ops --------
  // Waypoints start empty. FlowEdge renders the label at the visual midpoint
  // until the user drags it or explicitly adds a waypoint.
  const createEdge = useCallback(
    (
      source: string,
      target: string,
      sourceHandle?: string,
      targetHandle?: string
    ): PsEdge | null => {
      if (!source || !target || source === target) return null;
      snapshot();
      const edge: PsEdge = {
        id: uid("e"),
        source,
        target,
        sourceHandle,
        targetHandle,
        title: "New Edge",
        description: "",
        waypoints: [],
      };
      setDoc((d) => ({ ...d, edges: [...d.edges, edge] }));
      return edge;
    },
    [snapshot]
  );

  const updateEdge = useCallback((id: string, patch: Partial<PsEdge>) => {
    const rightsPatch = "requiredAccessRights" in patch
      ? { requiredAccessRights: normalizeRequiredAccessRights(patch.requiredAccessRights, id) }
      : {};
    const current = withLibraryDefinitions(docRef.current, libraries, libraryRef.current, classificationDefinitionsRef.current);
    const catalog = authenticationCatalogFor(current, libraryRef.current, libraries.authentication);
    const previousEdge = current.edges.find(edge => edge.id === id);
    if (previousEdge && patch.target && patch.target !== previousEdge.target
        && !Object.prototype.hasOwnProperty.call(patch, "authenticationTypes")) {
      const target = current.nodes.find(node => node.id === patch.target);
      const accepted = new Set(allowedAuthMethodsForNode(target, current.nodeTypes, catalog));
      if ((previousEdge.authenticationTypes ?? []).some(method => !accepted.has(method))) {
        throw new Error("The target node does not accept this edge's existing authentication. Choose an accepted method explicitly before rerouting.");
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "protocolId") && patch.protocolId !== undefined) {
      const resolution = resolveProtocolReference(patch.protocolId, current.protocolDefinitions, protocolLibraryRef.current);
      if (resolution.status !== "resolved" || !resolution.selectable) {
        throw new Error(resolution.status === "unresolved"
          ? "This protocol is unresolved. Choose a profile from the active Communication Library."
          : resolution.status === "resolved" ? resolution.unavailableReason ?? "This protocol is not selectable."
            : "This protocol is not selectable.");
      }
    }
    if ("authenticationTypes" in patch) {
      const edge = docRef.current.edges.find(entry => entry.id === id);
      const target = docRef.current.nodes.find(node => node.id === (patch.target ?? edge?.target));
      const accepted = new Set(allowedAuthMethodsForNode(target, current.nodeTypes, catalog));
      if ((patch.authenticationTypes?.length ?? 0) > 1) throw new Error("Select one authentication method per flow.");
      for (const id of patch.authenticationTypes ?? []) {
        const def = catalog.find(entry => entry.id === id);
        const available = libraryRef.current.find(entry => entry.id === id);
        if (!isAuthenticationType(id) || !def || def.disabled || def.legacy || def.unavailableReason
            || !available || available.disabled) {
          throw new Error(`Authentication method "${id}" is unresolved, disabled or legacy. Select an available method.`);
        }
        if (!accepted.has(id)) throw new Error(`Authentication method "${id}" is not accepted by the target node policy.`);
      }
    }
    if (patch.productionIdentity?.kind === "AppId") {
      const previous = current.edges.find(edge => edge.id === id)?.productionIdentity;
      const nextTenant = patch.productionIdentity.tenant;
      if ((previous?.kind !== "AppId" || previous.tenant !== nextTenant)
          && !libraries.taxonomy.some(def => def.kind === "tenant" && def.id === nextTenant)) {
        throw new Error("This tenant choice requires an available library definition. Existing identity evidence was not changed.");
      }
    }
    snapshot();
    setDoc((d) => withProtocolDefinitions(withAuthenticationDefinitions({
      ...d,
      edges: d.edges.map((e) => {
        if (e.id !== id) return e;
        const merged = { ...e, ...patch, ...rightsPatch };
        // Identity data is independent evidence, including for unresolved or
        // custom methods. Only an explicit field edit removes it.
        return merged;
      }),
    }, catalog), protocolLibraryRef.current));
  }, [snapshot]);

  const deleteEdge = useCallback((id: string) => {
    snapshot();
    setDoc((d) => ({
      ...d,
      edges: d.edges.filter((e) => e.id !== id),
      // Drop comments attached to this edge.
      comments: d.comments.filter(
        (c) => !(c.targetKind === "edge" && c.targetId === id)
      ),
      // Drop issues attached to this edge.
      issues: d.issues.filter(
        (i) => !(i.targetKind === "edge" && i.targetId === id)
      ),
      scenarios: d.scenarios.map((s) => {
        const remaining = s.edgeIds.filter((eid) => eid !== id);
        const newNumbers: Record<string, number> = {};
        remaining.forEach((eid, i) => (newNumbers[eid] = i + 1));
        const { [id]: _dropReq, ...edgeRequestData } = s.edgeRequestData;
        const { [id]: _dropResp, ...edgeResponseData } = s.edgeResponseData;
        void _dropReq;
        void _dropResp;
        return {
          ...s,
          edgeIds: remaining,
          edgeNumbers: newNumbers,
          edgeRequestData,
          edgeResponseData,
        };
      }),
    }));
  }, [snapshot]);

  // -------- Waypoint ops --------
  const addEdgeWaypoint = useCallback(
    (edgeId: string, index: number, pos: Position): Waypoint | null => {
      const cur = docRef.current;
      const edge = cur.edges.find((e) => e.id === edgeId);
      if (!edge) return null;
      snapshot();
      const created: Waypoint = { id: uid("w"), x: pos.x, y: pos.y };
      setDoc((d) => ({
        ...d,
        edges: d.edges.map((e) => {
          if (e.id !== edgeId) return e;
          const arr = [...e.waypoints];
          const i = Math.max(0, Math.min(arr.length, index));
          arr.splice(i, 0, created);
          return { ...e, waypoints: arr };
        }),
      }));
      return created;
    },
    [snapshot]
  );

  const updateEdgeWaypoint = useCallback(
    (edgeId: string, waypointId: string, pos: Position) => {
      setDoc((d) => ({
        ...d,
        edges: d.edges.map((e) => {
          if (e.id !== edgeId) return e;
          return {
            ...e,
            waypoints: e.waypoints.map((w) =>
              w.id === waypointId ? { ...w, x: pos.x, y: pos.y } : w
            ),
          };
        }),
      }));
    },
    []
  );

  const removeEdgeWaypoint = useCallback(
    (edgeId: string, waypointId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        edges: d.edges.map((e) =>
          e.id === edgeId
            ? { ...e, waypoints: e.waypoints.filter((w) => w.id !== waypointId) }
            : e
        ),
      }));
    },
    [snapshot]
  );

  // -------- Data items --------
  const createData = useCallback(
    (classification?: DataClassification): PsData => {
      const library = classificationLibraryRef.current;
      const classificationId = classification === undefined ? library.defaultId : classification;
      if (!isEnabledClassification(library, classificationId)) {
        throw new Error("Choose an enabled classification from the active library for new data.");
      }
      snapshot();
      const item: PsData = {
        id: uid("d"),
        name: "New Data",
        classification: classificationId,
        sample: "",
      };
      setDoc((d) => ({ ...d, data: [...d.data, item] }));
      return item;
    },
    [snapshot]
  );

  const updateData = useCallback(
    (id: string, patch: Partial<PsData>) => {
      const existing = docRef.current.data.find(item => item.id === id);
      if (patch.classification !== undefined && patch.classification !== existing?.classification
          && !isEnabledClassification(classificationLibraryRef.current, patch.classification)) {
        throw new Error("Choose an enabled classification from the active library; existing out-of-list values are retained.");
      }
      snapshot();
      setDoc((d) => ({
        ...d,
        data: d.data.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }));
    },
    [snapshot]
  );

  const deleteData = useCallback(
    (id: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        data: d.data.filter((x) => x.id !== id),
        // Detach from every scenario's node + edge attachments.
        scenarios: d.scenarios.map((s) => {
          let changed = false;
          const nodeData: Record<string, Record<string, Retention>> = {};
          for (const [nodeId, m] of Object.entries(s.nodeData)) {
            if (id in m) {
              const { [id]: _removed, ...rest } = m;
              void _removed;
              nodeData[nodeId] = rest;
              changed = true;
            } else {
              nodeData[nodeId] = m;
            }
          }
          const edgeRequestData: Record<string, string[]> = {};
          for (const [edgeId, ids] of Object.entries(s.edgeRequestData)) {
            if (ids.includes(id)) {
              edgeRequestData[edgeId] = ids.filter((x) => x !== id);
              changed = true;
            } else {
              edgeRequestData[edgeId] = ids;
            }
          }
          const edgeResponseData: Record<string, string[]> = {};
          for (const [edgeId, ids] of Object.entries(s.edgeResponseData)) {
            if (ids.includes(id)) {
              edgeResponseData[edgeId] = ids.filter((x) => x !== id);
              changed = true;
            } else {
              edgeResponseData[edgeId] = ids;
            }
          }
          return changed
            ? { ...s, nodeData, edgeRequestData, edgeResponseData }
            : s;
        }),
      }));
    },
    [snapshot]
  );

  // -------- Work item ops --------
  const createWorkItem = useCallback((initial?: Pick<PsWorkItem, "title" | "description" | "severity" | "workItemType" | "weaknessType">): PsWorkItem => {
    const item = normalizeWorkItem({
      id: uid("wi"),
      description: initial?.description ?? "",
      link: "",
      title: initial?.title ?? "",
      decision: "pending",
      severity: initial?.severity,
      workItemType: initial?.workItemType,
      weaknessType: initial?.weaknessType,
    });
    snapshot();
    setDoc((d) => ({ ...d, workItems: [...d.workItems, item] }));
    return item;
  }, [snapshot]);

  const getCurrentWorkItem = useCallback(
    (id: string) => docRef.current.workItems.find(item => item.id === id),
    [],
  );

  const updateWorkItem = useCallback(
    (id: string, patch: Partial<PsWorkItem>) => {
      const current = getCurrentWorkItem(id);
      if (!current) return;
      const updated = normalizeWorkItem({ ...current, ...patch, id });
      snapshot();
      setDoc((d) => ({
        ...d,
        workItems: d.workItems.map((x) =>
          x.id === id ? updated : x
        ),
      }));
    },
    [snapshot, getCurrentWorkItem]
  );

  const deleteWorkItem = useCallback(
    (id: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        workItems: d.workItems.filter((x) => x.id !== id),
      }));
    },
    [snapshot]
  );

  // -------- Data attachments (per-scenario) --------
  const attachDataToNode = useCallback(
    (
      scenarioId: string,
      nodeId: string,
      dataId: string,
      retention: Retention = "ProcessingNoStorage"
    ) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          const existingForNode = s.nodeData[nodeId] ?? {};
          if (dataId in existingForNode) return s; // already attached
          return {
            ...s,
            nodeData: {
              ...s.nodeData,
              [nodeId]: { ...existingForNode, [dataId]: retention },
            },
          };
        }),
      }));
    },
    [snapshot]
  );

  const detachDataFromNode = useCallback(
    (scenarioId: string, nodeId: string, dataId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          const cur = s.nodeData[nodeId];
          if (!cur || !(dataId in cur)) return s;
          const { [dataId]: _r, ...rest } = cur;
          void _r;
          return {
            ...s,
            nodeData: { ...s.nodeData, [nodeId]: rest },
          };
        }),
      }));
    },
    [snapshot]
  );

  const setNodeDataRetention = useCallback(
    (
      scenarioId: string,
      nodeId: string,
      dataId: string,
      retention: Retention
    ) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          const cur = s.nodeData[nodeId];
          if (!cur || !(dataId in cur)) return s;
          return {
            ...s,
            nodeData: {
              ...s.nodeData,
              [nodeId]: { ...cur, [dataId]: retention },
            },
          };
        }),
      }));
    },
    [snapshot]
  );

  const attachDataToEdge = useCallback(
    (
      scenarioId: string,
      edgeId: string,
      direction: EdgeDataDirection,
      dataId: string,
    ) => {
      snapshot();
      const mapKey =
        direction === "request" ? "edgeRequestData" : "edgeResponseData";
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          const bucket = s[mapKey];
          const cur = bucket[edgeId] ?? [];
          if (cur.includes(dataId)) return s;
          return {
            ...s,
            [mapKey]: { ...bucket, [edgeId]: [...cur, dataId] },
          };
        }),
      }));
    },
    [snapshot]
  );

  const detachDataFromEdge = useCallback(
    (
      scenarioId: string,
      edgeId: string,
      direction: EdgeDataDirection,
      dataId: string,
    ) => {
      snapshot();
      const mapKey =
        direction === "request" ? "edgeRequestData" : "edgeResponseData";
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          const bucket = s[mapKey];
          const cur = bucket[edgeId];
          if (!cur || !cur.includes(dataId)) return s;
          return {
            ...s,
            [mapKey]: {
              ...bucket,
              [edgeId]: cur.filter((x) => x !== dataId),
            },
          };
        }),
      }));
    },
    [snapshot]
  );

  // For each node in the scenario, look at every edge that's part of this
  // scenario, gather the data items attached IN THAT NODE'S DIRECTION, and
  // attach each new one to the node with retention "" (already-attached items
  // are left untouched, including their retention).
  //
  // Direction is now per-bucket: request data on edge X→Y flows TO Y, and
  // response data on edge X→Y flows back TO X. So a node receives the union
  // of (request buckets of edges TARGETING it) ∪ (response buckets of edges
  // SOURCED from it).
  const propagateEdgeDataToNodes = useCallback(
    (scenarioId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map(scenario => scenario.id === scenarioId
          ? propagateScenarioEdgeData(scenario, d.edges) : scenario),
      }));
    },
    [snapshot]
  );

  // -------- Comments --------
  const addComment = useCallback(
    (
      scenarioId: string,
      targetKind: "node" | "edge",
      targetId: string,
      text: string
    ): PsComment => {
      snapshot();
      const comment: PsComment = {
        id: uid("c"),
        scenarioId,
        targetKind,
        targetId,
        text,
        status: "Active",
        createdAt: Date.now(),
        replies: [],
      };
      setDoc((d) => ({ ...d, comments: [...d.comments, comment] }));
      return comment;
    },
    [snapshot]
  );

  const updateCommentText = useCallback(
    (commentId: string, text: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        comments: d.comments.map((c) =>
          c.id === commentId ? { ...c, text } : c
        ),
      }));
    },
    [snapshot]
  );

  const setCommentStatus = useCallback(
    (commentId: string, status: CommentStatus) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        comments: d.comments.map((c) =>
          c.id === commentId ? { ...c, status } : c
        ),
      }));
    },
    [snapshot]
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        comments: d.comments.filter((c) => c.id !== commentId),
      }));
    },
    [snapshot]
  );

  const addCommentReply = useCallback(
    (commentId: string, text: string): CommentReply | null => {
      const cur = docRef.current;
      if (!cur.comments.some((c) => c.id === commentId)) return null;
      snapshot();
      const reply: CommentReply = {
        id: uid("r"),
        text,
        createdAt: Date.now(),
      };
      setDoc((d) => ({
        ...d,
        comments: d.comments.map((c) =>
          c.id === commentId
            ? { ...c, replies: [...c.replies, reply] }
            : c
        ),
      }));
      return reply;
    },
    [snapshot]
  );

  const updateCommentReply = useCallback(
    (commentId: string, replyId: string, text: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        comments: d.comments.map((c) =>
          c.id === commentId
            ? {
                ...c,
                replies: c.replies.map((r) =>
                  r.id === replyId ? { ...r, text } : r
                ),
              }
            : c
        ),
      }));
    },
    [snapshot]
  );

  const deleteCommentReply = useCallback(
    (commentId: string, replyId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        comments: d.comments.map((c) =>
          c.id === commentId
            ? { ...c, replies: c.replies.filter((r) => r.id !== replyId) }
            : c
        ),
      }));
    },
    [snapshot]
  );

  // -------- Issue ops --------
  const addIssue = useCallback(
    (
      targetKind: "node" | "edge",
      targetId: string,
      scenarioIds: string[],
      title: string,
      description: string,
      threatNote?: { origin: "authored-threat"; justification?: string },
      guidanceReferences?: PsIssue["guidanceReferences"]
    ): PsIssue => {
      const issue: PsIssue = {
        id: uid("i"),
        ...(guidanceReferences?.length ? { guidanceReferences: guidanceReferences.map(reference => ({
          ...reference, sources: [...reference.sources],
        })) } : {}),
        targetKind,
        targetId,
        scenarioIds: [...scenarioIds],
        title,
        description,
        status: "Active",
        createdAt: Date.now(),
        replies: [],
        ...(threatNote ? threatNoteFields({ ...threatNote, title, description }) : {}),
      };
      if (threatNote) validateThreatNotes({ ...docRef.current, issues: [...docRef.current.issues, issue] });
      snapshot();
      setDoc((d) => ({ ...d, issues: [...d.issues, issue] }));
      return issue;
    },
    [snapshot]
  );

  const updateIssue = useCallback(
    (
      id: string,
      patch: Partial<Pick<PsIssue, "title" | "description" | "scenarioIds" | "justification">>
    ) => {
      const current = docRef.current.issues.find(issue => issue.id === id);
      if (current && (isAuthoredThreatNote(current) || patch.justification !== undefined)) {
        validateThreatNotes({ ...docRef.current, issues: docRef.current.issues.map(issue =>
          issue.id === id ? { ...issue, ...patch } : issue) });
      }
      snapshot();
      setDoc((d) => ({
        ...d,
        issues: d.issues.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      }));
    },
    [snapshot]
  );

  const setIssueStatus = useCallback(
    (id: string, status: IssueStatus) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        issues: d.issues.map((i) => (i.id === id ? { ...i, status } : i)),
      }));
    },
    [snapshot]
  );

  const deleteIssue = useCallback(
    (id: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        issues: d.issues.filter((i) => i.id !== id),
      }));
    },
    [snapshot]
  );

  // -------- Deviation ops --------
  const validateDeviationInput = useCallback(
    (
      input: Pick<PsDeviation, "key" | "title" | "explanation" | "kind">
    ) => {
      if (!input.key.trim()) throw new Error("Deviation key is required.");
      if (!isCatalogReferenceId(input.kind)) throw new Error("Invalid deviation kind.");
      if (!input.title.trim()) throw new Error("Deviation title is required.");
      if (!input.explanation.trim()) {
        throw new Error("Deviation explanation is required.");
      }
    },
    []
  );

  const addDeviation = useCallback(
    (
      input: Omit<PsDeviation, "id" | "createdAt" | "updatedAt">
    ): PsDeviation => {
      validateDeviationInput(input);
      assertCatalogSelection("deviation", input.kind, undefined, libraries.taxonomy);
      if (
        docRef.current.deviations.some(
          (deviation) =>
            deviation.key.trim().toLowerCase() === input.key.trim().toLowerCase()
        )
      ) {
        throw new Error(`A deviation with key "${input.key.trim()}" already exists.`);
      }
      snapshot();
      const now = Date.now();
      const { targetKind, targetId, sampleCalls, ...rest } = input;
      const normalizedSampleCalls = normalizeDeviationSampleCalls(sampleCalls);
      const deviation: PsDeviation = {
        ...rest,
        id: uid("dv"),
        key: input.key.trim(),
        title: input.title.trim(),
        explanation: input.explanation.trim(),
        evidenceIds: Array.from(new Set(input.evidenceIds.map((id) => id.trim()).filter(Boolean))),
        ...(normalizedSampleCalls.length > 0
          ? { sampleCalls: normalizedSampleCalls }
          : {}),
        scenarioIds: Array.from(new Set(input.scenarioIds)).filter((scenarioId) =>
          docRef.current.scenarios.some((scenario) => scenario.id === scenarioId)
        ),
        ...(targetKind && targetId ? { targetKind, targetId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      setDoc((d) => ({ ...d, deviations: [...d.deviations, deviation] }));
      return deviation;
    },
    [snapshot, validateDeviationInput]
  );

  const upsertDeviation = useCallback(
    (
      input: Omit<PsDeviation, "id" | "createdAt" | "updatedAt">
    ): PsDeviation => {
      validateDeviationInput(input);
      const existing = docRef.current.deviations.find(
        (deviation) =>
          deviation.key.trim().toLowerCase() === input.key.trim().toLowerCase()
      );
      if (!existing) {
        return addDeviation(input);
      }
      assertCatalogSelection("deviation", input.kind, existing.kind, libraries.taxonomy);
      snapshot();
      const normalizedSampleCalls =
        input.sampleCalls === undefined
          ? existing.sampleCalls
          : normalizeDeviationSampleCalls(input.sampleCalls);
      const deviation: PsDeviation = {
        ...existing,
        ...input,
        key: input.key.trim(),
        title: input.title.trim(),
        explanation: input.explanation.trim(),
        evidenceIds: Array.from(new Set(input.evidenceIds.map((id) => id.trim()).filter(Boolean))),
        ...(input.sampleCalls === undefined
          ? {}
          : {
              sampleCalls:
                normalizedSampleCalls && normalizedSampleCalls.length > 0
                  ? normalizedSampleCalls
                  : undefined,
            }),
        scenarioIds: Array.from(new Set(input.scenarioIds)).filter((scenarioId) =>
          docRef.current.scenarios.some((scenario) => scenario.id === scenarioId)
        ),
        status: input.status,
        updatedAt: Date.now(),
      };
      setDoc((d) => ({
        ...d,
        deviations: d.deviations.map((candidate) =>
          candidate.id === existing.id ? deviation : candidate
        ),
      }));
      return deviation;
    },
    [addDeviation, snapshot, validateDeviationInput]
  );

  const updateDeviation = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          PsDeviation,
          | "key"
          | "kind"
          | "title"
          | "description"
          | "explanation"
          | "evidenceIds"
          | "sampleCalls"
          | "targetKind"
          | "targetId"
          | "scenarioIds"
        >
      >
    ) => {
      const existing = docRef.current.deviations.find((item) => item.id === id);
      if (!existing) return;
      const next = { ...existing, ...patch };
      assertCatalogSelection("deviation", next.kind, existing.kind, libraries.taxonomy);
      const normalizedSampleCalls =
        patch.sampleCalls === undefined
          ? existing.sampleCalls
          : normalizeDeviationSampleCalls(patch.sampleCalls);
      validateDeviationInput(next);
      if (
        docRef.current.deviations.some(
          (item) =>
            item.id !== id &&
            item.key.trim().toLowerCase() === next.key.trim().toLowerCase()
        )
      ) {
        throw new Error(`A deviation with key "${next.key.trim()}" already exists.`);
      }
      const updatedAt = Date.now();
      snapshot();
      setDoc((d) => ({
        ...d,
        deviations: d.deviations.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
                key: next.key.trim(),
                title: next.title.trim(),
                explanation: next.explanation.trim(),
                evidenceIds: Array.from(
                  new Set(next.evidenceIds.map((evidenceId) => evidenceId.trim()).filter(Boolean))
                ),
                ...(normalizedSampleCalls && normalizedSampleCalls.length > 0
                  ? { sampleCalls: normalizedSampleCalls }
                  : { sampleCalls: undefined }),
                scenarioIds: Array.from(new Set(next.scenarioIds)),
                updatedAt,
              }
            : item
        ),
      }));
    },
    [snapshot, validateDeviationInput]
  );

  const setDeviationStatus = useCallback(
    (id: string, status: DeviationStatus) => {
      const updatedAt = Date.now();
      snapshot();
      setDoc((d) => ({
        ...d,
        deviations: d.deviations.map((item) =>
          item.id === id ? { ...item, status, updatedAt } : item
        ),
      }));
    },
    [snapshot]
  );

  const deleteDeviation = useCallback(
    (id: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        deviations: d.deviations.filter((item) => item.id !== id),
      }));
    },
    [snapshot]
  );

  const addIssueReply = useCallback(
    (issueId: string, text: string): IssueReply | null => {
      const cur = docRef.current;
      if (!cur.issues.some((i) => i.id === issueId)) return null;
      snapshot();
      const reply: IssueReply = {
        id: uid("ir"),
        text,
        createdAt: Date.now(),
      };
      setDoc((d) => ({
        ...d,
        issues: d.issues.map((i) =>
          i.id === issueId ? { ...i, replies: [...i.replies, reply] } : i
        ),
      }));
      return reply;
    },
    [snapshot]
  );

  const updateIssueReply = useCallback(
    (issueId: string, replyId: string, text: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        issues: d.issues.map((i) =>
          i.id === issueId
            ? {
                ...i,
                replies: i.replies.map((r) =>
                  r.id === replyId ? { ...r, text } : r
                ),
              }
            : i
        ),
      }));
    },
    [snapshot]
  );

  const deleteIssueReply = useCallback(
    (issueId: string, replyId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        issues: d.issues.map((i) =>
          i.id === issueId
            ? { ...i, replies: i.replies.filter((r) => r.id !== replyId) }
            : i
        ),
      }));
    },
    [snapshot]
  );

  // Evaluate before taking history: an evaluator failure must leave both
  // the document and Undo/Redo untouched. Commit a successful pass atomically.
  const analyze = useCallback((): number => {
    const manager = new IssueManager(classificationDefinitionsRef.current, undefined, libraries.rules,
      libraries.fields, libraries.authentication, libraries.help, protocolLibraryRef.current);
    const current = withLibraryDefinitions(docRef.current, libraries, libraryRef.current, classificationDefinitionsRef.current);
    const next = manager.analyze(withAuthenticationDefinitions(current, authenticationCatalogFor(current, libraryRef.current, libraries.authentication)));
    snapshot();
    setDoc(next);
    return next.issues.filter(
      (i) => i.kind != null && i.status === "Active"
    ).length;
  }, [snapshot]);

  // -------- Boundary ops --------
  const createBoundary = useCallback(
    (
      type: "security" | "privacy",
      position: Position,
      size: Size
    ): PsBoundary => {
      snapshot();
      const b: PsBoundary = {
        id: uid("b"),
        type,
        title: "",
        position,
        size,
        nodeIds: [],
        ...(type === "privacy" && PRIVACY_BOUNDARY_TYPE_DEFS.length > 0
          ? { privacySubtype: PRIVACY_BOUNDARY_TYPE_DEFS[0].id }
          : {}),
        ...(type === "security" && SECURITY_BOUNDARY_TYPE_DEFS.length > 0
          ? { securitySubtype: SECURITY_BOUNDARY_TYPE_DEFS[0].id }
          : {}),
      };
      setDoc((d) => {
        const adopted = adoptNodesIntoBoundary(
          d.nodes,
          [...d.boundaries, b],
          b.id,
        );
        return { ...d, nodes: adopted.nodes, boundaries: adopted.boundaries };
      });
      return b;
    },
    [snapshot]
  );

  const updateBoundary = useCallback(
    (id: string, patch: Partial<PsBoundary>) => {
      const normalizedPatch = { ...patch };
      for (const { key, label } of BOUNDARY_NETWORK_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          normalizedPatch[key] = normalizeBoundaryNetworkText(patch[key], label);
        }
      }
      const existing = docRef.current.boundaries.find(boundary => boundary.id === id);
      if (patch.privacySubtype !== undefined) assertCatalogSelection(
        "privacyBoundary", patch.privacySubtype, existing?.type === "privacy" ? existing.privacySubtype : undefined, libraries.taxonomy,
      );
      if (patch.securitySubtype !== undefined) assertCatalogSelection(
        "securityBoundary", patch.securitySubtype, existing?.type === "security" ? existing.securitySubtype : undefined, libraries.taxonomy,
      );
      snapshot();
      setDoc((d) => ({
        ...d,
        boundaries: d.boundaries.map((b) => {
          if (b.id !== id) return b;
          const merged = { ...b, ...normalizedPatch };
          // The non-matching subtype is always stripped (privacySubtype is
          // meaningless on a security boundary, and vice versa). The matching
          // subtype is left alone — including when the user explicitly clears
          // it to "(unspecified)", since selecting unspecified is a valid
          // choice.
          if (merged.type === "security") {
            delete merged.privacySubtype;
          } else if (merged.type === "privacy") {
            delete merged.securitySubtype;
          }
          return merged;
        }),
      }));
    },
    [snapshot]
  );

  // moveBoundary / resizeBoundary are called repeatedly during drag/resize —
  // the caller (DiagramCanvas onNodeDragStart) snapshots once at gesture start.
  const moveBoundary = useCallback((id: string, position: Position) => {
    setDoc((d) => {
      const boundary = d.boundaries.find((item) => item.id === id);
      if (!boundary) return d;
      const delta = {
        x: position.x - boundary.position.x,
        y: position.y - boundary.position.y,
      };
      const movedNodeIds = new Set(boundary.nodeIds);
      const nodes = d.nodes.map((node) =>
        movedNodeIds.has(node.id)
          ? {
              ...node,
              position: {
                x: node.position.x + delta.x,
                y: node.position.y + delta.y,
              },
            }
          : node,
      );
      let boundaries = d.boundaries.map((item) =>
        item.id === id ? { ...item, position } : item,
      );
      for (const node of nodes) {
        if (!movedNodeIds.has(node.id)) continue;
        boundaries = boundaries.map((item) => {
          if (item.id === id || !item.nodeIds.includes(node.id)) return item;
          const expanded = expandRectToContain(
            boundaryRect(item),
            nodeRect(node),
          );
          return {
            ...item,
            position: expanded.position,
            size: expanded.size,
          };
        });
      }
      return { ...d, nodes, boundaries };
    });
  }, []);

  const finishBoundaryMove = useCallback((id: string) => {
    setDoc((d) => {
      const adopted = adoptNodesIntoBoundary(d.nodes, d.boundaries, id);
      return { ...d, nodes: adopted.nodes, boundaries: adopted.boundaries };
    });
  }, []);

  const resizeBoundary = useCallback(
    (id: string, size: Size, position?: Position) => {
      setDoc((d) => {
        const boundary = d.boundaries.find((item) => item.id === id);
        if (!boundary) return d;
        let rect = {
          position: position ?? boundary.position,
          size,
        };
        for (const node of d.nodes) {
          if (boundary.nodeIds.includes(node.id)) {
            rect = expandRectToContain(rect, nodeRect(node));
          }
        }
        return {
          ...d,
          boundaries: d.boundaries.map((item) =>
            item.id === id
              ? { ...item, position: rect.position, size: rect.size }
              : item,
          ),
        };
      });
    },
    [],
  );

  const finishBoundaryResize = useCallback((id: string) => {
    setDoc((d) => {
      const adopted = adoptNodesIntoBoundary(d.nodes, d.boundaries, id);
      return { ...d, nodes: adopted.nodes, boundaries: adopted.boundaries };
    });
  }, []);

  const removeNodeFromBoundary = useCallback(
    (nodeId: string, boundaryId: string) => {
      snapshot();
      setDoc((d) => {
        const node = d.nodes.find((item) => item.id === nodeId);
        const boundary = d.boundaries.find((item) => item.id === boundaryId);
        if (!node || !boundary || !boundary.nodeIds.includes(nodeId)) return d;

        const remainingBoundaries = d.boundaries.filter(
          (item) =>
            item.id !== boundaryId && item.nodeIds.includes(nodeId),
        );
        const position = placeNodeOutsideBoundary(
          node,
          boundary,
          remainingBoundaries,
        );
        const movedNode = { ...node, position };
        const boundaries = d.boundaries.map((item) => {
          if (item.id === boundaryId) {
            return {
              ...item,
              nodeIds: item.nodeIds.filter((id) => id !== nodeId),
            };
          }
          if (!item.nodeIds.includes(nodeId)) return item;
          const expanded = expandRectToContain(
            boundaryRect(item),
            nodeRect(movedNode),
          );
          return {
            ...item,
            position: expanded.position,
            size: expanded.size,
          };
        });
        return {
          ...d,
          nodes: d.nodes.map((item) =>
            item.id === nodeId ? movedNode : item,
          ),
          boundaries,
        };
      });
    },
    [snapshot],
  );

  const deleteBoundary = useCallback((id: string) => {
    snapshot();
    setDoc((d) => ({
      ...d,
      boundaries: d.boundaries.filter((b) => b.id !== id),
      scenarios: d.scenarios.map((s) =>
        s.boundaryIds.includes(id)
          ? { ...s, boundaryIds: s.boundaryIds.filter((bid) => bid !== id) }
          : s
      ),
    }));
  }, [snapshot]);

  // -------- Canvas annotations --------
  const createTextAnnotation = useCallback((position: Position): PsTextAnnotation => {
    const annotation = { id: uid("a"), text: "", position, size: { width: 300, height: 120 } };
    const scenarioId = activeScenarioIdRef.current;
    snapshot();
    setDoc(d => ({
      ...d, textAnnotations: [...(d.textAnnotations ?? []), annotation],
      scenarios: d.scenarios.map(s => s.id === scenarioId
        ? { ...s, textAnnotationIds: [...(s.textAnnotationIds ?? []), annotation.id] } : s),
    }));
    return annotation;
  }, [snapshot]);

  const updateTextAnnotation = useCallback((id: string, patch: Partial<Omit<PsTextAnnotation, "id">>, snapshotBefore = true) => {
    const current = docRef.current.textAnnotations?.find(annotation => annotation.id === id);
    if (!current || Object.entries(patch).every(([key, value]) =>
      JSON.stringify(current[key as keyof PsTextAnnotation]) === JSON.stringify(value))) return;
    normalizeTextAnnotations({ textAnnotations: [{ ...current, ...patch, id }] });
    if (snapshotBefore) snapshot();
    setDoc(d => ({ ...d, textAnnotations: d.textAnnotations?.map(annotation =>
      annotation.id === id ? { ...annotation, ...patch, id } : annotation) }));
  }, [snapshot]);

  const deleteTextAnnotation = useCallback((id: string) => {
    snapshot();
    setDoc(d => ({
      ...d, textAnnotations: d.textAnnotations?.filter(annotation => annotation.id !== id),
      scenarios: d.scenarios.map(s => s.textAnnotationIds?.includes(id)
        ? { ...s, textAnnotationIds: s.textAnnotationIds.filter(member => member !== id) } : s),
    }));
  }, [snapshot]);

  const setTextAnnotationMembership = useCallback((scenarioId: string, id: string, included: boolean) => {
    snapshot();
    setDoc(d => !d.textAnnotations?.some(annotation => annotation.id === id) ? d : ({
      ...d, scenarios: d.scenarios.map(s => s.id !== scenarioId ? s : {
        ...s, textAnnotationIds: included ? [...new Set([...(s.textAnnotationIds ?? []), id])]
          : (s.textAnnotationIds ?? []).filter(member => member !== id),
      }),
    }));
    if (!included && activeScenarioIdRef.current === scenarioId) {
      setSelectionRaw(current => current?.kind === "annotation" && current.id === id ? null : current);
      setMultiSelectedIds(current => current.filter(member => member !== id));
    }
  }, [snapshot]);

  // -------- Scenario ops --------
  const createScenario = useCallback(
    (name: string, description = ""): Scenario => {
      snapshot();
      const s: Scenario = {
        id: uid("s"),
        name: name || "New Scenario",
        description,
        nodeIds: [],
        edgeIds: [],
        edgeNumbers: {},
        boundaryIds: [],
        nodeScopeReasons: {},
        nodeData: {},
        edgeRequestData: {},
        edgeResponseData: {},
      };
      setDoc((d) => ({ ...d, scenarios: [...d.scenarios, s] }));
      return s;
    },
    [snapshot]
  );

  const cloneScenario = useCallback(
    (sourceId: string, name: string, description = ""): Scenario | null => {
      const source = docRef.current.scenarios.find((s) => s.id === sourceId);
      if (!source) return null;
      snapshot();
      // Deep-copy every per-scenario collection so edits to the new
      // scenario don't bleed back into the source. Nodes/edges/boundaries
      // themselves are global and intentionally shared.
      const clonedNodeData: Record<string, Record<string, Retention>> = {};
      for (const [nid, dataMap] of Object.entries(source.nodeData)) {
        clonedNodeData[nid] = { ...dataMap };
      }
      const clonedEdgeRequestData: Record<string, string[]> = {};
      for (const [eid, dataIds] of Object.entries(source.edgeRequestData)) {
        clonedEdgeRequestData[eid] = [...dataIds];
      }
      const clonedEdgeResponseData: Record<string, string[]> = {};
      for (const [eid, dataIds] of Object.entries(source.edgeResponseData)) {
        clonedEdgeResponseData[eid] = [...dataIds];
      }
      const s: Scenario = {
        id: uid("s"),
        name: name || `${source.name} (copy)`,
        description: description || source.description,
        nodeIds: [...source.nodeIds],
        edgeIds: [...source.edgeIds],
        edgeNumbers: { ...source.edgeNumbers },
        boundaryIds: [...source.boundaryIds],
        ...(source.textAnnotationIds ? { textAnnotationIds: [...source.textAnnotationIds] } : {}),
        ...(source.nodeScopeReasons ? { nodeScopeReasons: structuredClone(source.nodeScopeReasons) } : {}),
        ...(source.nodeScopeReasonsRecovery ? { nodeScopeReasonsRecovery: { ...source.nodeScopeReasonsRecovery } } : {}),
        nodeData: clonedNodeData,
        edgeRequestData: clonedEdgeRequestData,
        edgeResponseData: clonedEdgeResponseData,
      };
      setDoc((d) => ({ ...d, scenarios: [...d.scenarios, s] }));
      return s;
    },
    [snapshot]
  );

  const renameScenario = useCallback((id: string, name: string) => {
    snapshot();
    setDoc((d) => ({
      ...d,
      scenarios: d.scenarios.map((s) => (s.id === id ? { ...s, name } : s)),
    }));
  }, [snapshot]);

  const updateScenario = useCallback(
    (id: string, patch: Partial<Scenario>) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) =>
          s.id === id ? { ...s, ...patch } : s
        ),
      }));
    },
    [snapshot]
  );

  const deleteScenario = useCallback(
    (id: string) => {
      const nextActiveScenarioId =
        activeScenarioIdRef.current === id
          ? (docRef.current.scenarios.find((scenario) => scenario.id !== id)
              ?.id ?? null)
          : activeScenarioIdRef.current;
      const updatedAt = Date.now();
      snapshot();
      setDoc((d) => {
        const remainingScenarios = d.scenarios.filter((s) => s.id !== id);

        // Cascade-delete nodes and edges no longer referenced by any remaining
        // scenario. This includes edges whose endpoints are shared but whose
        // only scenario membership was the deleted scenario.
        const { orphanNodeIds, orphanEdgeIds, orphanAnnotationIds } =
          calculateScenarioDeletionImpact(d, id);

        const scenariosWithoutDeleted = remainingScenarios.map((s) => {
          const removesNode = s.nodeIds.some((nid) => orphanNodeIds.has(nid));
          const removesEdge = s.edgeIds.some((eid) => orphanEdgeIds.has(eid));
          const removesReason = Object.keys(s.nodeScopeReasons ?? {}).some(nid => orphanNodeIds.has(nid));
          if (!removesNode && !removesEdge && !removesReason) {
            return s;
          }
          const remainingEdgeIds = s.edgeIds.filter(
            (eid) => !orphanEdgeIds.has(eid),
          );
          const edgeNumbers: Record<string, number> = {};
          remainingEdgeIds.forEach((eid, index) => {
            edgeNumbers[eid] = s.edgeNumbers[eid] ?? index + 1;
          });
          const nodeData: Record<string, unknown> = {};
          for (const [nid, v] of Object.entries(s.nodeData)) {
            if (!orphanNodeIds.has(nid)) nodeData[nid] = v;
          }
          const { edgeRequestData, edgeResponseData } =
            pruneEdgesFromScenarioBuckets(s, orphanEdgeIds);
          return {
            ...s,
            ...normalizeNodeScope(s, new Set(d.nodes.filter(node => !orphanNodeIds.has(node.id)).map(node => node.id))),
            nodeIds: s.nodeIds.filter((nid) => !orphanNodeIds.has(nid)),
            edgeIds: remainingEdgeIds,
            edgeNumbers,
            nodeData: nodeData as Scenario["nodeData"],
            edgeRequestData,
            edgeResponseData,
          };
        });

        return {
          ...d,
          scenarios: scenariosWithoutDeleted,
          ...(d.textAnnotations ? { textAnnotations: d.textAnnotations.filter(annotation => !orphanAnnotationIds.has(annotation.id)) } : {}),
          nodes: d.nodes.filter((n) => !orphanNodeIds.has(n.id)),
          edges: d.edges.filter((e) => !orphanEdgeIds.has(e.id)),
          boundaries: d.boundaries.map((boundary) => ({
            ...boundary,
            nodeIds: boundary.nodeIds.filter(
              (nodeId) => !orphanNodeIds.has(nodeId),
            ),
          })),
          // Comments are scoped to a scenario — drop any that belonged
          // to the deleted scenario, and any whose target node/edge was
          // cascade-deleted.
          comments: d.comments.filter(
            (c) =>
              c.scenarioId !== id &&
              !(c.targetKind === "node" && orphanNodeIds.has(c.targetId)) &&
              !(c.targetKind === "edge" && orphanEdgeIds.has(c.targetId)),
          ),
          // Ordinary issues keep historical behavior; authored notes never
          // widen to all scenarios when their final selected scenario is lost.
          issues: d.issues
            .flatMap((i) => removeThreatNoteScenario(i, id))
            .filter(
              (i) =>
                !(i.targetKind === "node" && orphanNodeIds.has(i.targetId)) &&
                !(i.targetKind === "edge" && orphanEdgeIds.has(i.targetId)),
            ),
          // Deviations are evidence records and survive target deletion, but
          // a deleted scenario can no longer remain as navigation context.
          deviations: d.deviations.map((deviation) =>
            deviation.scenarioIds.includes(id)
              ? {
                  ...deviation,
                  scenarioIds: deviation.scenarioIds.filter(
                    (scenarioId) => scenarioId !== id,
                  ),
                  updatedAt,
                }
              : deviation,
          ),
        };
      });
      setActiveScenarioId(nextActiveScenarioId);
    },
    [snapshot, setActiveScenarioId],
  );

  const addNodeToScenario = useCallback(
    (scenarioId: string, nodeId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) =>
          s.id === scenarioId && !s.nodeIds.includes(nodeId)
            ? { ...s, nodeIds: [...s.nodeIds, nodeId] }
            : s
        ),
      }));
    },
    [snapshot]
  );

  const removeNodeFromScenario = useCallback(
    (scenarioId: string, nodeId: string) => {
      const updatedAt = Date.now();
      snapshot();
      setDoc((d) => {
        // also remove edges that touch this node from the scenario
        const removedEdges = new Set(
          d.edges
            .filter((e) => e.source === nodeId || e.target === nodeId)
            .map((e) => e.id)
        );
        return {
          ...d,
          scenarios: d.scenarios.map((s) => {
            if (s.id !== scenarioId) return s;
            const remainingEdges = s.edgeIds.filter(
              (eid) => !removedEdges.has(eid)
            );
            const numbers: Record<string, number> = {};
            remainingEdges.forEach((eid, i) => (numbers[eid] = i + 1));
            const { [nodeId]: _dropped, ...nodeData } = s.nodeData;
            void _dropped;
            const { edgeRequestData, edgeResponseData } =
              pruneEdgesFromScenarioBuckets(s, removedEdges);
            return {
              ...s,
              nodeIds: s.nodeIds.filter((n) => n !== nodeId),
              edgeIds: remainingEdges,
              edgeNumbers: numbers,
              nodeData,
              edgeRequestData,
              edgeResponseData,
            };
          }),
          // Drop comments scoped to this scenario for the removed node OR for
          // any edge that left the scenario with it. Comments on the same
          // target in OTHER scenarios are untouched.
          comments: d.comments.filter(
            (c) =>
              c.scenarioId !== scenarioId ||
              (!(c.targetKind === "node" && c.targetId === nodeId) &&
                !(c.targetKind === "edge" && removedEdges.has(c.targetId)))
          ),
          // Remove scoped notes rather than silently broadening applicability.
          issues: d.issues.flatMap((i) => {
            const affected =
              (i.targetKind === "node" && i.targetId === nodeId) ||
              (i.targetKind === "edge" && removedEdges.has(i.targetId));
            return affected ? removeThreatNoteScenario(i, scenarioId) : [i];
          }),
          deviations: d.deviations.map((deviation) => {
            const affected =
              (deviation.targetKind === "node" &&
                deviation.targetId === nodeId) ||
              (deviation.targetKind === "edge" &&
                deviation.targetId != null &&
                removedEdges.has(deviation.targetId));
            if (!affected || !deviation.scenarioIds.includes(scenarioId)) {
              return deviation;
            }
            return {
              ...deviation,
              scenarioIds: deviation.scenarioIds.filter(
                (id) => id !== scenarioId,
              ),
              updatedAt,
            };
          }),
        };
      });
    },
    [snapshot]
  );

  const addEdgeToScenario = useCallback(
    (scenarioId: string, edgeId: string) => {
      snapshot();
      setDoc((d) => {
        const edge = d.edges.find((e) => e.id === edgeId);
        if (!edge) return d;
        return {
          ...d,
          scenarios: d.scenarios.map((s) => {
            if (s.id !== scenarioId) return s;
            if (s.edgeIds.includes(edgeId)) return s;
            // Ensure source & target nodes are included.
            const nodeIds = Array.from(
              new Set([...s.nodeIds, edge.source, edge.target])
            );
            const edgeIds = [...s.edgeIds, edgeId];
            const numbers: Record<string, number> = {};
            edgeIds.forEach((eid, i) => (numbers[eid] = i + 1));
            return { ...s, nodeIds, edgeIds, edgeNumbers: numbers };
          }),
        };
      });
    },
    [snapshot]
  );

  const removeEdgeFromScenario = useCallback(
    (scenarioId: string, edgeId: string) => {
      const updatedAt = Date.now();
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          const edgeIds = s.edgeIds.filter((eid) => eid !== edgeId);
          const numbers: Record<string, number> = {};
          edgeIds.forEach((eid, i) => (numbers[eid] = i + 1));
          const { [edgeId]: _dropReq, ...edgeRequestData } = s.edgeRequestData;
          const { [edgeId]: _dropResp, ...edgeResponseData } =
            s.edgeResponseData;
          void _dropReq;
          void _dropResp;
          return {
            ...s,
            edgeIds,
            edgeNumbers: numbers,
            edgeRequestData,
            edgeResponseData,
          };
        }),
        // Drop comments scoped to this (scenario, edge). Other scenarios that
        // still include this edge keep their comments.
        comments: d.comments.filter(
          (c) =>
            !(
              c.scenarioId === scenarioId &&
              c.targetKind === "edge" &&
              c.targetId === edgeId
            )
        ),
        issues: d.issues.flatMap((i) =>
          i.targetKind === "edge" &&
          i.targetId === edgeId &&
          i.scenarioIds.includes(scenarioId)
            ? removeThreatNoteScenario(i, scenarioId)
            : [i]
        ),
        deviations: d.deviations.map((deviation) =>
          deviation.targetKind === "edge" &&
          deviation.targetId === edgeId &&
          deviation.scenarioIds.includes(scenarioId)
            ? {
                ...deviation,
                scenarioIds: deviation.scenarioIds.filter(
                  (id) => id !== scenarioId,
                ),
                updatedAt,
              }
            : deviation
        ),
      }));
    },
    [snapshot]
  );

  const addBoundaryToScenario = useCallback(
    (scenarioId: string, boundaryId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) =>
          s.id === scenarioId && !s.boundaryIds.includes(boundaryId)
            ? { ...s, boundaryIds: [...s.boundaryIds, boundaryId] }
            : s
        ),
      }));
    },
    [snapshot]
  );

  const removeBoundaryFromScenario = useCallback(
    (scenarioId: string, boundaryId: string) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) =>
          s.id === scenarioId
            ? {
                ...s,
                boundaryIds: s.boundaryIds.filter((bid) => bid !== boundaryId),
              }
            : s
        ),
      }));
    },
    [snapshot]
  );

  const moveEdgeInScenario = useCallback(
    (scenarioId: string, edgeId: string, direction: -1 | 1) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          const idx = s.edgeIds.indexOf(edgeId);
          if (idx === -1) return s;
          const newIdx = idx + direction;
          if (newIdx < 0 || newIdx >= s.edgeIds.length) return s;
          const arr = [...s.edgeIds];
          const [moved] = arr.splice(idx, 1);
          arr.splice(newIdx, 0, moved);
          const numbers: Record<string, number> = {};
          arr.forEach((eid, i) => (numbers[eid] = i + 1));
          return { ...s, edgeIds: arr, edgeNumbers: numbers };
        }),
      }));
    },
    [snapshot]
  );

  const setEdgeNumberInScenario = useCallback(
    (scenarioId: string, edgeId: string, num: number) => {
      snapshot();
      setDoc((d) => ({
        ...d,
        scenarios: d.scenarios.map((s) => {
          if (s.id !== scenarioId) return s;
          if (!s.edgeIds.includes(edgeId)) return s;
          // Move edgeId to position num-1 in the ordered list.
          const others = s.edgeIds.filter((eid) => eid !== edgeId);
          const target = Math.max(0, Math.min(others.length, num - 1));
          const arr = [...others];
          arr.splice(target, 0, edgeId);
          const numbers: Record<string, number> = {};
          arr.forEach((eid, i) => (numbers[eid] = i + 1));
          return { ...s, edgeIds: arr, edgeNumbers: numbers };
        }),
      }));
    },
    [snapshot]
  );

  const renumberScenario = useCallback((scenarioId: string) => {
    snapshot();
    setDoc((d) => ({
      ...d,
      scenarios: d.scenarios.map((s) => {
        if (s.id !== scenarioId) return s;
        const numbers: Record<string, number> = {};
        s.edgeIds.forEach((eid, i) => (numbers[eid] = i + 1));
        return { ...s, edgeNumbers: numbers };
      }),
    }));
  }, [snapshot]);

  // -------- Node type ops --------
  const addNodeType = useCallback(
    (label: string): string | undefined => {
      const trimmed = label.trim();
      if (!trimmed) return undefined;
      const lc = trimmed.toLowerCase();

      // Reuse an existing entry whose label (or id, for catalog entries
      // whose id is the label) matches case-insensitively, so the picker
      // doesn't accumulate duplicates that all render the same.
      const existing = docRef.current.nodeTypes.find(
        (t) => t.label.toLowerCase() === lc || t.id.toLowerCase() === lc
      );
      if (existing) return existing.id;

      // A catalog entry might exist that hasn't been seeded into this
      // doc's nodeTypes yet — keep its stable id so future docs converge.
      const catalogMatch = NODE_TYPE_DEFS.find(
        (d) => d.label.toLowerCase() === lc || d.id.toLowerCase() === lc
      );
      if (catalogMatch) {
        const existingCatalogRef = docRef.current.nodeTypes.find(
          (type) => type.id === catalogMatch.id,
        );
        if (existingCatalogRef) return existingCatalogRef.id;
      }
      const newId = catalogMatch ? catalogMatch.id : uid("nt");
      const newLabel = catalogMatch ? catalogMatch.label : trimmed;

      snapshot();
      setDoc((d) => ({
        ...d,
        nodeTypes: [
          ...d.nodeTypes,
          {
            id: newId,
            label: newLabel,
            ...(catalogMatch
              ? {}
              : { definition: emptyNodeTypeDefinition() }),
          },
        ],
      }));
      return newId;
    },
    [snapshot]
  );

  const saveNodeType = useCallback(
    (nodeType: NodeTypeRef): boolean => {
      const id = nodeType.id.trim();
      const label = nodeType.label.trim();
      const identityError = inventoryIdError(nodeType.definition?.serviceTreeId ?? "", inventoryFieldFor(libraries.fields));
      if (identityError) {
        window.alert(identityError);
        return false;
      }
      let definition: NodeTypeDefinition | undefined;
      try { definition = normalizeNodeTypeDefinition(nodeType.definition); }
      catch (error) {
        window.alert(error instanceof Error ? error.message : "Invalid AI design guidance.");
        return false;
      }
      if (!id || !label || !definition) return false;
      const previous = resolveNodeTypeDef(id, libraryNodeTypes(docRef.current, libraries));
      try { assertCatalogSelection("privacyBoundary", definition.defaultPrivacyBoundary, previous?.defaultPrivacyBoundary, libraries.taxonomy); }
      catch (error) {
        window.alert(error instanceof Error ? error.message : "The privacy boundary definition is unavailable.");
        return false;
      }

      snapshot();
      setDoc((d) => {
        const next = { id, label, definition };
        const exists = d.nodeTypes.some((type) => type.id === id);
        return withAuthenticationDefinitions({
          ...d,
          nodeTypes: exists
            ? d.nodeTypes.map((type) => (type.id === id ? next : type))
            : [...d.nodeTypes, next],
          nodes: applyNodeTypeMetadata(d.nodes, id, previous, definition),
        }, authenticationCatalogFor(d, libraryRef.current, libraries.authentication));
      });
      return true;
    },
    [snapshot],
  );

  const saveNodeTypeGuidance = useCallback((id: string, guidance: AiDesignGuidance | undefined) => {
    const current = docRef.current;
    const next = withNodeTypeGuidance(current, libraryNodeTypes(current, libraries), id, guidance);
    if (next === current) return;
    snapshot();
    setDoc(next);
  }, [snapshot, libraries]);

  const removeNodeType = useCallback(
    (id: string): "deleted" | "reset" | "in-use" | "missing" => {
      const current = docRef.current;
      const existing = current.nodeTypes.find((type) => type.id === id);
      if (!existing) return "missing";

      const builtIn = NODE_TYPE_DEF_MAP[id];
      if (builtIn) {
        if (!existing.definition && existing.label === builtIn.label) {
          return "missing";
        }
        const previous = resolveNodeTypeDef(id, current.nodeTypes);
        snapshot();
        setDoc((d) => ({
          ...d,
          nodeTypes: d.nodeTypes.map((type) =>
            type.id === id
              ? { id: builtIn.id, label: builtIn.label }
              : type,
          ),
          nodes: applyNodeTypeMetadata(d.nodes, id, previous, builtIn),
        }));
        return "reset";
      }

      if (current.nodes.some((node) => node.type === id)) return "in-use";
      snapshot();
      setDoc((d) => ({
        ...d,
        nodeTypes: d.nodeTypes.filter((type) => type.id !== id),
      }));
      setFilterState((currentFilter) =>
        currentFilter.nodeType === id
          ? { ...currentFilter, nodeType: "" }
          : currentFilter,
      );
      return "deleted";
    },
    [snapshot],
  );

  const importNodeTypeCatalog = useCallback(
    (data: unknown): number => {
      const dependencyValue = data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>).authenticationDefinitions : undefined;
      const dependencies = dependencyValue === undefined ? [] : validatePortableAuthenticationDefinitions(dependencyValue);
      const currentDoc = docRef.current;
      const catalogValue = data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>).catalogDefinitions : undefined;
      const catalogDependencies = catalogValue === undefined ? [] : validateCatalogDefinitions(catalogValue);
      const mergedCatalogDefinitions = mergeCatalogDefinitions(
        captureCatalogDefinitions(currentDoc).catalogDefinitions ?? [], catalogDependencies,
      );
      for (const def of dependencies) {
        const previous = currentDoc.authenticationDefinitions?.find(entry => entry.id === def.id);
        if (previous && !sameAuthenticationDefinition(previous, def)) {
          throw new Error(`Node catalog dependency "${def.id}" conflicts with the current diagram. Resolve it in Customize authentication before importing.`);
        }
      }
      const raw =
        Array.isArray(data)
          ? data
          : data &&
              typeof data === "object" &&
              Array.isArray((data as Record<string, unknown>).nodeTypes)
            ? ((data as Record<string, unknown>).nodeTypes as unknown[])
            : [];
      const imported: NodeTypeRef[] = [];
      const seen = new Set<string>();
      const usedLabels = new Map(
        docRef.current.nodeTypes.map((entry) => [
          entry.label.trim().toLowerCase(),
          entry.id,
        ]),
      );
      const canonicalIds = new Map(
        docRef.current.nodeTypes.map((entry) => [
          entry.id.toLowerCase(),
          entry.id,
        ]),
      );
      for (const value of raw) {
        if (!value || typeof value !== "object") continue;
        const entry = value as Record<string, unknown>;
        if (entry.definition && typeof entry.definition === "object") {
          const authRules = (entry.definition as Record<string, unknown>).allowedAuthMethods;
          if (authRules !== undefined) {
            if (!Array.isArray(authRules)) throw new Error("Node catalog authentication policy must be an array.");
            for (const rule of authRules as unknown[]) {
              if (!rule || typeof rule !== "object") throw new Error("Invalid node catalog authentication rule.");
              const auth = rule as Record<string, unknown>;
              if ((auth.id !== "*" && !isAuthenticationType(auth.id))
                  || (auth.status !== "Allowed" && auth.status !== "Deprecated")) {
                throw new Error("Node catalog has an invalid authentication ID or status. No rules were removed; correct the file and retry.");
              }
            }
          }
        }
        const rawId = typeof entry.id === "string" ? entry.id.trim() : "";
        const id = canonicalIds.get(rawId.toLowerCase()) ?? rawId;
        const label =
          typeof entry.label === "string" ? entry.label.trim() : "";
        const definition = normalizeNodeTypeDefinition(entry.definition);
        if (!id || !label || !definition || seen.has(id.toLowerCase())) {
          continue;
        }
        const labelOwner = usedLabels.get(label.toLowerCase());
        if (labelOwner && labelOwner !== id) continue;
        seen.add(id.toLowerCase());
        usedLabels.set(label.toLowerCase(), id);
        imported.push({ id, label, definition });
      }
      if (imported.length === 0) return 0;
      for (const type of imported) for (const rule of type.definition?.allowedAuthMethods ?? []) {
        if (rule.id !== "*" && !installedAuthentication(rule.id, libraries.authentication)
            && !dependencies.some(def => def.id === rule.id)
            && !currentDoc.authenticationDefinitions?.some(def => def.id === rule.id)) {
          throw new Error(`Node catalog is missing authentication dependency "${rule.id}". Include authenticationDefinitions in the package; no changes were applied.`);
        }
      }

      snapshot();
      setDoc((d) => {
        const replacements = new Map(imported.map((entry) => [entry.id, entry]));
        const previousDefinitions = new Map(
          imported.map((entry) => [
            entry.id,
            resolveNodeTypeDef(entry.id, d.nodeTypes),
          ]),
        );
        const next = d.nodeTypes.map(
          (entry) => replacements.get(entry.id) ?? entry,
        );
        const existingIds = new Set(d.nodeTypes.map((entry) => entry.id));
        for (const entry of imported) {
          if (!existingIds.has(entry.id)) next.push(entry);
        }
        let nodes = d.nodes;
        for (const entry of imported) {
          nodes = applyNodeTypeMetadata(
            nodes,
            entry.id,
            previousDefinitions.get(entry.id),
            entry.definition!,
          );
        }
        return {
          ...d, nodeTypes: next, nodes,
          authenticationDefinitions: mergeAuthenticationLibrary(d.authenticationDefinitions ?? [], dependencies),
          ...(mergedCatalogDefinitions.length ? { catalogDefinitions: mergedCatalogDefinitions } : {}),
        };
      });
      return imported.length;
    },
    [snapshot],
  );

  const exportNodeTypeCatalog = useCallback(() => {
    const current = docRef.current;
    const exportedTypes = current.nodeTypes.filter(type => type.definition != null);
    const references = authenticationReferences({ edges: [], nodeTypes: exportedTypes });
    const catalog = authenticationCatalogFor(current, libraryRef.current, libraries.authentication);
    const definitions = [...references].map(id => {
      const saved = current.authenticationDefinitions?.find(entry => entry.id === id);
      if (saved) return saved;
      const def = catalog.find(entry => entry.id === id);
      if (!def || def.unresolved || def.unavailableReason) throw new Error(`Cannot export node catalog: authentication dependency "${id}" is unresolved. Load its library or retain a saved definition before exporting.`);
      return def;
    });
    const payload = {
      format: SECURE_DESIGN_STUDIO_NODE_CATALOG_FORMAT,
      version: 1 as const,
      nodeTypes: exportedTypes,
      authenticationDefinitions: definitions,
      catalogDefinitions: referencedCatalogDefinitions({
        ...current, nodes: [], edges: [], data: [], boundaries: [], deviations: [],
        nodeTypes: exportedTypes,
      }, [...classificationDefinitionsRef.current, ...libraries.taxonomy]),
    };
    return JSON.stringify(payload, null, 2);
  }, []);

  const applyClassificationLibrary = useCallback((
    next: ClassificationLibrary, expected: ClassificationLibrary, repairRaw?: string,
  ) => {
    const before = classificationLibraryRef.current;
    if (exportClassificationCatalog(before) !== exportClassificationCatalog(expected)) {
      throw new Error("The Classification Library changed. Review the current list before applying this operation.");
    }
    const validated = validateClassificationLibrary(next);
    const beforeDefinitions = classificationDefinitionsForLibrary(before);
    const state = documentHistoryRef.current;
    const preservedDoc = captureCatalogDefinitions(state.doc, beforeDefinitions);
    const nextDoc = captureCatalogDefinitions(preservedDoc, classificationDefinitionsForLibrary(validated));
    const preservedPast = state.past.map(entry => ({
      ...entry,
      doc: captureCatalogDefinitions(entry.doc, entry.classificationLibrary
        ? classificationDefinitionsForLibrary(entry.classificationLibrary) : beforeDefinitions),
    }));
    // Prepare the complete transaction before writing the one profile key.
    if (repairRaw !== undefined) {
      if (repairRaw !== classificationRecoveryRaw) throw new Error("The recovery preview changed. Reload and review the stored configuration.");
      repairClassificationLibrary(validated, repairRaw);
    } else {
      persistClassificationLibrary(validated, before, undefined, libraries.classifications);
    }
    snapshot("classification", { doc: preservedDoc, past: preservedPast });
    setDoc(nextDoc);
    setClassificationLibrary(validated);
    setClassificationLibrarySource("profile");
    setClassificationStorageError(null);
    setClassificationRecoveryRaw(null);
  }, [snapshot, classificationRecoveryRaw]);

  const applyProtocolLibrary = useCallback((
    next: readonly ProtocolTypeDef[], expected: readonly ProtocolTypeDef[],
  ) => {
    const before = protocolLibraryRef.current;
    if (JSON.stringify(validateProtocolDefinitions(before)) !== JSON.stringify(validateProtocolDefinitions(expected))) {
      throw new Error("The Communication Library changed. Review the current definitions before applying this operation.");
    }
    const validated = validateProtocolDefinitions(next);
    persistProtocolLibrary(validated, protocolStorageError ? undefined : before);
    setProtocolLibrary(validated);
    setProtocolStorageError(null);
  }, [protocolStorageError, setProtocolLibrary]);

  const useLibraryProtocolDefinition = useCallback((id: string) => {
    const current = docRef.current;
    if (!current.edges.some(edge => edge.protocolId === id)) {
      throw new Error("This communication profile is not referenced by the current diagram.");
    }
    const definition = protocolLibraryRef.current.find(profile => profile.id === id);
    if (!definition) throw new Error("The active Communication Library has no definition for this ID.");
    const definitions = validateProtocolDefinitions([
      ...(current.protocolDefinitions ?? []).filter(profile => profile.id !== id),
      definition,
    ]);
    snapshot();
    setDoc({ ...current, protocolDefinitions: definitions });
  }, [snapshot]);

  const classificationDeleteReason = useCallback((id: string): string | null => {
    const current = classificationLibraryRef.current;
    if (!current.classifications.some(item => item.id === id)) return "Classification is no longer in the active library.";
    if (current.defaultId === id) return "Choose another enabled default before deleting this classification.";
    const documents = [docRef.current, ...pastRef.current.map(entry => entry.doc), ...futureRef.current.map(entry => entry.doc)];
    if (documents.some(document => classificationReferencesInDocument(document).has(id))) {
      return "This ID is used by data, a node policy, or Undo/Redo history. Disable it instead. Other saved files are not inspected.";
    }
    return null;
  }, [doc, past, future, classificationLibrary]);

  const deleteClassification = useCallback((id: string, expected: ClassificationLibrary) => {
    const reason = classificationDeleteReason(id);
    if (reason) throw new Error(reason);
    applyClassificationLibrary({
      ...classificationLibraryRef.current,
      classifications: classificationLibraryRef.current.classifications.filter(item => item.id !== id),
    }, expected);
  }, [classificationDeleteReason, applyClassificationLibrary]);

  const useLibraryClassificationDefinition = useCallback((id: string, expected: ClassificationLibrary) => {
    const library = classificationLibraryRef.current;
    if (exportClassificationCatalog(library) !== exportClassificationCatalog(expected)) {
      throw new Error("The library changed. Review the active definition again.");
    }
    const current = docRef.current;
    if (!classificationReferencesInDocument(current).has(id)) throw new Error("This classification is not referenced by the current diagram.");
    const definition = classificationDefinitionsForLibrary(library).find(item => item.id === id);
    if (!definition) throw new Error("The active library has no definition for this ID.");
    const definitions = validateCatalogDefinitions([
      ...(current.catalogDefinitions ?? []).filter(item => item.kind !== "classification" || item.id !== id),
      definition,
    ]);
    snapshot();
    setDoc({ ...current, catalogDefinitions: definitions });
  }, [snapshot]);

  const commitAuthenticationLibrary = useCallback((methods: AuthTypeDef[]) => {
    const validated = validateAuthenticationDefinitions(methods, libraries.authentication);
    if (libraryInitial.error) throw new Error(libraryInitial.error);
    // Persist first: a storage failure must not create a success-shaped edit.
    const before = libraryRef.current;
    persistAuthenticationLibrary(validated, before, libraries.authentication);
    snapshot(true);
    setDoc(current => ({
      ...current,
      authenticationDefinitions: (withAuthenticationDefinitions(current, authenticationCatalogFor(current, before, libraries.authentication)).authenticationDefinitions ?? []).map(saved => {
        const previous = before.find(def => def.id === saved.id);
        const next = validated.find(def => def.id === saved.id);
        return previous && next && sameAuthenticationDefinition(previous, saved) ? next : saved;
      }),
    }));
    setAuthenticationLibrary(validated);
    setAuthenticationStorageError(null);
  }, [snapshot, libraryInitial.error]);

  const saveAuthenticationMethod = useCallback((method: { id: string; label: string; description: string; aiDesignGuidance?: AiDesignGuidance }) => {
    if (!isAuthenticationType(method.id)) throw new Error("Invalid authentication ID.");
    const existing = libraryRef.current.find(def => def.id === method.id);
    if (!existing && isPackageAuthenticationId(method.id) && !installedAuthentication(method.id, libraries.authentication)) {
      throw new Error("Install the required authentication library before adding this protected method.");
    }
    const next: AuthTypeDef = {
      ...(existing ?? {
        id: method.id, behavior: { ...UNKNOWN_AUTH_BEHAVIOR },
        disabled: false, legacy: false, aliases: [],
      }),
      label: method.label, description: method.description,
      shortLabel: existing?.label === method.label.trim() ? existing.shortLabel : method.label.trim().slice(0, 20),
    };
    if (Object.prototype.hasOwnProperty.call(method, "aiDesignGuidance")) {
      const guidance = validateAiDesignGuidance(method.aiDesignGuidance);
      if (guidance) next.aiDesignGuidance = guidance;
      else delete next.aiDesignGuidance;
    }
    if (existing && sameAuthenticationDefinition(existing, next)) return;
    commitAuthenticationLibrary(mergeAuthenticationLibrary(libraryRef.current, [next], libraries.authentication));
  }, [commitAuthenticationLibrary]);

  const saveAuthenticationGuidance = useCallback((
    id: string, guidance: AiDesignGuidance | undefined, expectedDefinition?: AuthTypeDef,
  ) => {
    const current = docRef.current;
    const catalog = authenticationCatalogFor(current, libraryRef.current, libraries.authentication);
    const definition = catalog.find(method => method.id === id);
    if (expectedDefinition && (!definition || !sameAuthenticationDefinition(definition, expectedDefinition))) {
      throw new Error("This authentication method changed while you were editing. Cancel and reopen the editor; no changes were applied.");
    }
    const next = withAuthenticationGuidance(current, catalog, id, guidance);
    if (next === current) return;
    snapshot();
    setDoc(next);
  }, [snapshot, libraries]);

  const setAuthenticationMethodDisabled = useCallback((id: string, disabled: boolean) => {
    if (!libraryRef.current.some(def => def.id === id)) throw new Error("Authentication method is not in your library.");
    const method = libraryRef.current.find(def => def.id === id)!;
    const unavailable = authenticationUnavailableReason(method, libraries.authentication);
    if (!disabled && unavailable) throw new Error(unavailable);
    commitAuthenticationLibrary(libraryRef.current.map(def => def.id === id ? { ...def, disabled } : def));
  }, [commitAuthenticationLibrary]);

  const deleteAuthenticationMethod = useCallback((id: string) => {
    if (builtInAuthentication(id) || isPackageAuthenticationId(id)) throw new Error("Protected methods cannot be deleted. Disable the method or reset its presentation.");
    if (libraries.authentication.some(method => method.id === id)) {
      throw new Error("Configured library methods cannot be deleted from the deployment. Disable the method in this profile instead.");
    }
    if (!isAuthenticationType(id) || !libraryRef.current.some(def => def.id === id)) throw new Error("Authentication method not found.");
    const documents = [docRef.current, ...pastRef.current.map(entry => entry.doc), ...futureRef.current.map(entry => entry.doc)];
    if (documents.some(current => authenticationReferences(current).has(id))) {
      throw new Error("This method is in use by a flow, node policy or undo/redo history. Disable it instead; saved files are never rewritten.");
    }
    commitAuthenticationLibrary(libraryRef.current.filter(def => def.id !== id));
  }, [commitAuthenticationLibrary]);

  const resetAuthenticationMethod = useCallback((id: string) => {
    const builtIn = installedAuthentication(id, libraries.authentication);
    if (!builtIn) throw new Error("Only installed presentation can be reset.");
    const current = libraryRef.current.find(def => def.id === id);
    const next = { ...builtIn, disabled: current?.disabled ?? false };
    commitAuthenticationLibrary(mergeAuthenticationLibrary(libraryRef.current, [next], libraries.authentication));
  }, [commitAuthenticationLibrary]);

  const importAuthenticationCatalog = useCallback((data: unknown) => {
    const imported = parseAuthenticationCatalog(data, libraries.authentication);
    assertInstalledAuthenticationContracts(imported, libraries.authentication);
    commitAuthenticationLibrary(mergeAuthenticationLibrary(libraryRef.current, imported, libraries.authentication));
  }, [commitAuthenticationLibrary]);

  const useLibraryAuthenticationDefinition = useCallback((id: string) => {
    const def = libraryRef.current.find(entry => entry.id === id);
    if (!def) throw new Error("Import this method into your Authentication Library first.");
    const unavailable = authenticationUnavailableReason(def, libraries.authentication);
    if (unavailable) throw new Error(unavailable);
    snapshot();
    setDoc(current => ({
      ...current,
      authenticationDefinitions: [
        ...(current.authenticationDefinitions ?? []).filter(entry => entry.id !== id), def,
      ],
    }));
  }, [snapshot]);

  // -------- JSON I/O --------
  // Exported file format:
  //   { "format": "secure-design-studio-diagram", "version": 2,
  //     "doc": PsDocument,
  //     "view": { activeScenarioId, filter } }
  // Import also accepts legacy "privsec-diagram" wrappers and bare documents.
  const importJson = useCallback(
    (data: unknown) => {
      if (data == null || typeof data !== "object") return;
      const obj = data as Record<string, unknown>;
      let docPart: unknown;
      let viewPart: Record<string, unknown> | null = null;
      if ("doc" in obj && obj.doc && typeof obj.doc === "object") {
        docPart = obj.doc;
        if ("view" in obj && obj.view && typeof obj.view === "object") {
          viewPart = obj.view as Record<string, unknown>;
        }
      } else {
        docPart = obj;
      }
      const normalized = normalizeDoc(docPart as Partial<PsDocument>, libraryNodes);
      const newDoc = captureCatalogDefinitions({
        ...normalized, catalogDefinitions: normalized.catalogDefinitions ?? [],
      }, classificationDefinitionsRef.current);
      snapshot();
      setDoc(newDoc);
      setDocumentSessionId(current => current + 1);
      setAssistantFindings([]);
      setAssistantAnalysis(null);
      setAcceptedFindingIds(new Set());
      setDocumentRecoveryError(null);

      let nextActive: string | null = null;
      let nextFilter: FilterState = { ...emptyFilter };
      if (viewPart) {
        const asid = viewPart.activeScenarioId;
        if (
          typeof asid === "string" &&
          newDoc.scenarios.some((s) => s.id === asid)
        ) {
          nextActive = asid;
        }
        nextFilter = normalizeFilterState(newDoc, viewPart.filter);
      }
      setActiveScenarioId(nextActive);
      setFilterState(nextFilter);
      setSelection(null);
    },
    [snapshot]
  );

  const exportJson = useCallback(() => {
    const payload = {
      format: SECURE_DESIGN_STUDIO_DOCUMENT_FORMAT,
      version: 2 as const,
      doc: captureCatalogDefinitions(withAuthenticationDefinitions(doc, authenticationCatalog), classificationDefinitions),
      view: {
        activeScenarioId,
        filter,
      },
    };
    return JSON.stringify(payload, null, 2);
  }, [doc, authenticationCatalog, activeScenarioId, filter, classificationDefinitions, captureCatalogDefinitions]);

  // Merge a parsed Privacy Manager data inventory. One snapshot covers
  // the whole operation so undo restores the pre-import doc. The action
  // computes a new doc against `docRef.current` and applies it in a
  // single setDoc — no calls to other store actions (which would emit
  // their own snapshots and split this into many undo steps).
  const importPrivacyManagerData = useCallback(
    (
      parsed: ImportPrivacyManagerInput,
      decisions: Record<string, ServiceImportDecision>,
    ): ImportPrivacyManagerSummary => {
      snapshot();

      const current = docRef.current;
      const summary: ImportPrivacyManagerSummary = {
        servicesMapped: 0,
        servicesCreated: 0,
        servicesIgnored: 0,
        dataItemsCreated: 0,
        dataItemsReused: 0,
        attachmentsAdded: 0,
        attachmentsSkipped: 0,
      };

      // Resolve serviceId -> target nodeId. Decisions from the caller
      // already cover both auto-matched and user-resolved services; the
      // dialog/toolbar is responsible for folding auto-matches in.
      const newNodes: PsNode[] = [];
      const serviceToNode = new Map<string, string>();

      for (const group of parsed.groups) {
        const dec = decisions[group.key];
        if (!dec || dec.kind === "ignore") {
          summary.servicesIgnored++;
          continue;
        }
        if (dec.kind === "use-existing") {
          if (!current.nodes.some((n) => n.id === dec.nodeId)) {
            // The node was deleted between dialog open and confirm; skip.
            summary.servicesIgnored++;
            continue;
          }
          serviceToNode.set(group.key, dec.nodeId);
          summary.servicesMapped++;
          continue;
        }
        // create-new
        const newId = uid("n");
        newNodes.push({
          id: newId,
          dfdRoleLegacy: false,
          title: group.serviceName,
          description: group.serviceId
            ? `Imported from Privacy Manager (serviceId ${group.serviceId})`
            : "Imported from Privacy Manager",
          type: "",
          serviceTreeId: group.serviceId,
          endpointRegex: "",
          position: { x: 0, y: 0 },
        });
        serviceToNode.set(group.key, newId);
        summary.servicesCreated++;
      }

      // Position newly created nodes in a grid below the densest existing
      // area — same heuristic as Import-nodes-from-Endpoints.
      if (newNodes.length > 0) {
        const baseY =
          current.nodes.length > 0
            ? Math.max(...current.nodes.map((n) => n.position.y)) + 200
            : 200;
        const COLS = 4;
        const DX = 200;
        const DY = 150;
        const baseX = 200;
        newNodes.forEach((n, i) => {
          n.position = {
            x: baseX + (i % COLS) * DX,
            y: baseY + Math.floor(i / COLS) * DY,
          };
        });
      }

      // Build / extend the global data pool. Dedup key: trimmed name +
      // classification (matches the pmexp parser's own dedup so the
      // counts add up).
      const existingDataByKey = new Map<string, PsData>();
      for (const di of current.data) {
        existingDataByKey.set(`${di.name.trim()}|${di.classification}`, di);
      }
      const newDataItems: PsData[] = [];
      // Per service: ordered list of (dataId, retention) we plan to bind
      // to the mapped node in every scenario.
      const bindingsByService = new Map<
        string,
        Array<{ dataId: string; retention: Retention }>
      >();

      for (const group of parsed.groups) {
        const nodeId = serviceToNode.get(group.key);
        if (!nodeId) continue;
        const list: Array<{ dataId: string; retention: Retention }> = [];
        for (const item of group.items) {
          const key = `${item.name}|${item.classification}`;
          let existing = existingDataByKey.get(key);
          if (existing) {
            summary.dataItemsReused++;
            // Fill in a missing sample but never overwrite a non-blank
            // user-curated sample.
            if (!existing.sample && item.sample) {
              existing = { ...existing, sample: item.sample };
              existingDataByKey.set(key, existing);
            }
          } else {
            existing = {
              id: uid("d"),
              name: item.name,
              classification: item.classification,
              sample: item.sample,
            };
            existingDataByKey.set(key, existing);
            newDataItems.push(existing);
            summary.dataItemsCreated++;
          }
          list.push({ dataId: existing.id, retention: item.retention });
        }
        bindingsByService.set(group.key, list);
      }

      // Reconstruct doc.data so updated samples on reused items are
      // reflected. Order: existing items first (in original order, with
      // updated samples), then newly created items at the end.
      const updatedData: PsData[] = current.data.map((di) => {
        const key = `${di.name.trim()}|${di.classification}`;
        return existingDataByKey.get(key) ?? di;
      });
      for (const ni of newDataItems) updatedData.push(ni);

      // Scenarios: add mapped node to nodeIds if missing; bind data with
      // retention, preserving any pre-existing retention choice.
      const updatedScenarios = current.scenarios.map((s) => {
        let changed = false;
        const nodeIds = [...s.nodeIds];
        const nodeData: Record<string, Record<string, Retention>> = {
          ...s.nodeData,
        };
        for (const [serviceKey, nodeId] of serviceToNode) {
          if (!nodeIds.includes(nodeId)) {
            nodeIds.push(nodeId);
            changed = true;
          }
          const bindings = bindingsByService.get(serviceKey) ?? [];
          if (bindings.length === 0) continue;
          const map: Record<string, Retention> = { ...(nodeData[nodeId] ?? {}) };
          let mapChanged = false;
          for (const { dataId, retention } of bindings) {
            if (dataId in map) {
              summary.attachmentsSkipped++;
              continue;
            }
            map[dataId] = retention;
            summary.attachmentsAdded++;
            mapChanged = true;
          }
          if (mapChanged) {
            nodeData[nodeId] = map;
            changed = true;
          }
        }
        return changed ? { ...s, nodeIds, nodeData } : s;
      });

      const nextDoc: PsDocument = {
        ...current,
        nodes: [...current.nodes, ...newNodes],
        data: updatedData,
        scenarios: updatedScenarios,
      };
      setDoc(nextDoc);

      return summary;
    },
    [snapshot],
  );

  // -------- Derived --------
  const activeScenario = useMemo(
    () => doc.scenarios.find((s) => s.id === activeScenarioId) ?? null,
    [doc.scenarios, activeScenarioId]
  );

  const visibleNodes = useMemo<PsNode[]>(() => {
    let nodes = doc.nodes;
    if (activeScenario) {
      const allow = new Set(activeScenario.nodeIds);
      nodes = nodes.filter((n) => allow.has(n.id));
    }
    if (filter.text) {
      const q = filter.text.toLowerCase();
      const matchesNode = (n: PsNode) =>
        n.title.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        (doc.nodeTypes.find((type) => type.id === n.type)?.label ?? "")
          .toLowerCase()
          .includes(q);
      // In-scope edges to consult for "node is an endpoint of a text-matching
      // edge" — so an edge title match keeps its endpoint nodes visible.
      let scopedEdges = doc.edges;
      if (activeScenario) {
        const allowE = new Set(activeScenario.edgeIds);
        scopedEdges = scopedEdges.filter((e) => allowE.has(e.id));
      }
      const matchingEdgeEndpoints = new Set<string>();
      for (const e of scopedEdges) {
        if (
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q)
        ) {
          matchingEdgeEndpoints.add(e.source);
          matchingEdgeEndpoints.add(e.target);
        }
      }
      nodes = nodes.filter(
        (n) =>
          matchesNode(n) ||
          matchingEdgeEndpoints.has(n.id)
      );
    }
    if (filter.nodeType) {
      nodes = nodes.filter((n) => n.type === filter.nodeType);
    }
    return nodes;
  }, [doc.nodes, doc.edges, doc.nodeTypes, activeScenario, filter]);

  const visibleEdges = useMemo<PsEdge[]>(() => {
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    let edges = doc.edges.filter(
      (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
    );
    if (activeScenario) {
      const allow = new Set(activeScenario.edgeIds);
      edges = edges.filter((e) => allow.has(e.id));
    }
    if (filter.text) {
      const q = filter.text.toLowerCase();
      // Match on the edge's own text OR on both endpoint nodes' text — so
      // edges between two text-matching nodes still show even if the edge
      // itself doesn't carry the text.
      const matchesNode = (n: PsNode) =>
        n.title.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        (doc.nodeTypes.find((type) => type.id === n.type)?.label ?? "")
          .toLowerCase()
          .includes(q);
      const matchingNodeIds = new Set(
        doc.nodes.filter(matchesNode).map((n) => n.id)
      );
      edges = edges.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          (matchingNodeIds.has(e.source) && matchingNodeIds.has(e.target))
      );
    }
    if (filter.authType) {
      edges = edges.filter((e) =>
        (e.authenticationTypes ?? []).includes(filter.authType as AuthenticationType)
      );
    }
    if (filter.dataClassification) {
      const dataById = new Map(doc.data.map((d) => [d.id, d]));
      const wanted = filter.dataClassification;
      const idsHaveClassification = (ids: string[] | undefined) =>
        !!ids?.some((id) => dataById.get(id)?.classification === wanted);
      const scenarioMatch = (s: Scenario, eid: string) =>
        idsHaveClassification(s.edgeRequestData[eid]) ||
        idsHaveClassification(s.edgeResponseData[eid]);
      if (activeScenario) {
        edges = edges.filter((e) => scenarioMatch(activeScenario, e.id));
      } else {
        edges = edges.filter((e) =>
          doc.scenarios.some((s) => scenarioMatch(s, e.id))
        );
      }
    }
    return edges;
  }, [doc.edges, doc.data, doc.nodes, doc.nodeTypes, doc.scenarios, visibleNodes, activeScenario, filter]);

  const visibleBoundaries = useMemo<PsBoundary[]>(() => {
    if (!activeScenario) return doc.boundaries;
    const allow = new Set(activeScenario.boundaryIds);
    return doc.boundaries.filter((b) => allow.has(b.id));
  }, [doc.boundaries, activeScenario]);

  const visibleTextAnnotations = useMemo(() => (doc.textAnnotations ?? []).filter(annotation =>
    !activeScenario || activeScenario.textAnnotationIds?.includes(annotation.id)), [doc.textAnnotations, activeScenario]);

  const edgeNumberFor = useCallback(
    (edgeId: string): number | null => {
      if (!activeScenario) return null;
      return activeScenario.edgeNumbers[edgeId] ?? null;
    },
    [activeScenario]
  );

  const api: StoreApi = {
    documentSessionId,
    prepareThreatModelDesign,
    prepareThreatModelDesignPlan,
    applyThreatModelDesign,
    availableCatalogDefinitions,
    nodeTypeCatalog,
    authenticationLibrary,
    protocolLibrary,
    protocolStorageError,
    applyProtocolLibrary,
    useLibraryProtocolDefinition,
    authenticationCatalog,
    authenticationWarnings: authWarnings,
    authenticationCompatibility,
    authenticationStorageError,
    catalogSnapshotError,
    documentRecoveryError,
    classificationLibrary,
    classificationDefinitions,
    classificationLibrarySource,
    classificationStorageError,
    classificationRecoveryRaw,
    applyClassificationLibrary,
    classificationDeleteReason,
    deleteClassification,
    useLibraryClassificationDefinition,
    saveAuthenticationMethod,
    saveAuthenticationGuidance,
    setAuthenticationMethodDisabled,
    deleteAuthenticationMethod,
    resetAuthenticationMethod,
    importAuthenticationCatalog,
    useLibraryAuthenticationDefinition,
    doc,
    activeScenarioId,
    setActiveScenarioId,
    selection,
    setSelection,
    multiSelectedIds,
    toggleAdditionalSelection,
    clearMultiSelection,
    filter,
    setFilter,
    clearFilter,
    editingEdgeTitleId,
    setEditingEdgeTitleId,
    editingEdgeTitleValue,
    setEditingEdgeTitleValue,
    assistantFindings,
    setAssistantFindings,
    assistantAnalysis,
    setAssistantAnalysis,
    acceptedFindingIds,
    setAcceptedFindingIds,
    allCommentsViewOpen,
    setAllCommentsViewOpen,
    allIssuesViewOpen,
    setAllIssuesViewOpen,
    diffViewOpen,
    setDiffViewOpen,
    diffChanges,
    diffFileName,
    diffSelectedTarget,
    setDiffSelectedTarget,
    loadDiff,
    clearDiff,
    focusTarget,
    setFocusTarget,
    viewMode,
    setViewMode,
    createNode,
    updateNode,
    setNodeScopeReason,
    deleteNode,
    moveNode,
    finishNodeMove,
    setNodeSize,
    moveDiagramItems,
    createEdge,
    updateEdge,
    deleteEdge,
    addEdgeWaypoint,
    updateEdgeWaypoint,
    removeEdgeWaypoint,
    createData,
    updateData,
    deleteData,
    createWorkItem,
    getCurrentWorkItem,
    updateWorkItem,
    deleteWorkItem,
    attachDataToNode,
    detachDataFromNode,
    setNodeDataRetention,
    attachDataToEdge,
    detachDataFromEdge,
    propagateEdgeDataToNodes,
    addComment,
    updateCommentText,
    setCommentStatus,
    deleteComment,
    addCommentReply,
    updateCommentReply,
    deleteCommentReply,
    addIssue,
    updateIssue,
    setIssueStatus,
    deleteIssue,
    addIssueReply,
    updateIssueReply,
    deleteIssueReply,
    addDeviation,
    upsertDeviation,
    updateDeviation,
    setDeviationStatus,
    deleteDeviation,
    analyze,
    createBoundary,
    updateBoundary,
    deleteBoundary,
    moveBoundary,
    finishBoundaryMove,
    resizeBoundary,
    finishBoundaryResize,
    removeNodeFromBoundary,
    createScenario,
    cloneScenario,
    renameScenario,
    updateScenario,
    deleteScenario,
    addNodeToScenario,
    removeNodeFromScenario,
    addEdgeToScenario,
    removeEdgeFromScenario,
    addBoundaryToScenario,
    removeBoundaryFromScenario,
    moveEdgeInScenario,
    setEdgeNumberInScenario,
    renumberScenario,
    addNodeType,
    saveNodeType,
    saveNodeTypeGuidance,
    removeNodeType,
    importNodeTypeCatalog,
    exportNodeTypeCatalog,
    importJson,
    exportJson,
    newDocument,
    importPrivacyManagerData,
    snapshot,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    collab: collabState,
    joinRoom,
    leaveRoom,
    activeScenario,
    visibleNodes,
    visibleEdges,
    visibleBoundaries,
    visibleTextAnnotations,
    createTextAnnotation,
    updateTextAnnotation,
    deleteTextAnnotation,
    setTextAnnotationMembership,
    edgeNumberFor,
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// Accepts both current docs (with `data` + edge `dataIds`) and legacy docs
// that still have edge `dataClassifications`. Legacy classifications are
// promoted to PsData items (one per unique classification) which edges then
// reference by id.
function normalizeAuthTypes(
  e: Partial<PsEdge> & { authenticationType?: unknown; authenticationTypes?: unknown },
  definitions: readonly AuthTypeDef[],
): AuthenticationType[] | undefined {
  const coerce = (v: unknown) => normalizeAuthenticationValue(v, definitions);
  const collected = new Set<AuthenticationType>();
  if (Array.isArray(e.authenticationTypes)) {
    for (const v of e.authenticationTypes) {
      const id = coerce(v);
      if (id) collected.add(id);
    }
  } else if (e.authenticationType !== undefined) {
    // Legacy singular field -> wrap in array.
    const id = coerce(e.authenticationType);
    if (id) collected.add(id);
  }
  return collected.size > 0 ? Array.from(collected) : undefined;
}

// Validates and coerces a raw productionIdentity value off an edge. Tolerant
// of legacy/malformed input:
//   - Returns undefined for non-object inputs.
//   - Accepts the explicit shape { kind: "AppId" | "ManagedIdentity", ... }.
//   - Recovery heuristic for missing `kind`: if a string `appId` is present
//     treat as AppId; otherwise if anything looks like a Managed Identity
//     (legacy `name` field or just kind:"ManagedIdentity") treat as the
//     bare ManagedIdentity tag. Otherwise drop.
//   - Managed Identity is now a bare tag — any legacy `name` field is
//     dropped during normalization.
//   - Preserves the raw appId string (whitespace and casing) so the UI
//     surfaces validation rather than silently dropping user input.
//   - Preserves unavailable tenant IDs; malformed/missing values use "Other".
function normalizeEdgeProductionIdentity(
  raw: unknown
): ProductionIdentity | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as {
    kind?: unknown;
    appId?: unknown;
    tenant?: unknown;
    name?: unknown;
  };
  let kind: "AppId" | "ManagedIdentity" | undefined;
  if (r.kind === "AppId" || r.kind === "ManagedIdentity") {
    kind = r.kind;
  } else if (typeof r.appId === "string") {
    kind = "AppId";
  } else if (typeof r.name === "string") {
    kind = "ManagedIdentity";
  }
  if (!kind) return undefined;
  if (kind === "AppId") {
    const appId = typeof r.appId === "string" ? r.appId : "";
    const tenant: ProductionIdentityTenant =
      isCatalogReferenceId(r.tenant)
        ? r.tenant
        : "Other";
    return { kind: "AppId", appId, tenant };
  }
  return { kind: "ManagedIdentity" };
}

// Validates and coerces a raw geoBoundary value off a node. Returns undefined
// to signal "no override" (which is also what we want for invalid input).
// Rules:
//   - id must exist in the GEO_BOUNDARY_SETTING_DEF_MAP catalog
//   - id must NOT have `instanceMustSpecify` (those are the "deferred"
//     variants that the TYPE uses to signal a per-instance fill-in is
//     required — using them as the override itself would be circular)
//   - DataKeptInGeoUnlessCustomerAllowsXGeo requires a non-empty trimmed
//     description; otherwise the override is dropped
function normalizeNodeGeoBoundary(
  raw: unknown
): GeoBoundarySetting | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { id?: unknown; description?: unknown };
  if (typeof r.id !== "string") return undefined;
  const def = GEO_BOUNDARY_SETTING_DEF_MAP[r.id];
  if (!def) return undefined;
  if (def.instanceMustSpecify) return undefined;
  if (r.id === "DataKeptInGeoUnlessCustomerAllowsXGeo") {
    const desc = typeof r.description === "string" ? r.description.trim() : "";
    if (desc === "") return undefined;
    return { id: "DataKeptInGeoUnlessCustomerAllowsXGeo", description: desc };
  }
  if (r.id === "DataKeptInGeo") return { id: "DataKeptInGeo" };
  if (r.id === "DataNotKeptInGeo") return { id: "DataNotKeptInGeo" };
  return undefined;
}

// Same rules for postSubscriptionRetention. RetainedDaysRange requires
// minDays/maxDays as finite non-negative integers with minDays <= maxDays.
function normalizeNodePostSubscriptionRetention(
  raw: unknown
): PostSubscriptionRetention | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { id?: unknown; minDays?: unknown; maxDays?: unknown };
  if (typeof r.id !== "string") return undefined;
  const def = POST_SUBSCRIPTION_RETENTION_DEF_MAP[r.id];
  if (!def) return undefined;
  if (def.instanceMustSpecify) return undefined;
  if (r.id === "RetainedDaysRange") {
    const min = Number(r.minDays);
    const max = Number(r.maxDays);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
    if (min < 0 || max < 0) return undefined;
    if (!Number.isInteger(min) || !Number.isInteger(max)) return undefined;
    if (min > max) return undefined;
    return { id: "RetainedDaysRange", minDays: min, maxDays: max };
  }
  return undefined;
}

function normalizeDeviationSampleCalls(value: unknown): DeviationSampleCall[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const calls: DeviationSampleCall[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const call = candidate as Partial<DeviationSampleCall>;
    const source = typeof call.source === "string" ? call.source.trim() : "";
    const destination =
      typeof call.destination === "string" ? call.destination.trim() : "";
    const count =
      typeof call.count === "number" &&
      Number.isFinite(call.count) &&
      call.count >= 0
        ? call.count
        : null;
    if (!source || !destination || count === null) continue;
    const key = JSON.stringify([source, destination]);
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ source, destination, count });
  }
  return calls;
}

export function normalizeDoc(
  doc: Partial<PsDocument> & {
    edges?: Array<
      Partial<PsEdge> & {
        authenticationType?: unknown;
      }
    >;
    data?: Array<Partial<PsData>>;
    scenarios?: Array<
      Partial<Scenario> & {
        nodeData?: unknown;
        edgeRequestData?: unknown;
        edgeResponseData?: unknown;
      }
    >;
  },
  availableNodeTypes: readonly NodeTypeRef[] = [],
): PsDocument {
  validateThreatNotes(doc);
  const textAnnotations = normalizeTextAnnotations(doc);
  const base = emptyDocument();
  const authenticationDefinitions = doc.authenticationDefinitions === undefined
    ? [] : validatePortableAuthenticationDefinitions(doc.authenticationDefinitions);
  const protocolDefinitions = doc.protocolDefinitions === undefined
    ? [] : validateProtocolDefinitions(doc.protocolDefinitions);
  const catalogDefinitions = doc.catalogDefinitions === undefined
    ? undefined : validateCatalogDefinitions(doc.catalogDefinitions);
  const rawNodeTypes = doc.nodeTypes ?? base.nodeTypes;
  // Validate new authored fields even on entries legacy normalization would skip.
  validateNodeTypeGuidanceEntries(rawNodeTypes);
  const seenIds = new Set<string>();
  const nodeTypes: NodeTypeRef[] = [];
  for (const entry of rawNodeTypes as unknown[]) {
    // Legacy: string. Use it as both id and label so existing node.type
    // references keep resolving. Catalog-known ids get the def's label.
    if (typeof entry === "string") {
      const id = entry.trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const def = NODE_TYPE_DEF_MAP[id];
      const installed = availableNodeTypes.find(type => type.id === id);
      nodeTypes.push({
        id,
        label: installed?.label ?? def?.label ?? id,
        ...(installed?.definition ? { definition: normalizeNodeTypeDefinition(installed.definition) } : {}),
      });
      continue;
    }
    // Current shape: { id, label, definition? }
    if (entry && typeof entry === "object") {
      const e = entry as {
        id?: unknown;
        label?: unknown;
        definition?: unknown;
      };
      const id = typeof e.id === "string" ? e.id.trim() : "";
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const def = NODE_TYPE_DEF_MAP[id];
      const installed = availableNodeTypes.find(type => type.id === id);
      const definition =
        normalizeNodeTypeDefinition(e.definition) ??
        normalizeNodeTypeDefinition(installed?.definition);
      const label =
        def && !definition
          ? def.label
          : typeof e.label === "string" && e.label.trim()
          ? e.label.trim()
          : installed?.label ?? def?.label ?? id;
      nodeTypes.push({
        id,
        label,
        ...(definition ? { definition } : {}),
      });
    }
  }

  // Merge in any catalog entries the saved doc didn't know about. Without
  // this, autosaved/imported docs would silently miss newly-shipped node
  // types because doc.nodeTypes was frozen at the moment of save.
  for (const def of NODE_TYPE_DEFS) {
    if (seenIds.has(def.id)) continue;
    seenIds.add(def.id);
    nodeTypes.push({ id: def.id, label: def.label });
  }

  // Carry over existing data items first.
  const dataItems: PsData[] = (doc.data ?? []).map((d) => ({
    id: d.id ?? uid("d"),
    name: d.name ?? "Data",
    classification: (isCatalogReferenceId(d.classification)
      ? d.classification
      : "EUII"),
    sample: d.sample ?? "",
  }));

  // Recover legacy description/link values, but reject malformed review/receipt
  // fields before replacing the document. Never truncate authored work.
  const workItemsRaw = (doc as { workItems?: unknown }).workItems;
  const workItems: PsWorkItem[] = Array.isArray(workItemsRaw)
    ? workItemsRaw.map(normalizeWorkItem)
    : [];

  const rawEdges = doc.edges ?? [];

  // For legacy migration: list of all boundary ids in the document.
  const allBoundaryIds = (doc.boundaries ?? [])
    .map((b) => b.id)
    .filter((id): id is string => typeof id === "string");

  const normalizedScenarios = (doc.scenarios ?? []).map((s) => {
    const edgeIds = (s.edgeIds ?? []).filter(
      (id): id is string => typeof id === "string"
    );
    const fallbackNumbers: Record<string, number> = {};
    edgeIds.forEach((eid, i) => (fallbackNumbers[eid] = i + 1));

    // Normalize provided nodeData if present.
    const legacyRetentionMap: Record<string, Retention> = {
      "processing-only": "ProcessingNoStorage",
      "storage-lt-48h": "StorageUnder48Hours",
      "storage-gte-48h": "StorageOver48Hours",
    };
    const coerceRetention = (v: unknown): Retention => {
      if (typeof v !== "string") return "ProcessingNoStorage";
      if ((RETENTION_TYPES as readonly string[]).includes(v))
        return v as Retention;
      const migrated = legacyRetentionMap[v];
      if (migrated) return migrated;
      return "ProcessingNoStorage";
    };
    const rawNodeData =
      (s as { nodeData?: Record<string, Record<string, unknown>> }).nodeData ?? {};
    const nodeData: Record<string, Record<string, Retention>> = {};
    for (const [nodeId, m] of Object.entries(rawNodeData)) {
      const cleaned: Record<string, Retention> = {};
      for (const [did, ret] of Object.entries(m ?? {})) {
        cleaned[did] = coerceRetention(ret);
      }
      nodeData[nodeId] = cleaned;
    }

    const coerceEdgeBucket = (raw: unknown): Record<string, string[]> => {
      const out: Record<string, string[]> = {};
      if (!raw || typeof raw !== "object") return out;
      for (const [eid, ids] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(ids)) {
          out[eid] = ids.filter((id): id is string => typeof id === "string");
        }
      }
      return out;
    };
    const edgeRequestData = coerceEdgeBucket(
      (s as { edgeRequestData?: unknown }).edgeRequestData
    );
    const edgeResponseData = coerceEdgeBucket(
      (s as { edgeResponseData?: unknown }).edgeResponseData
    );

    // Boundary membership: read if present, otherwise the legacy file had
    // no per-scenario boundaries (they were global) — include every boundary
    // so the existing visual matches what the file's author saw.
    let boundaryIds: string[];
    if (Array.isArray((s as { boundaryIds?: unknown }).boundaryIds)) {
      boundaryIds = (s as { boundaryIds: unknown[] }).boundaryIds.filter(
        (id): id is string => typeof id === "string"
      );
    } else {
      boundaryIds = [...allBoundaryIds];
    }

    return {
      id: s.id ?? uid("s"),
      ...normalizeNodeScope(s, new Set((doc.nodes ?? []).map(node => node.id))),
      name: s.name ?? "Scenario",
      description: s.description ?? "",
      nodeIds: (s.nodeIds ?? []).filter(
        (id): id is string => typeof id === "string"
      ),
      edgeIds,
      edgeNumbers: { ...fallbackNumbers, ...(s.edgeNumbers ?? {}) },
      boundaryIds,
      ...normalizeTextAnnotationIds(s, textAnnotations ?? []),
      nodeData,
      edgeRequestData,
      edgeResponseData,
    };
  });

  let normalizedNodes: PsNode[] = (doc.nodes ?? []).map((n) => {
    const raw = n as Partial<PsNode> & {
      geoBoundary?: unknown;
      postSubscriptionRetention?: unknown;
    };
    const geo = normalizeNodeGeoBoundary(raw.geoBoundary);
    const retention = normalizeNodePostSubscriptionRetention(
      raw.postSubscriptionRetention
    );
    const rawSize = raw.size;
    const out: PsNode = {
      id: n.id ?? uid("n"),
      ...(raw.dfdRoleOverride !== undefined ? { dfdRoleOverride: normalizeDfdValue(raw.dfdRoleOverride, 128) } : {}),
      dfdRoleLegacy: typeof raw.dfdRoleLegacy === "boolean" ? raw.dfdRoleLegacy
        : raw.dfdRoleOverride === undefined && !(rawNodeTypes as unknown[]).some(type =>
          type !== null && typeof type === "object" && "id" in type && type.id === n.type
          && "definition" in type && type.definition !== null && typeof type.definition === "object"
          && "defaultDfdRole" in type.definition && type.definition.defaultDfdRole !== undefined),
      ...normalizeEntityMetadata(n, "node"),
      title: n.title ?? "",
      description: n.description ?? "",
      type: n.type ?? "",
      serviceTreeId: n.serviceTreeId ?? "",
      endpointRegex: n.endpointRegex ?? "",
      position: n.position ?? { x: 0, y: 0 },
      size: {
        width:
          rawSize && Number.isFinite(rawSize.width) && rawSize.width > 0
            ? rawSize.width
            : DEFAULT_NODE_SIZE.width,
        height:
          rawSize && Number.isFinite(rawSize.height) && rawSize.height > 0
            ? rawSize.height
            : DEFAULT_NODE_SIZE.height,
      },
    };
    if (geo) out.geoBoundary = geo;
    if (retention) out.postSubscriptionRetention = retention;
    if (typeof n.color === "string" && /^#[0-9a-fA-F]{6}$/.test(n.color)) {
      out.color = n.color;
    }
    return out;
  });

  const validNodeIds = new Set(normalizedNodes.map((node) => node.id));
  const legacyBoundaryIds = new Set<string>();
  let normalizedBoundaries: PsBoundary[] = (doc.boundaries ?? []).map((b) => {
    const id = b.id ?? uid("b");
    const type: "security" | "privacy" =
      b.type === "privacy" ? "privacy" : "security";
    const rawPrivacy =
      typeof (b as { privacySubtype?: unknown }).privacySubtype === "string"
        ? ((b as { privacySubtype: string }).privacySubtype as string)
        : undefined;
    const rawSecurity =
      typeof (b as { securitySubtype?: unknown }).securitySubtype === "string"
        ? ((b as { securitySubtype: string }).securitySubtype as string)
        : undefined;
    const privacySubtype =
      type === "privacy" &&
      isCatalogReferenceId(rawPrivacy)
        ? rawPrivacy
        : undefined;
    const securitySubtype =
      type === "security" &&
      isCatalogReferenceId(rawSecurity)
        ? rawSecurity
        : undefined;
    const rawNodeIds = (b as { nodeIds?: unknown }).nodeIds;
    if (!Array.isArray(rawNodeIds)) {
      legacyBoundaryIds.add(id);
    }
    return {
      id,
      type,
      title:
        b.title === "Security Boundary" || b.title === "Privacy Boundary"
          ? ""
          : (b.title ?? ""),
      position: b.position ?? { x: 0, y: 0 },
      size: b.size ?? { width: 200, height: 200 },
      nodeIds: Array.isArray(rawNodeIds)
        ? Array.from(
            new Set(
              rawNodeIds.filter(
                (id): id is string =>
                  typeof id === "string" && validNodeIds.has(id),
              ),
            ),
          )
        : [],
      ...(privacySubtype ? { privacySubtype } : {}),
      ...(securitySubtype ? { securitySubtype } : {}),
      ...Object.fromEntries(BOUNDARY_NETWORK_FIELDS.flatMap(({ key, label }) => {
        const value = normalizeBoundaryNetworkText(b[key], label);
        return value === undefined ? [] : [[key, value]];
      })),
    };
  });

  normalizedBoundaries = normalizedBoundaries.map((boundary) => {
    let rect = boundaryRect(boundary);
    for (const node of normalizedNodes) {
      if (boundary.nodeIds.includes(node.id)) {
        rect = expandRectToContain(rect, nodeRect(node));
      }
    }
    return { ...boundary, position: rect.position, size: rect.size };
  });

  for (const boundaryId of legacyBoundaryIds) {
    const adopted = adoptNodesIntoBoundary(
      normalizedNodes,
      normalizedBoundaries,
      boundaryId,
    );
    normalizedNodes = adopted.nodes;
    normalizedBoundaries = adopted.boundaries;
  }

  return {
    version: 1,
    authenticationDefinitions,
    protocolDefinitions,
    ...(catalogDefinitions !== undefined ? { catalogDefinitions } : {}),
    nodeTypes,
    nodes: normalizedNodes,
    ...(textAnnotations !== undefined ? { textAnnotations } : {}),
    edges: rawEdges.map((e) => {
      const authenticationTypes = normalizeAuthTypes(e, authenticationDefinitions);
      const rawPi = (e as { productionIdentity?: unknown }).productionIdentity;
      const productionIdentity = normalizeEdgeProductionIdentity(rawPi);
      const rawProtocolId = (e as { protocolId?: unknown }).protocolId;
      const protocolId = validateProtocolReference(rawProtocolId === null ? undefined : rawProtocolId);
      const rawApplicationId = (e as { applicationId?: unknown }).applicationId;
      const applicationId = typeof rawApplicationId === "string" ? rawApplicationId : undefined;
      return {
        id: e.id ?? uid("e"),
        ...normalizeEntityMetadata(e, "edge"),
        source: e.source ?? "",
        target: e.target ?? "",
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        title: e.title ?? "",
        description: e.description ?? "",
        ...(protocolId ? { protocolId } : {}),
        ...(applicationId !== undefined ? { applicationId } : {}),
        requiredAccessRights: normalizeRequiredAccessRights(e.requiredAccessRights, e.id),
        authenticationTypes,
        productionIdentity,
        audience: e.audience,
        constraints: e.constraints,
        problem: e.problem === true ? true : undefined,
        waypoints: (e.waypoints ?? []).map((w) => ({
          id: w?.id ?? uid("w"),
          x: w?.x ?? 0,
          y: w?.y ?? 0,
        })),
      };
    }),
    boundaries: normalizedBoundaries,
    scenarios: normalizedScenarios,
    data: dataItems,
    comments: ((doc as { comments?: Array<Partial<PsComment>> }).comments ?? [])
      .map((c) => {
        const targetKind: "node" | "edge" =
          c.targetKind === "edge" ? "edge" : "node";
        const targetId = c.targetId ?? "";
        // Resolve scenarioId. If absent (legacy), assign to the first scenario
        // that contains this target. If none does, drop the comment.
        let scenarioId = typeof c.scenarioId === "string" ? c.scenarioId : "";
        const valid =
          scenarioId &&
          normalizedScenarios.some((s) => {
            if (s.id !== scenarioId) return false;
            return targetKind === "node"
              ? s.nodeIds.includes(targetId)
              : s.edgeIds.includes(targetId);
          });
        if (!valid) {
          const fallback = normalizedScenarios.find((s) =>
            targetKind === "node"
              ? s.nodeIds.includes(targetId)
              : s.edgeIds.includes(targetId)
          );
          scenarioId = fallback ? fallback.id : "";
        }
        return {
          id: c.id ?? uid("c"),
          scenarioId,
          targetKind,
          targetId,
          text: c.text ?? "",
          status:
            c.status === "Resolved" ? "Resolved" : ("Active" as CommentStatus),
          createdAt:
            typeof c.createdAt === "number" ? c.createdAt : Date.now(),
          replies: (c.replies ?? []).map((r) => ({
            id: r?.id ?? uid("r"),
            text: r?.text ?? "",
            createdAt:
              typeof r?.createdAt === "number" ? r.createdAt : Date.now(),
          })),
        };
      })
      // Drop legacy comments we couldn't place into any scenario.
      .filter((c) => c.scenarioId !== ""),
    issues: ((doc as { issues?: Array<Partial<PsIssue>> }).issues ?? [])
      .map((i) => {
        const targetKind: "node" | "edge" =
          i.targetKind === "edge" ? "edge" : "node";
        const targetId = i.targetId ?? "";
        const resolutionLink = safeNavigationHref(i.resolutionLink);
        // Validate scenarioIds — keep only ids of real scenarios.
        const validScenarioIds = (i.scenarioIds ?? []).filter(
          (sid): sid is string =>
            typeof sid === "string" &&
            normalizedScenarios.some((s) => s.id === sid)
        );
        return {
          id: i.id ?? uid("i"),
          ...threatNoteFields(i),
          kind: typeof i.kind === "string" && i.kind ? i.kind : undefined,
          ...(typeof i.kind === "string" && i.kind && i.notEvaluatedReason !== undefined
            ? { notEvaluatedReason: normalizeIssueNotEvaluatedReason(i.notEvaluatedReason) } : {}),
          ...(resolutionLink ? { resolutionLink } : {}),
          ...(Array.isArray(i.guidanceReferences) ? { guidanceReferences: i.guidanceReferences } : {}),
          targetKind,
          targetId,
          scenarioIds: Array.from(new Set(validScenarioIds)),
          title: i.title ?? "",
          description: i.description ?? "",
          status:
            i.status === "Resolved" ? "Resolved" : ("Active" as IssueStatus),
          createdAt:
            typeof i.createdAt === "number" ? i.createdAt : Date.now(),
          replies: (i.replies ?? []).map((r) => ({
            id: r?.id ?? uid("ir"),
            text: r?.text ?? "",
            createdAt:
              typeof r?.createdAt === "number" ? r.createdAt : Date.now(),
          })),
        };
      })
      // Drop issues whose target no longer exists.
      .filter((i) => {
        if (i.targetKind === "node") {
          return (doc.nodes ?? []).some((n) => n.id === i.targetId);
        }
        return (doc.edges ?? []).some((e) => e.id === i.targetId);
      }),
    deviations: (
      (doc as { deviations?: Array<Partial<PsDeviation>> }).deviations ?? []
    ).map((deviation) => {
      const createdAt =
        typeof deviation.createdAt === "number"
          ? deviation.createdAt
          : Date.now();
      const targetKind =
        deviation.targetKind === "node" || deviation.targetKind === "edge"
          ? deviation.targetKind
          : undefined;
      const targetId =
        targetKind && typeof deviation.targetId === "string"
          ? deviation.targetId
          : undefined;
      const explanation =
        typeof deviation.explanation === "string" &&
        deviation.explanation.trim()
          ? deviation.explanation.trim()
          : "Imported deviation requires an explanation.";
      const id = deviation.id ?? uid("dv");
      const sampleCalls = normalizeDeviationSampleCalls(deviation.sampleCalls);
      return {
        id,
        key:
          typeof deviation.key === "string" && deviation.key.trim()
            ? deviation.key.trim()
            : `legacy:${id}`,
        kind:
          isCatalogReferenceId(deviation.kind)
            ? deviation.kind
            : "other",
        title:
          typeof deviation.title === "string" && deviation.title.trim()
            ? deviation.title.trim()
            : "Untitled deviation",
        description:
          typeof deviation.description === "string"
            ? deviation.description
            : "",
        explanation,
        status:
          deviation.status === "Resolved"
            ? "Resolved"
            : ("Active" as DeviationStatus),
        evidenceIds: Array.from(
          new Set(
            (deviation.evidenceIds ?? []).filter(
              (evidenceId): evidenceId is string =>
                typeof evidenceId === "string" && evidenceId.trim() !== ""
            )
          )
        ),
        ...(sampleCalls.length > 0 ? { sampleCalls } : {}),
        ...(targetKind && targetId ? { targetKind, targetId } : {}),
        scenarioIds: Array.from(
          new Set(
            (deviation.scenarioIds ?? []).filter(
              (scenarioId): scenarioId is string =>
                typeof scenarioId === "string" &&
                normalizedScenarios.some((scenario) => scenario.id === scenarioId)
            )
          )
        ),
        createdAt,
        updatedAt:
          typeof deviation.updatedAt === "number"
            ? deviation.updatedAt
            : createdAt,
      };
    }),
    workItems,
  };
}

// Re-exports for convenience
export {
  AUTH_TYPES,
  AUTH_TYPE_DEFS,
  AUTH_TYPE_LABELS,
  DATA_CLASSIFICATIONS,
  DATA_CLASSIFICATION_DEFS,
  DATA_CLASSIFICATION_LABELS,
  NODE_TYPE_DEFS,
  NODE_TYPE_DEF_MAP,
  PRIVACY_BOUNDARY_TYPE_DEFS,
  PRIVACY_BOUNDARY_TYPE_LABELS,
  SECURITY_BOUNDARY_TYPE_DEFS,
  SECURITY_BOUNDARY_TYPE_LABELS,
  GEO_BOUNDARY_SETTING_DEFS,
  GEO_BOUNDARY_SETTING_DEF_MAP,
  GEO_BOUNDARY_SETTING_LABELS,
  POST_SUBSCRIPTION_RETENTION_DEFS,
  POST_SUBSCRIPTION_RETENTION_DEF_MAP,
  POST_SUBSCRIPTION_RETENTION_LABELS,
  GDPR_HANDLING_DEFS,
  GDPR_HANDLING_DEF_MAP,
  GDPR_HANDLING_LABELS,
  PRODUCTION_IDENTITY_TENANT_DEFS,
  PRODUCTION_IDENTITY_TENANT_LABELS,
  AUTH_TYPES_REQUIRING_PRODUCTION_IDENTITY,
  edgeRequiresApplicationId,
  edgeRequiresProductionIdentity,
  isGuid,
  formatProductionIdentity,
  canonicalProductionIdentity,
  productionIdentityTenantLabel,
};
