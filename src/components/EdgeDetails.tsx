import { useId, useState } from "react";
import {
  edgeRequiresProductionIdentity,
  isGuid,
  useStore,
} from "../store";
import type {
  AuthenticationType,
  EdgeDataDirection,
  PsData,
  PsEdge,
  PsNode,
  ProductionIdentity,
  ProductionIdentityTenant,
} from "../types";
import {
  authTypeDescription,
  authTypeLabel,
  authBehavior,
  builtInAuthentication,
  isKnownInstalledAuthentication,
  isAuthenticationType,
  dataClassificationDescription,
  dataClassificationLabel,
  productionIdentityTenantLabel,
  productionIdentityTenantChoices,
  REQUIRED_ACCESS_RIGHTS_MAX_LENGTH,
} from "../types";
import {
  allowedAuthMethodsForNode,
  authMethodStatusOnNode,
  isClassificationAllowedByNode,
  nodeTypeDefFor,
} from "../policy";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DetailsTabs } from "./DetailsTabs";
import { useDetailsTab } from "./detailsTabStore";
import { LabelWithTooltip } from "./LabelWithTooltip";
import { TargetIssuesSection } from "./TargetIssuesSection";
import { LibraryMetadataFields } from "./LibraryMetadataFields";
import { useRemoveFromScenarioWithConfirm } from "./useRemoveFromScenarioWithConfirm";
import { useLibraries } from "../libraries/LibraryProvider";

