import type {
  AuthenticationType,
  DataClassification,
  PsDocument,
  PsIssue,
  PsNode,
  Retention,
  CatalogDefinitionSnapshot,
  AuthTypeDef,
} from "./types";
import {
  authTypeLabel,
  authenticationCatalogFor,
  builtInAuthentication,
  AUTH_TYPE_DEFS,
  installedAuthentication,
  isPackageAuthenticationId,
  authBehavior,
  dataClassificationLabel,
  GEO_BOUNDARY_SETTING_DEF_MAP,
  POST_SUBSCRIPTION_RETENTION_DEF_MAP,
  RETENTION_LABELS,
  edgeRequiresApplicationId,
  formatGeoBoundary,
  formatPostSubscriptionRetention,
  isGuid,
} from "./types";
import { uid } from "./types";
import { propagateScenarioEdgeData } from "./dataPropagation";
import type { LibraryHelp, LibraryRule, MetadataField } from "./libraries/contracts";
import { metadataValue } from "./libraries/document";
import { safeNavigationHref } from "./urlSafety";
import {
  authMethodStatusOnNode,
  isAttachmentAllowedByNode,
  isClassificationAllowedByNode,
  nodeTypeDefFor,
} from "./policy";
import { PROTOCOL_TYPE_DEFS, resolveProtocolReference, type ProtocolTypeDef } from "./protocols";

// Output of a single analyzer rule: one expected issue per (kind, target).
// `scenarioIds` is the set of scenarios in which the rule currently triggers.
// An empty list means the rule is scenario-independent (e.g. structural
// problems on a node such as a missing ServiceTreeId).
interface ExpectedIssue {
  kind: string;
  targetKind: "node" | "edge";
  targetId: string;
  scenarioIds: string[];
  title: string;
  description: string;
  resolutionLink?: string;
}

export const ANALYZER_RULES = {
  ruleEdgeMustHaveData: { targetKind: "edge", kinds: ["Edge_must_have_data"] },
  ruleNodeRetentionMissing: { targetKind: "node", kinds: ["Node_retention_missing"] },
  ruleEdgeHasSingleAuthMethod: { targetKind: "edge", kinds: ["Edge_multiple_auth_methods"] },
  ruleAuthenticationDefinition: { targetKind: "edge", kinds: ["Edge_authentication_definition_review"] },
  ruleEdgeAuthNotAccepted: { targetKind: "edge", kinds: ["Edge_auth_not_accepted"] },
  ruleEdgeDataNotAccepted: { targetKind: "edge", kinds: ["Edge_data_not_accepted"] },
  ruleNodeDataNotAccepted: { targetKind: "node", kinds: ["Node_data_not_accepted"] },
  ruleNodeMissingDeferredInstanceValue: {
    targetKind: "node", kinds: ["Node_missing_deferred_geo", "Node_missing_deferred_retention"],
  },
  ruleEdgeProductionIdentity: {
    targetKind: "edge",
    kinds: ["Edge_missing_application_id", "Edge_invalid_application_id", "Edge_managed_identity_mismatch"],
  },
  ruleEdgeProtocolGuidance: {
    targetKind: "edge", kinds: ["Edge_protocol_guidance_missing", "Edge_protocol_definition_conflict"],
  },
} as const;
export type AnalyzerRuleId = keyof typeof ANALYZER_RULES;
const ALL_RULE_IDS = Object.keys(ANALYZER_RULES) as AnalyzerRuleId[];
const RETIRED_IDENTITY_FINDING_KINDS = new Set([
  "Edge_missing_production_identity", "Edge_invalid_production_identity",
]);

// IssueManager encapsulates the privacy/security analysis pass. It is a
// pure-functional class: `analyze` takes a document and returns a new
// document with (a) edge data propagated onto each node and (b) the typed
// issue list reconciled against the current state of the diagram.
//
// Reconciliation rules:
//  - Untyped issues (no `kind`) are never touched.
//  - For each rule that triggers, if an issue with the same
//    (kind, targetKind, targetId) already exists, it is updated in place:
//    title, description, and scenarioIds are refreshed; id, status,
//    createdAt, and replies are preserved.
//  - Typed issues clear only after complete evaluation of their target, or
//    when their target no longer exists. Unavailable rules/policies retain
//    the entire original finding, including all scenario evidence.
//  - New violations create new Active issues with fresh ids.
export class IssueManager {
  constructor(
    private readonly classificationDefinitions?: readonly CatalogDefinitionSnapshot[],
    // Runtime-owned selection, never read from a diagram or profile preference.
    private readonly enabledRules: readonly AnalyzerRuleId[] = ALL_RULE_IDS,
    private readonly libraryRules: readonly LibraryRule[] = [],
    private readonly libraryFields: readonly MetadataField[] = [],
    private readonly installedAuthenticationDefinitions: readonly AuthTypeDef[] = AUTH_TYPE_DEFS,
    private readonly libraryHelp: readonly LibraryHelp[] = [],
    private readonly availableProtocolDefinitions: readonly ProtocolTypeDef[] = PROTOCOL_TYPE_DEFS,
  ) {}
  analyze(doc: PsDocument): PsDocument {
    const propagated = this.propagateEdgeDataToAllScenarios(doc);
    const expected: ExpectedIssue[] = [];
    const evaluatedKinds = new Map<string, "node" | "edge">();
    const unavailablePolicies = new Set<string>();
    for (const id of new Set(this.enabledRules)) {
      if (!Object.hasOwn(ANALYZER_RULES, id)) throw new Error(`Unknown analyzer rule: ${id}`);
      const rule = ANALYZER_RULES[id];
      expected.push(...this[id](propagated, unavailablePolicies));
      // An exception aborts the whole pure pass; no coverage or partial result
      // is committed. A successful empty result still establishes coverage.
      for (const kind of rule.kinds) evaluatedKinds.set(kind, rule.targetKind);
    }
    for (const rule of this.libraryRules) {
      if (evaluatedKinds.has(rule.id)) throw new Error(`Duplicate analyzer finding kind: ${rule.id}`);
      const field = this.libraryFields.find(field => field.id === rule.fieldId && field.target === rule.target);
      if (!field) continue;
      for (const entity of rule.target === "node" ? propagated.nodes : propagated.edges) {
        const saved = entity.metadataFields?.find(item => item.id === field.id);
        if (saved && (saved.target !== field.target || saved.storage !== field.storage)) {
          unavailablePolicies.add(this.key(rule.id, rule.target, entity.id));
          continue;
        }
        const value = metadataValue(entity, field).trim();
        if (rule.check === "required" ? value === "" : value !== "" && !isGuid(value)) {
          expected.push({
            kind: rule.id, targetKind: rule.target, targetId: entity.id, scenarioIds: [],
            title: rule.title, description: rule.description, resolutionLink: rule.resolutionLink,
          });
        }
      }
      evaluatedKinds.set(rule.id, rule.target);
    }
    const issues = this.reconcileIssues(propagated, expected, evaluatedKinds, unavailablePolicies);
    return { ...propagated, issues };
  }

  // Mirror of the existing per-scenario "Update nodes from edges" action,
  // applied to every scenario at once. New data items flowing into a node
  // are attached with retention "" (unset); already-attached items are left
  // untouched, including their retention value.
  //
  // Request data on edge X→Y propagates to Y; response data on edge X→Y
  // propagates back to X.
  private propagateEdgeDataToAllScenarios(doc: PsDocument): PsDocument {
    const scenarios = doc.scenarios.map(scenario => propagateScenarioEdgeData(scenario, doc.edges));
    return { ...doc, scenarios };
  }