export function EdgeDetails({ edge }: { edge: PsEdge }) {
  const rightsId = useId();
  const [rightsError, setRightsError] = useState<{ edgeId: string; message: string } | null>(null);
  const currentRightsError = rightsError?.edgeId === edge.id ? rightsError.message : null;
  const installed = useLibraries().authentication;
  const {
    updateEdge,
    deleteEdge,
    activeScenarioId,
    activeScenario,
    addEdgeToScenario,
    setEdgeNumberInScenario,
    edgeNumberFor,
    doc,
    nodeTypeCatalog,
    authenticationCatalog,
    authenticationLibrary,
  } = useStore();
  const { removeEdgeOrDelete } = useRemoveFromScenarioWithConfirm();

  const inScenario =
    activeScenario != null && activeScenario.edgeIds.includes(edge.id);
  const number = edgeNumberFor(edge.id);
  const sourceNode = doc.nodes.find((n) => n.id === edge.source);
  const targetNode = doc.nodes.find((n) => n.id === edge.target);
  const targetPolicy = nodeTypeDefFor(targetNode, nodeTypeCatalog);
  const targetHasPolicy = !!targetPolicy && targetPolicy.policyStatus !== "Unspecified";

  // Attached items are scenario-specific AND direction-specific. Request
  // payloads live in edgeRequestData and are validated against the target
  // node; response payloads live in edgeResponseData and are validated
  // against the source node.
  const requestDataIds: string[] =
    activeScenario && inScenario
      ? activeScenario.edgeRequestData[edge.id] ?? []
      : [];
  const responseDataIds: string[] =
    activeScenario && inScenario
      ? activeScenario.edgeResponseData[edge.id] ?? []
      : [];

  const authTypes = edge.authenticationTypes ?? [];
  const selectedAuthType = authTypes.length === 1 ? authTypes[0] : "";
  const setAuthType = (value: string) => {
    const next = isAuthenticationType(value) ? value : "";
    updateEdge(edge.id, {
      authenticationTypes: next ? [next] : undefined,
      ...(next && authBehavior(next, authenticationCatalog).managedIdentity && !edge.productionIdentity
        ? { productionIdentity: { kind: "ManagedIdentity" as const } } : {}),
    });
  };

  // Only present auth methods accepted by the target node, but keep legacy
  // selections visible so the user can replace a method after policy changes.
  const allowedAuthForTarget = new Set(
    allowedAuthMethodsForNode(targetNode, nodeTypeCatalog, authenticationCatalog),
  );
  const visibleAuthTypes = authenticationCatalog.filter(
    (a) => ((!a.disabled && !a.legacy && !a.unavailableReason && authenticationLibrary.some(def => def.id === a.id && !def.disabled))
      && allowedAuthForTarget.has(a.id)) || authTypes.includes(a.id)
  );
  const entraAuth = authTypes.some(id => authBehavior(id, authenticationCatalog).audience);
  const cdtAuth = authTypes.some(id => authBehavior(id, authenticationCatalog).constraints);
  const selectedDefinition = authenticationCatalog.find(def => def.id === selectedAuthType);
  const managedIdentity = authTypes.some(id => authBehavior(id, authenticationCatalog).managedIdentity);

  const [tab, setTab] = useDetailsTab();

  // Production identity validity mirrors IssueManager's
  // ruleEdgeMissingOrInvalidProductionIdentity.
  const piRequired = edgeRequiresProductionIdentity(authTypes, authenticationCatalog);
  const pi = edge.productionIdentity;
  const piIncomplete = (() => {
    if (!piRequired) return false;
    if (!pi) return true;
    if (managedIdentity && pi.kind !== "ManagedIdentity") return true;
    if (pi.kind === "AppId") {
      const appId = pi.appId.trim();
      if (appId === "") return true;
      if (!isGuid(appId)) return true;
    } else if (pi.kind === "ManagedIdentity") {
      return false;
    }
    return false;
  })();

  const generalIncomplete =
    edge.title.trim() === "" || authTypes.length !== 1 || piIncomplete;

  // Privacy = "Edge has no data attached in EITHER direction in the active
  // scenario" (mirrors Edge_must_have_data). Only flagged when the edge is
  // actually a member of the scenario.
  const privacyIncomplete =
    !!activeScenario &&
    inScenario &&
    requestDataIds.length === 0 &&
    responseDataIds.length === 0;

  return (
    <div className="ps-details">
      <h3>Edge</h3>
      <div className="ps-edge-route">
        <span>{sourceNode?.title ?? edge.source}</span>
        <span>→</span>
        <span>{targetNode?.title ?? edge.target}</span>
      </div>

      {activeScenarioId && (
        <div className="ps-scenario-membership">
          {inScenario ? (
            <button
              onClick={() => removeEdgeOrDelete(activeScenarioId, edge.id)}
            >
              Remove from scenario
            </button>
          ) : (
            <button
              onClick={() => addEdgeToScenario(activeScenarioId, edge.id)}
            >
              Add to scenario
            </button>
          )}
        </div>
      )}

      <DetailsTabs
        tab={tab}
        onChange={setTab}
        generalIncomplete={generalIncomplete}
        privacyIncomplete={privacyIncomplete}
      />

      {tab === "general" && (
        <>
          {activeScenarioId && inScenario && (
            <label>
              Sequence # (in scenario)
              <input
                type="number"
                min={1}
                max={activeScenario?.edgeIds.length ?? 1}
                value={number ?? 1}
                onChange={(e) =>
                  setEdgeNumberInScenario(
                    activeScenarioId,
                    edge.id,
                    Number(e.target.value) || 1
                  )
                }
              />
            </label>
          )}

          <label>
            Title
            <AutoGrowTextarea
              value={edge.title}
              onChange={(e) => updateEdge(edge.id, { title: e.target.value })}
            />
          </label>

          <label>
            Description
            <textarea
              value={edge.description}
              onChange={(e) =>
                updateEdge(edge.id, { description: e.target.value })
              }
            />
          </label>

          <label htmlFor={rightsId}>
            <LabelWithTooltip
              label="Required access rights"
              description="Document the rights required for this call, for example an Azure RBAC role or read/write/execute permissions. Include resource scope or justification if useful. Blank means unspecified, not no permissions required. This is declared intent, not verification of deployed grants or compliance."
            />
            <textarea
              id={rightsId}
              rows={3}
              value={edge.requiredAccessRights ?? ""}
              aria-describedby={`${rightsId}-help${currentRightsError ? ` ${rightsId}-error` : ""}`}
              aria-invalid={!!currentRightsError}
              onChange={(event) => {
                try {
                  updateEdge(edge.id, { requiredAccessRights: event.target.value });
                  setRightsError(null);
                } catch (error) {
                  setRightsError({ edgeId: edge.id, message: error instanceof Error ? error.message : String(error) });
                }
              }}
            />
          </label>
          <p id={`${rightsId}-help`} className="ps-description-below">
            Applies to this flow in every scenario that includes it. Blank means unspecified.
            {" "}{(edge.requiredAccessRights ?? "").length}/{REQUIRED_ACCESS_RIGHTS_MAX_LENGTH} UTF-16 code units
            (some characters count as two). Over-limit edits are rejected, not shortened.
          </p>
          {currentRightsError && (
            <p id={`${rightsId}-error`} className="ps-auth-selection-warning" role="alert">
              {currentRightsError}
            </p>
          )}

          <label>
            Authentication method
            {targetNode
              ? ` (accepted by ${targetNode.title || "target"})`
              : ""}
            <select
              value={selectedAuthType}
              onChange={(event) => setAuthType(event.target.value)}
            >
              {authTypes.length > 1 && (
                <option value="" disabled>
                  Multiple legacy methods - choose one
                </option>
              )}
              {authTypes.length <= 1 && (
                <option value="">Not specified</option>
              )}
              {visibleAuthTypes.map((definition) => {
                const authType = definition.id;
                const status = authMethodStatusOnNode(
                  targetNode,
                  authType,
                  nodeTypeCatalog,
                );
                const notAccepted =
                  targetHasPolicy &&
                  status === undefined;
                const suffix =
                  status === "Deprecated"
                    ? " (deprecated)"
                    : notAccepted
                      ? " (not accepted)"
                      : "";
                return (
                  <option key={authType} value={authType}
                    disabled={definition.disabled || definition.legacy || !!definition.unavailableReason || !authenticationLibrary.some(def => def.id === authType && !def.disabled)}>
                    {definition.label}
                    {definition.disabled ? " (disabled)" : ""}
                    {definition.unavailableReason ? " (unavailable)" : ""}
                    {suffix}
                  </option>
                );
              })}
            </select>
          </label>

          {authTypes.length > 1 && (
            <p className="ps-auth-selection-warning" role="alert">
              This edge contains multiple authentication methods from an older
              model. Choose the single method this flow actually uses.
            </p>
          )}

          {selectedAuthType && (
            <div className="ps-auth-selection-summary">
              <p className="ps-auth-description">{authTypeDescription(selectedAuthType, authenticationCatalog)}</p>
              {selectedDefinition && (selectedDefinition.unresolved || selectedDefinition.unavailableReason || selectedDefinition.legacy
                || !isKnownInstalledAuthentication(selectedAuthType, installed) || selectedDefinition.behavior.productionIdentity === "unknown") && (
                <p className="ps-auth-selection-warning" role="status">
                  {selectedDefinition.unavailableReason ? selectedDefinition.unavailableReason
                    : selectedDefinition.unresolved ? "Unresolved definition."
                    : selectedDefinition.legacy ? "Legacy certificate selection: classify its role explicitly."
                    : "Unverified method: its definition does not prove security or target acceptance."}
                </p>
              )}
              {authMethodStatusOnNode(
                targetNode,
                selectedAuthType,
                nodeTypeCatalog,
              ) === "Deprecated" && (
                <span className="ps-policy-pill warn">Deprecated</span>
              )}
              {targetNode
                && targetHasPolicy
                && authMethodStatusOnNode(
                  targetNode,
                  selectedAuthType,
                  nodeTypeCatalog,
                ) === undefined && (
                  <span className="ps-policy-pill bad">Not accepted</span>
                )}
            </div>
          )}

          {visibleAuthTypes.length === 0 && authTypes.length === 0 && (
            <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
              The target node's type does not accept any authentication
              methods.
            </p>
          )}

          {(entraAuth || edge.audience) && (
            <label>
              Audience
              <input
                type="text"
                value={edge.audience ?? ""}
                onChange={(e) =>
                  updateEdge(edge.id, { audience: e.target.value })
                }
                placeholder="api://..."
              />
            </label>
          )}

          {(cdtAuth || edge.constraints) && (
            <label>
              Constraints (CDT)
              <textarea
                value={edge.constraints ?? ""}
                onChange={(e) =>
                  updateEdge(edge.id, { constraints: e.target.value })
                }
              />
            </label>
          )}

          {selectedAuthType !== "InternalProcessCall" && (
            <ProductionIdentityFieldset
              edge={edge}
              required={piRequired}
              onChange={(pi) =>
                updateEdge(edge.id, { productionIdentity: pi })
              }
            />
          )}
          {managedIdentity && pi && pi.kind !== "ManagedIdentity" && (
            <p role="alert" className="ps-auth-selection-warning">
              This profile requires Managed Identity. The existing Application ID is retained; explicitly select Managed Identity or a different method.
            </p>
          )}
        </>
      )}

      {tab === "privacy" && (
        <>
          <EdgeDataFieldset
            direction="request"
            edge={edge}
            attachedIds={requestDataIds}
            receivingNode={targetNode}
          />
          <EdgeDataFieldset
            direction="response"
            edge={edge}
            attachedIds={responseDataIds}
            receivingNode={sourceNode}
          />
        </>
      )}

      <TargetIssuesSection targetKind="edge" targetId={edge.id} />
      <LibraryMetadataFields entity={edge} target="edge" />

      <button className="ps-danger" onClick={() => deleteEdge(edge.id)}>
        Delete edge
      </button>
    </div>
  );
}

// Per-direction data attach/detach section. The request bucket targets the
// edge's TARGET node (data flows source→target with the arrow); the response
// bucket targets the edge's SOURCE node (data flows target→source against
// the arrow). The classification filter for attachable items uses
// `receivingNode` so we only offer items the receiver can accept.
function EdgeDataFieldset({
  direction,
  edge,
  attachedIds,
  receivingNode,
}: {
  direction: EdgeDataDirection;
  edge: PsEdge;
  attachedIds: string[];
  receivingNode: PsNode | undefined;
}) {
  const {
    activeScenario,
    activeScenarioId,
    attachDataToEdge,
    detachDataFromEdge,
    doc,
    classificationDefinitions,
    nodeTypeCatalog,
    updateData,
  } = useStore();
  const inScenario =
    activeScenario != null && activeScenario.edgeIds.includes(edge.id);
  const attachedSet = new Set(attachedIds);
  const attachedData: PsData[] = attachedIds
    .map((id) => doc.data.find((d) => d.id === id))
    .filter((x): x is PsData => Boolean(x));
  const unattached = doc.data.filter((d) => !attachedSet.has(d.id));
  const attachable = unattached.filter((d) =>
    isClassificationAllowedByNode(
      receivingNode,
      d.classification,
      nodeTypeCatalog,
    ),
  );
  const hasReceiverPolicy = !!nodeTypeDefFor(
    receivingNode,
    nodeTypeCatalog,
  );
  const directionLabel = direction === "request" ? "request" : "response";

  const detach = (dataId: string) => {
    if (!activeScenarioId) return;
    detachDataFromEdge(activeScenarioId, edge.id, direction, dataId);
  };
  const attach = (dataId: string) => {
    if (!dataId || !activeScenarioId || attachedSet.has(dataId)) return;
    attachDataToEdge(activeScenarioId, edge.id, direction, dataId);
  };

  return (
    <fieldset className="ps-edge-data">
      <legend>
        Data in {directionLabel}
        {activeScenario ? ` (in ${activeScenario.name})` : ""}
      </legend>
      {!activeScenario ? (
        <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
          Select a scenario to manage attached data.
        </p>
      ) : !inScenario ? (
        <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
          Add this edge to the scenario to attach data.
        </p>
      ) : attachedData.length === 0 ? (
        <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
          No {directionLabel} data items attached in this scenario.
        </p>
      ) : (
        <table className="ps-edge-data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Classification</th>
              <th aria-label="detach" />
            </tr>
          </thead>
          <tbody>
            {attachedData.map((d) => (
              <tr key={d.id}>
                <td>
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) =>
                      updateData(d.id, { name: e.target.value })
                    }
                  />
                </td>
                <td>
                  <span
                    className="ps-readonly-classification"
                    title="Edit classification from the Data menu"
                  >
                    <LabelWithTooltip
                      label={
                        dataClassificationLabel(d.classification, doc.catalogDefinitions, classificationDefinitions)
                      }
                      description={dataClassificationDescription(
                        d.classification, doc.catalogDefinitions, classificationDefinitions,
                      )}
                    />
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="ps-edge-data-detach"
                    title={`Detach from this edge's ${directionLabel} data`}
                    onClick={() => detach(d.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="ps-edge-data-controls">
        {!activeScenario || !inScenario ? null : attachable.length > 0 ? (
          <select
            value=""
            onChange={(e) => {
              attach(e.target.value);
              e.currentTarget.value = "";
            }}
            title={
              hasReceiverPolicy
                ? `Attach a data item accepted by ${
                    receivingNode?.title || "the receiving node"
                  }`
                : "Attach a data item that already exists"
            }
          >
            <option value="">
              Attach existing {directionLabel} data item…
            </option>
            {[...attachable]
              .sort((a, b) =>
                (a.name || "").localeCompare(b.name || "")
              )
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name || "(unnamed)"} —{" "}
                  {dataClassificationLabel(d.classification, doc.catalogDefinitions, classificationDefinitions)}
                </option>
              ))}
          </select>
        ) : (
          <span className="ps-empty" style={{ fontSize: 11, padding: 0 }}>
            {doc.data.length === 0
              ? "Create data items from the toolbar Data button."
              : unattached.length === 0
              ? "All data items are already attached."
              : `No remaining data items are accepted by ${
                  receivingNode?.title || "the receiving node"
                }.`}
          </span>
        )}
      </div>
    </fieldset>
  );
}

// Existing evidence remains editable even when a method has unknown semantics.
function ProductionIdentityFieldset({
  edge,
  required,
  onChange,
}: {
  edge: PsEdge;
  required: boolean;
  onChange: (pi: ProductionIdentity | undefined) => void;
}) {
  const { doc, availableCatalogDefinitions } = useStore();
  const tenants = productionIdentityTenantChoices(doc.catalogDefinitions, availableCatalogDefinitions);
  const pi = edge.productionIdentity;
  // Default kind for the radios — if no value yet, show AppId selected so
  // the form is meaningful; the actual stored value is undefined until the
  // user types something.
  const kind: "AppId" | "ManagedIdentity" = pi?.kind ?? "AppId";

  const setKind = (next: "AppId" | "ManagedIdentity") => {
    if (next === kind && pi) return;
    if (next === "AppId") {
      onChange({ kind: "AppId", appId: "", tenant: "Customer" });
    } else {
      onChange({ kind: "ManagedIdentity" });
    }
  };

  const setAppId = (appId: string) => {
    if (kind !== "AppId") return;
    const tenant: ProductionIdentityTenant =
      (pi?.kind === "AppId" ? pi.tenant : "Customer");
    onChange({ kind: "AppId", appId, tenant });
  };

  const setTenant = (tenant: ProductionIdentityTenant) => {
    const appId = pi?.kind === "AppId" ? pi.appId : "";
    onChange({ kind: "AppId", appId, tenant });
  };

  const appIdValue = pi?.kind === "AppId" ? pi.appId : "";
  const appIdInvalid =
    kind === "AppId" && appIdValue.trim().length > 0 && !isGuid(appIdValue);
  const noValueYet =
    !pi || (pi.kind === "AppId" && pi.appId.trim() === "");

  return (
    <fieldset className="ps-production-identity">
      <legend>
        Production identity
        {required && <span className="ps-required-marker"> *</span>}
      </legend>

      <div className="ps-production-identity-kind">
        <label className="ps-checkbox">
          <input
            type="radio"
            name={`pi-kind-${edge.id}`}
            checked={kind === "AppId"}
            onChange={() => setKind("AppId")}
          />
          Application ID
        </label>
        <label className="ps-checkbox">
          <input
            type="radio"
            name={`pi-kind-${edge.id}`}
            checked={kind === "ManagedIdentity"}
            onChange={() => setKind("ManagedIdentity")}
          />
          Managed Identity
        </label>
      </div>
      {!required && <p>Optional retained evidence; method prose does not determine identity requirements.</p>}
      {pi && <button type="button" onClick={() => onChange(undefined)}>Clear production identity</button>}

      {kind === "AppId" && (
        <>
          <label>
            App ID (GUID)
            <input
              type="text"
              value={appIdValue}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              aria-invalid={appIdInvalid || undefined}
              aria-describedby={
                appIdInvalid ? `pi-appid-err-${edge.id}` : undefined
              }
            />
          </label>
          {appIdInvalid && (
            <div
              id={`pi-appid-err-${edge.id}`}
              className="ps-nodetype-required"
            >
              Must be a GUID (e.g. 12345678-1234-1234-1234-123456789abc).
            </div>
          )}
          <label>
            Tenant
            <select
              value={pi?.kind === "AppId" ? pi.tenant : "Customer"}
              onChange={(e) =>
                setTenant(e.target.value as ProductionIdentityTenant)
              }
            >
              {pi?.kind === "AppId" && !tenants.some((t) => t.id === pi.tenant) && (
                <option value={pi.tenant} disabled>{productionIdentityTenantLabel(pi.tenant, doc.catalogDefinitions)}</option>
              )}
              {[...tenants]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}

      {required && noValueYet && (
        <div className="ps-nodetype-required">
          Required because the selected authentication type uses a
          production identity.
        </div>
      )}
    </fieldset>
  );
}