  // Rule: every edge that participates in at least one scenario must have
  // some data attached in each of those scenarios. The issue's scenarioIds
  // enumerate the scenarios where the edge has BOTH request and response
  // data buckets empty.
  private ruleEdgeMustHaveData(doc: PsDocument): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    for (const edge of doc.edges) {
      const offending: string[] = [];
      for (const s of doc.scenarios) {
        if (!s.edgeIds.includes(edge.id)) continue;
        const req = s.edgeRequestData[edge.id] ?? [];
        const resp = s.edgeResponseData[edge.id] ?? [];
        if (req.length === 0 && resp.length === 0) offending.push(s.id);
      }
      if (offending.length === 0) continue;
      out.push({
        kind: "Edge_must_have_data",
        targetKind: "edge",
        targetId: edge.id,
        scenarioIds: offending,
        title: "Edge has no data attached",
        description:
          "Every edge that participates in a scenario must have at least one data item attached (in either the request or response direction) in that scenario. Attach a data item from the edge's Privacy section.",
      });
    }
    return out;
  }

  private ruleEdgeHasSingleAuthMethod(doc: PsDocument): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    for (const edge of doc.edges) {
      const auths = edge.authenticationTypes ?? [];
      if (auths.length <= 1) continue;
      out.push({
        kind: "Edge_multiple_auth_methods",
        targetKind: "edge",
        targetId: edge.id,
        scenarioIds: [],
        title: "Edge has multiple authentication methods",
        description:
          "A data-flow edge represents one concrete call and must specify the single authentication method that call uses. Open the edge properties and choose one method.",
      });
    }

    return out;
  }

  private ruleAuthenticationDefinition(doc: PsDocument): ExpectedIssue[] {
    const catalog = authenticationCatalogFor(doc, this.installedAuthenticationDefinitions, this.installedAuthenticationDefinitions);
    return doc.edges.flatMap(edge => {
      const problems = (edge.authenticationTypes ?? []).flatMap(id => {
        const def = catalog.find(entry => entry.id === id);
        if (def?.unavailableReason) return [`${id}: ${def.unavailableReason}`];
        if (!def || def.unresolved) return [`${id}: unresolved definition`];
        if (def.legacy) return [`${def.label}: certificate role needs explicit classification`];
        if ((!builtInAuthentication(id) && !isPackageAuthenticationId(id))
            || !installedAuthentication(id, this.installedAuthenticationDefinitions) || def.behavior.productionIdentity === "unknown") {
          return [`${def.label}: unverified semantics; confirm the owner's contract`];
        }
        return [];
      });
      return problems.length ? [{
        kind: "Edge_authentication_definition_review", targetKind: "edge" as const,
        targetId: edge.id, scenarioIds: [], title: "Authentication definition needs review",
        description: `${problems.join("; ")}. A library entry or edited description does not establish security or target acceptance. Existing flow metadata is retained.`,
      }] : [];
    });
  }

  // Rule: every data item attached to a node (in a given scenario) must
  // have a retention period set (non-empty). scenarioIds enumerates the
  // scenarios where at least one attached data item is missing retention.
  private ruleNodeRetentionMissing(doc: PsDocument): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    for (const node of doc.nodes) {
      const offending: string[] = [];
      for (const s of doc.scenarios) {
        if (!s.nodeIds.includes(node.id)) continue;
        const map = s.nodeData[node.id] ?? {};
        const hasMissing = Object.values(map).some((r) => r === "");
        if (hasMissing) offending.push(s.id);
      }
      if (offending.length === 0) continue;
      out.push({
        kind: "Node_retention_missing",
        targetKind: "node",
        targetId: node.id,
        scenarioIds: offending,
        title: "Node data items are missing retention",
        description:
          "Every data item attached to a node must have a retention period assigned. Open the node's Data section and set a retention value for each attached item.",
      });
    }
    return out;
  }

  // Rule: an edge's authenticationTypes must all be Allowed by the target
  // node's type policy. Deprecated methods are also flagged (so consumers
  // can react to a policy that has tightened over time). Auth lives on the
  // edge itself rather than per-scenario, so scenarioIds is empty.
  // Skipped when the target node's type is free-form / not in the catalog,
  // since no policy exists to evaluate against.
  private ruleEdgeAuthNotAccepted(doc: PsDocument, unavailable: Set<string>): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    const catalog = authenticationCatalogFor(doc, this.installedAuthenticationDefinitions, this.installedAuthenticationDefinitions);
    const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
    for (const edge of doc.edges) {
      const auths = edge.authenticationTypes ?? [];
      if (auths.length === 0) continue;
      const target = nodesById.get(edge.target);
      const targetPolicy = nodeTypeDefFor(target, doc.nodeTypes);
      if (!targetPolicy || targetPolicy.policyStatus === "Unspecified") {
        unavailable.add(this.key("Edge_auth_not_accepted", "edge", edge.id));
        continue;
      }
      const notAccepted: AuthenticationType[] = [];
      const deprecated: AuthenticationType[] = [];
      for (const a of auths) {
        const status = authMethodStatusOnNode(target, a, doc.nodeTypes);
        if (status === undefined) notAccepted.push(a);
        else if (status === "Deprecated") deprecated.push(a);
      }
      if (notAccepted.length === 0 && deprecated.length === 0) continue;
      const parts: string[] = [];
      if (notAccepted.length > 0) {
        parts.push(
          `not accepted: ${notAccepted
            .map((a) => authTypeLabel(a, catalog))
            .join(", ")}`
        );
      }
      if (deprecated.length > 0) {
        parts.push(
          `deprecated: ${deprecated
            .map((a) => authTypeLabel(a, catalog))
            .join(", ")}`
        );
      }
      out.push({
        kind: "Edge_auth_not_accepted",
        targetKind: "edge",
        targetId: edge.id,
        scenarioIds: [],
        title: "Edge uses auth not accepted by target node",
        description: `The target node "${this.describeNode(
          target!
        )}" of type "${target!.type}" ${
          notAccepted.length > 0 && deprecated.length === 0
            ? "does not accept"
            : deprecated.length > 0 && notAccepted.length === 0
              ? "has deprecated"
              : "does not accept some and has deprecated others of"
        } the authentication methods on this edge (${parts.join(
          "; "
        )}). Update the edge's auth selection or adjust the target node's type policy.`,
        resolutionLink:
          deprecated.length > 0
            ? safeNavigationHref(this.libraryHelp.find(help => help.id === "analysis.deprecated-auth-guidance")?.url) ?? undefined
            : undefined,
      });
    }
    return out;
  }

  // Rule: every data item attached to an edge must have a classification that
  // is accepted by the node that ultimately receives it. For request data
  // (source → target) that's the EDGE'S TARGET node; for response data
  // (target → source) that's the EDGE'S SOURCE node. scenarioIds enumerates
  // the scenarios where the edge currently carries a disallowed-classification
  // item in either direction. Per-direction checks are skipped when the
  // relevant receiving node's type is free-form / not in the catalog.
  private ruleEdgeDataNotAccepted(doc: PsDocument, unavailable: Set<string>): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
    const dataById = new Map(doc.data.map((d) => [d.id, d]));
    for (const edge of doc.edges) {
      const target = nodesById.get(edge.target);
      const source = nodesById.get(edge.source);
      const targetPolicy = nodeTypeDefFor(target, doc.nodeTypes);
      const sourcePolicy = nodeTypeDefFor(source, doc.nodeTypes);
      const checkTarget = !!targetPolicy && targetPolicy.policyStatus !== "Unspecified";
      const checkSource = !!sourcePolicy && sourcePolicy.policyStatus !== "Unspecified";
      const offendingScenarios: string[] = [];
      const offendingClassifications = new Set<DataClassification>();
      const offendingReceivers = new Set<string>();
      for (const s of doc.scenarios) {
        if (!s.edgeIds.includes(edge.id)) continue;
        if ((!checkTarget && (s.edgeRequestData[edge.id]?.length ?? 0) > 0)
            || (!checkSource && (s.edgeResponseData[edge.id]?.length ?? 0) > 0)) {
          unavailable.add(this.key("Edge_data_not_accepted", "edge", edge.id));
        }
        const bad: DataClassification[] = [];
        if (checkTarget) {
          for (const did of s.edgeRequestData[edge.id] ?? []) {
            const d = dataById.get(did);
            if (!d) continue;
            if (
              !isClassificationAllowedByNode(
                target,
                d.classification,
                doc.nodeTypes,
              )
            ) {
              bad.push(d.classification);
              offendingReceivers.add(this.describeNode(target!));
            }
          }
        }
        if (checkSource) {
          for (const did of s.edgeResponseData[edge.id] ?? []) {
            const d = dataById.get(did);
            if (!d) continue;
            if (
              !isClassificationAllowedByNode(
                source,
                d.classification,
                doc.nodeTypes,
              )
            ) {
              bad.push(d.classification);
              offendingReceivers.add(this.describeNode(source!));
            }
          }
        }
        if (bad.length > 0) {
          offendingScenarios.push(s.id);
          for (const c of bad) offendingClassifications.add(c);
        }
      }
      if (offendingScenarios.length === 0) continue;
      const list = Array.from(offendingClassifications)
        .map((id) => dataClassificationLabel(id, doc.catalogDefinitions, this.classificationDefinitions))
        .join(", ");
      const receivers = Array.from(offendingReceivers).join(", ");
      out.push({
        kind: "Edge_data_not_accepted",
        targetKind: "edge",
        targetId: edge.id,
        scenarioIds: offendingScenarios,
        title: "Edge carries data not accepted by receiving node",
        description: `The receiving node(s) ${receivers} do not accept the following data classifications carried by this edge: ${list}. Remove the offending data items, route them through a different node, or adjust the receiving node's type policy.`,
      });
    }
    return out;
  }

  // Rule: every (data item, retention) attachment on a node must be Allowed
  // by the node's type policy. Items with retention "" (unset) are skipped
  // here because they're already covered by Node_retention_missing.
  // scenarioIds enumerates the scenarios where the node currently has a
  // disallowed attachment. Skipped when the node's type is free-form / not
  // in the catalog.
  private ruleNodeDataNotAccepted(doc: PsDocument, unavailable: Set<string>): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    const dataById = new Map(doc.data.map((d) => [d.id, d]));
    for (const node of doc.nodes) {
      const policy = nodeTypeDefFor(node, doc.nodeTypes);
      const offendingScenarios: string[] = [];
      const offendingPairs = new Set<string>();
      for (const s of doc.scenarios) {
        if (!s.nodeIds.includes(node.id)) continue;
        const map = s.nodeData[node.id] ?? {};
        let scenarioHasOffender = false;
        for (const [did, retention] of Object.entries(map)) {
          if (retention === "") continue; // covered by Node_retention_missing
          const d = dataById.get(did);
          if (!d) continue;
          if (!policy || policy.policyStatus === "Unspecified") {
            unavailable.add(this.key("Node_data_not_accepted", "node", node.id));
            continue;
          }
          if (
            !isAttachmentAllowedByNode(
              node,
              d.classification,
              retention as Retention,
              doc.nodeTypes,
            )
          ) {
            scenarioHasOffender = true;
            offendingPairs.add(
              `${
                dataClassificationLabel(d.classification, doc.catalogDefinitions, this.classificationDefinitions)
              } / ${RETENTION_LABELS[retention as Retention] ?? retention}`
            );
          }
        }
        if (scenarioHasOffender) offendingScenarios.push(s.id);
      }
      if (offendingScenarios.length === 0) continue;
      const list = Array.from(offendingPairs).join("; ");
      out.push({
        kind: "Node_data_not_accepted",
        targetKind: "node",
        targetId: node.id,
        scenarioIds: offendingScenarios,
        title: "Node handles data not accepted by its type policy",
        description: `Node "${this.describeNode(
          node
        )}" of type "${node.type}" is handling data attachments that violate its type policy: ${list}. Detach the offending items, change their retention, or adjust the node type's allowedDataTypes.`,
      });
    }
    return out;
  }

  // Rule: when a node's type defers a setting to the calling service (e.g.
  // type's geoBoundary.id is "DataKeptInGeoUnlessIndicatedByCaller"), the
  // node instance MUST supply a concrete override. normalizeDoc already
  // refuses to store deferred variants as overrides, so a missing override
  // means literal absence — checking for undefined is sufficient. Emitted
  // independently per affected field so issues are individually addressable.
  private ruleNodeMissingDeferredInstanceValue(
    doc: PsDocument,
    unavailable: Set<string>,
  ): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    for (const node of doc.nodes) {
      const def = nodeTypeDefFor(node, doc.nodeTypes);
      if ((!def || (def.policyStatus === "Unspecified" && !def.geoBoundary)) && !node.geoBoundary) {
        unavailable.add(this.key("Node_missing_deferred_geo", "node", node.id));
      }
      if ((!def || (def.policyStatus === "Unspecified" && !def.postSubscriptionRetention)) && !node.postSubscriptionRetention) {
        unavailable.add(this.key("Node_missing_deferred_retention", "node", node.id));
      }
      if (!def) continue;

      if (def.geoBoundary) {
        const geoDef = GEO_BOUNDARY_SETTING_DEF_MAP[def.geoBoundary.id];
        if (!geoDef && !node.geoBoundary) unavailable.add(this.key("Node_missing_deferred_geo", "node", node.id));
        if (geoDef?.instanceMustSpecify && !node.geoBoundary) {
          out.push({
            kind: "Node_missing_deferred_geo",
            targetKind: "node",
            targetId: node.id,
            scenarioIds: [],
            title: "Node must specify a geo boundary value",
            description: `Node "${this.describeNode(
              node
            )}" of type "${node.type}" has a geo-boundary policy of "${formatGeoBoundary(
              def.geoBoundary
            )}", which defers the concrete behavior to the calling service. Set a concrete geo boundary on this node in its properties panel.`,
          });
        }
      }

      if (def.postSubscriptionRetention) {
        const retDef =
          POST_SUBSCRIPTION_RETENTION_DEF_MAP[
            def.postSubscriptionRetention.id
          ];
        if (!retDef && !node.postSubscriptionRetention) {
          unavailable.add(this.key("Node_missing_deferred_retention", "node", node.id));
        }
        if (retDef?.instanceMustSpecify && !node.postSubscriptionRetention) {
          out.push({
            kind: "Node_missing_deferred_retention",
            targetKind: "node",
            targetId: node.id,
            scenarioIds: [],
            title: "Node must specify a post-subscription retention value",
            description: `Node "${this.describeNode(
              node
            )}" of type "${node.type}" has a post-subscription retention policy of "${formatPostSubscriptionRetention(
              def.postSubscriptionRetention
            )}", which defers the concrete behavior to the calling service. Set a concrete retention on this node in its properties panel.`,
          });
        }
      }
    }
    return out;
  }

  private describeNode(n: PsNode): string {
    return n.title?.trim() ? n.title : n.id;
  }

  // Rule: methods requiring a caller application ID must declare one. Emits
  // distinct kinds so users can distinguish "not yet specified" from
  // "specified but malformed":
  //   - Edge_missing_application_id: required but no value at all.
  //   - Edge_invalid_application_id: a value is present but is not a GUID.
  // Issues only fire when the edge's auth selection actually requires the
  // field, so selecting Managed Identity does not require a redundant identity tag.
  private ruleEdgeProductionIdentity(doc: PsDocument, unavailable: Set<string>): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    const catalog = authenticationCatalogFor(doc, this.installedAuthenticationDefinitions, this.installedAuthenticationDefinitions);
    for (const edge of doc.edges) {
      if ((edge.authenticationTypes ?? []).some(id => {
        const def = catalog.find(entry => entry.id === id);
        return !def || def.unresolved || def.unavailableReason || def.legacy
          || (!builtInAuthentication(id) && !isPackageAuthenticationId(id)) || !installedAuthentication(id, this.installedAuthenticationDefinitions)
          || def.behavior.productionIdentity === "unknown";
      })) {
        for (const kind of ANALYZER_RULES.ruleEdgeProductionIdentity.kinds) {
          unavailable.add(this.key(kind, "edge", edge.id));
        }
      }
      const requiresApplicationId = edgeRequiresApplicationId(edge.authenticationTypes, catalog);
      const applicationId = edge.applicationId?.trim() ?? "";
      const edgeTitle = edge.title?.trim() ? edge.title : edge.id;
      const managedIdentityAuth = (edge.authenticationTypes ?? []).some(id =>
        authBehavior(id, catalog).managedIdentity,
      );
      const legacyIdentityMismatch = edge.productionIdentity?.kind === "AppId"
        ? managedIdentityAuth
        : edge.productionIdentity?.kind === "ManagedIdentity" && requiresApplicationId;
      if (legacyIdentityMismatch || (managedIdentityAuth && applicationId !== "")) {
        out.push({
          kind: "Edge_managed_identity_mismatch",
          targetKind: "edge",
          targetId: edge.id,
          scenarioIds: [],
          title: "Caller identity evidence conflicts with authentication",
          description: managedIdentityAuth
            ? `Edge "${edgeTitle}" uses Managed Identity authentication while also retaining Application ID evidence. Review the standalone caller Application ID and read-only legacy identity evidence; Managed Identity does not require an identity tag.`
            : `Edge "${edgeTitle}" requires a caller Application ID but retains legacy Managed Identity evidence. Review the authentication choice and preserved evidence.`,
        });
      }
      if (applicationId !== "" && !isGuid(applicationId)) {
        out.push({
          kind: "Edge_invalid_application_id", targetKind: "edge", targetId: edge.id, scenarioIds: [],
          title: "Edge caller Application ID is not a valid GUID",
          description: `Edge "${edgeTitle}" has a caller Application ID that is not a GUID. Provide the GUID of the calling application's client ID.`,
        });
      } else if (requiresApplicationId && applicationId === "") {
        out.push({
          kind: "Edge_missing_application_id", targetKind: "edge", targetId: edge.id, scenarioIds: [],
          title: "Edge is missing a caller Application ID",
          description: `Edge "${edgeTitle}" uses an authentication method that requires the calling application's client ID. Set the standalone Application ID in the edge's Communication section.`,
        });
      }
    }
    return out;
  }

  private ruleEdgeProtocolGuidance(doc: PsDocument): ExpectedIssue[] {
    const out: ExpectedIssue[] = [];
    for (const edge of doc.edges) {
      if (!edge.protocolId) continue;
      const resolution = resolveProtocolReference(edge.protocolId, doc.protocolDefinitions, this.availableProtocolDefinitions);
      if (resolution.status === "unresolved") {
        out.push({
          kind: "Edge_protocol_guidance_missing", targetKind: "edge", targetId: edge.id, scenarioIds: [],
          title: "Communication profile guidance is missing",
          description: `Edge "${edge.title?.trim() || edge.id}" references unresolved protocol "${edge.protocolId}". No profile semantics or AI guidance were inferred; restore or explicitly replace the profile.`,
        });
      } else if (resolution.status === "resolved" && resolution.conflict) {
        out.push({
          kind: "Edge_protocol_definition_conflict", targetKind: "edge", targetId: edge.id, scenarioIds: [],
          title: "Saved communication profile differs from the active library",
          description: `Edge "${edge.title?.trim() || edge.id}" uses saved-first protocol "${edge.protocolId}", whose portable diagram definition differs from the active profile library. Resolve the definition in the Communication section.`,
        });
      }
    }
    return out;
  }

  private reconcileIssues(
    doc: PsDocument,
    expected: ExpectedIssue[],
    evaluatedKinds: ReadonlyMap<string, "node" | "edge">,
    unavailablePolicies: ReadonlySet<string>,
  ): PsIssue[] {
    const expectedByKey = new Map<string, ExpectedIssue>();
    for (const e of expected) {
      expectedByKey.set(this.key(e.kind, e.targetKind, e.targetId), e);
    }
    const handledKeys = new Set<string>();
    const nodeIds = new Set(doc.nodes.map(node => node.id));
    const edgeIds = new Set(doc.edges.map(edge => edge.id));
    const next: PsIssue[] = [];
    for (const issue of doc.issues) {
      if (!issue.kind) {
        // Manually authored — leave untouched.
        next.push(issue);
        continue;
      }
      if (!(issue.targetKind === "node" ? nodeIds : edgeIds).has(issue.targetId)) continue;
      const key = this.key(issue.kind, issue.targetKind, issue.targetId);
      const notEvaluatedReason = evaluatedKinds.get(issue.kind) !== issue.targetKind
        ? RETIRED_IDENTITY_FINDING_KINDS.has(issue.kind) ? "rule-retired" : "rule-unavailable"
        : unavailablePolicies.has(key) ? "policy-unavailable" : undefined;
      if (notEvaluatedReason) {
        handledKeys.add(key);
        next.push({ ...issue, notEvaluatedReason });
        continue;
      }
      const exp = expectedByKey.get(key);
      if (!exp) {
        // Rule no longer triggers — drop the issue.
        continue;
      }
      handledKeys.add(key);
      const { notEvaluatedReason: previousLimitation, resolutionLink: previousGuidance, ...evaluatedIssue } = issue;
      // Refresh title/description/scenarioIds/resolutionLink; preserve
      // everything else (status, replies, createdAt, id) so user state isn't
      // lost. resolutionLink is rule-driven, so we always overwrite it
      // (including clearing it when the rule no longer wants one).
      next.push({
        ...evaluatedIssue,
        title: exp.title,
        description: exp.description,
        scenarioIds: [...exp.scenarioIds],
        ...(exp.resolutionLink ? { resolutionLink: exp.resolutionLink } : {}),
      });
    }
    // Anything still expected but not yet matched is a brand-new violation.
    const now = Date.now();
    for (const [key, exp] of expectedByKey) {
      if (handledKeys.has(key)) continue;
      next.push({
        id: uid("i"),
        kind: exp.kind,
        targetKind: exp.targetKind,
        targetId: exp.targetId,
        scenarioIds: [...exp.scenarioIds],
        title: exp.title,
        description: exp.description,
        status: "Active",
        createdAt: now,
        replies: [],
        ...(exp.resolutionLink ? { resolutionLink: exp.resolutionLink } : {}),
        ...(unavailablePolicies.has(key) ? { notEvaluatedReason: "policy-unavailable" as const } : {}),
      });
    }
    return next;
  }

  private key(kind: string, targetKind: "node" | "edge", targetId: string) {
    return JSON.stringify([kind, targetKind, targetId]);
  }
}
