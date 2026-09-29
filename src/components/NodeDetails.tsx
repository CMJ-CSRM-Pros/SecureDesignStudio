import {
  GEO_BOUNDARY_SETTING_DEF_MAP,
  GEO_BOUNDARY_SETTING_DEFS,
  POST_SUBSCRIPTION_RETENTION_DEF_MAP,
  POST_SUBSCRIPTION_RETENTION_DEFS,
  useStore,
} from "../store";
import {
  RETENTION_LABELS,
  RETENTION_TYPES,
  authTypeDescription,
  authTypeLabel,
  dataClassificationDescription,
  dataClassificationLabel,
  formatGdprHandling,
  formatGeoBoundary,
  formatPostSubscriptionRetention,
  gdprHandlingDescription,
  geoBoundarySettingDescription,
  nodeTypeDescription,
  postSubscriptionRetentionDescription,
  privacyBoundaryTypeDescription,
  privacyBoundaryTypeLabel,
  retentionDescription,
  resolveNodeTypeDef,
  type GeoBoundarySetting,
  type NodeTypeDef,
  type PostSubscriptionRetention,
  type PsData,
  type PsNode,
  type Retention,
} from "../types";
import { isClassificationAllowedByNode, nodeTypeDefFor } from "../policy";
import { nodeTypeIconUrl } from "../nodeTypeIcons";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { Combobox } from "./Combobox";
import { DetailsTabs } from "./DetailsTabs";
import { useDetailsTab } from "./detailsTabStore";
import { LabelWithTooltip } from "./LabelWithTooltip";
import { RichText } from "./RichText";
import { TargetIssuesSection } from "./TargetIssuesSection";
import { useRemoveFromScenarioWithConfirm } from "./useRemoveFromScenarioWithConfirm";
import { LibraryMetadataFields } from "./LibraryMetadataFields";
import { useLibraries } from "../libraries/LibraryProvider";
import { nodeTypeMetadataDefaults } from "../nodeTypeMetadata";
import { inventoryFieldFor, inventoryIdError } from "../inventoryIdentity";

export function NodeDetails({ node }: { node: PsNode }) {
  const libraries = useLibraries();
  const inventoryField = inventoryFieldFor(libraries.fields);
  const {
    updateNode,
    deleteNode,
    doc,
    nodeTypeCatalog,
    authenticationCatalog,
    classificationDefinitions,
    addNodeType,
    activeScenarioId,
    activeScenario,
    addNodeToScenario,
    updateData,
    attachDataToNode,
    detachDataFromNode,
    setNodeDataRetention,
  } = useStore();
  const { removeNodeOrDelete } = useRemoveFromScenarioWithConfirm();

  const typeDef = resolveNodeTypeDef(node.type, nodeTypeCatalog);
  const typeIconUrl = nodeTypeIconUrl(node.type, nodeTypeCatalog);
  const libraryType = libraries.provenance[`nodes/${node.type.toLowerCase()}`];
  const documentDefinition = doc.nodeTypes.find(
    (type) => type.id === node.type,
  )?.definition;
  const { values: suppliedMetadata, error: metadataError } = nodeTypeMetadataDefaults(typeDef, inventoryField);
  const identityError = inventoryIdError(node.serviceTreeId, inventoryField);
  const inventoryRequired = libraries.rules.some(rule => rule.target === "node" &&
    rule.fieldId === inventoryField.id && rule.check === "required");
  const locksTypeMetadata =
    !!typeDef &&
    !metadataError &&
    (!libraryType || libraryType === "core") &&
    !documentDefinition &&
    typeDef.policyStatus !== "Unspecified";
  const locksServiceTree =
    locksTypeMetadata && !!typeDef?.serviceTreeId.trim() && node.serviceTreeId === typeDef.serviceTreeId;
  const locksEndpoint = locksTypeMetadata && node.endpointRegex === typeDef?.endpointRegex;
  const metadataDiffers =
    (suppliedMetadata.serviceTreeId !== undefined && node.serviceTreeId !== suppliedMetadata.serviceTreeId) ||
    (suppliedMetadata.endpointRegex !== undefined && node.endpointRegex !== suppliedMetadata.endpointRegex);

  const onTypeChange = (next: string) => {
    if (next === node.type) return;
    const def = resolveNodeTypeDef(next, nodeTypeCatalog);
    updateNode(node.id, { type: next, ...nodeTypeMetadataDefaults(def, inventoryField).values });
  };

  const applyTypeMetadata = () => {
    if (!metadataDiffers) return;
    if (!window.confirm(`Replace this node's ${inventoryField.label} and EndpointRegex where type defaults are supplied? Other node data will be kept.`)) return;
    updateNode(node.id, suppliedMetadata);
  };

  const inScenario =
    activeScenario != null && activeScenario.nodeIds.includes(node.id);

  const scenarioNodeMap: Record<string, Retention> =
    activeScenario && inScenario
      ? activeScenario.nodeData[node.id] ?? {}
      : {};
  const attachedIds = Object.keys(scenarioNodeMap);
  const attachedSet = new Set(attachedIds);
  const attachedData: PsData[] = attachedIds
    .map((id) => doc.data.find((d) => d.id === id))
    .filter((x): x is PsData => Boolean(x));
  const unattachedData = doc.data.filter((d) => !attachedSet.has(d.id));

  // Filter the attachable list to data items whose classification is allowed
  // by this node's type policy. Unknown/free-form node types are permissive.
  const attachableData = unattachedData.filter((d) =>
    isClassificationAllowedByNode(node, d.classification, nodeTypeCatalog)
  );

  const detachItem = (dataId: string) => {
    if (!activeScenarioId) return;
    detachDataFromNode(activeScenarioId, node.id, dataId);
  };
  const attachItem = (dataId: string) => {
    if (!activeScenarioId || !dataId || attachedSet.has(dataId)) return;
    attachDataToNode(activeScenarioId, node.id, dataId);
  };
  const changeRetention = (dataId: string, r: Retention) => {
    if (!activeScenarioId) return;
    setNodeDataRetention(activeScenarioId, node.id, dataId, r);
  };

  // Tab persistence shared across NodeDetails/EdgeDetails instances.
  const [tab, setTab] = useDetailsTab();

  // Indicator logic mirrors the IssueManager rules so the tab badge
  // reflects fields that would surface as an Issue.
  const generalIncomplete =
    node.title.trim() === "" ||
    node.type.trim() === "" ||
    (inventoryRequired && node.serviceTreeId.trim() === "") || !!identityError;

  const geoDefersForType = typeDef?.geoBoundary
    ? !!GEO_BOUNDARY_SETTING_DEF_MAP[typeDef.geoBoundary.id]?.instanceMustSpecify
    : false;
  const retDefersForType = typeDef?.postSubscriptionRetention
    ? !!POST_SUBSCRIPTION_RETENTION_DEF_MAP[
        typeDef.postSubscriptionRetention.id
      ]?.instanceMustSpecify
    : false;
  const missingDeferredGeo = geoDefersForType && !node.geoBoundary;
  const missingDeferredRetention =
    retDefersForType && !node.postSubscriptionRetention;
  const hasUnsetAttachedRetention =
    activeScenario && inScenario
      ? Object.values(scenarioNodeMap).some((r) => r === "")
      : false;
  const privacyIncomplete =
    missingDeferredGeo ||
    missingDeferredRetention ||
    hasUnsetAttachedRetention;

  return (
    <div className="ps-details">
      <h3>Node</h3>
      <LibraryMetadataFields entity={node} target="node" />

      {activeScenarioId && (
        <div className="ps-scenario-membership">
          {inScenario ? (
            <button
              onClick={() => removeNodeOrDelete(activeScenarioId, node.id)}
            >
              Remove from scenario
            </button>
          ) : (
            <button
              onClick={() => addNodeToScenario(activeScenarioId, node.id)}
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
          <label>
            Title
            <AutoGrowTextarea
              value={node.title}
              onChange={(e) => updateNode(node.id, { title: e.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              value={node.description}
              onChange={(e) =>
                updateNode(node.id, { description: e.target.value })
              }
            />
          </label>
          <label>
            Type
            <Combobox
              value={node.type}
              options={nodeTypeCatalog.map((t) => ({
                value: t.id,
                label: t.label,
                iconUrl: nodeTypeIconUrl(t.id, nodeTypeCatalog),
                category: resolveNodeTypeDef(t.id, nodeTypeCatalog)?.category,
              }))}
              placeholder="Select or enter a node type"
              onSelect={onTypeChange}
              onCreate={(label) => {
                const newId = addNodeType(label);
                if (newId) onTypeChange(newId);
                return newId;
              }}
            />
          </label>
          {typeDef && (
            <div className="ps-node-type-summary">
              {typeIconUrl && (
                <img
                  src={typeIconUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              )}
              <div>
                <strong>{typeDef.label}</strong>
                {(typeDef.catalogSource || typeDef.category) && (
                  <span>
                    {[typeDef.catalogSource, typeDef.category]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
            </div>
          )}
          {node.type && !typeDef && <p className="ps-description-below" role="status">
            Node type definition unavailable. Saved values are retained; install its library or explicitly define the type to restore policy information.
          </p>}
          {nodeTypeDescription(node.type, nodeTypeCatalog) && (
            <div className="ps-description-below">
              <RichText
                text={nodeTypeDescription(node.type, nodeTypeCatalog)!}
              />
            </div>
          )}
          {metadataDiffers && <div className="ps-node-type-summary">
            <div>
              <p>Instance metadata differs from the supplied type defaults. Existing values are not changed automatically.</p>
              <button type="button" onClick={applyTypeMetadata}>Use type metadata</button>
            </div>
          </div>}
          {metadataError && <p className="ps-auth-selection-warning" role="alert">{metadataError}</p>}
          <label>
            {inventoryField.label}
            <input
              type="text"
              value={node.serviceTreeId}
              onChange={(e) =>
                updateNode(node.id, { serviceTreeId: e.target.value })
              }
              placeholder={inventoryField.validation === "guid" ? "GUID" : "e.g., ASSET-123"}
              maxLength={4000}
              aria-invalid={!!identityError || undefined}
              readOnly={locksServiceTree}
              title={
                typeDef && locksServiceTree
                  ? `Set automatically by node type "${typeDef.id}"`
                  : typeDef
                    ? `Catalog metadata only. Enter the ${inventoryField.label} for this instance.`
                    : undefined
              }
            />
          </label>
          {identityError && <p className="ps-auth-selection-warning" role="status">{identityError}</p>}
          <label>
            {libraries.fields.find(field => field.storage === "endpointRegex")?.label ?? "EndpointRegex"}
            <input
              type="text"
              value={node.endpointRegex}
              onChange={(e) =>
                updateNode(node.id, { endpointRegex: e.target.value })
              }
              placeholder="^https://.*$"
              readOnly={locksEndpoint}
              title={
                typeDef && locksEndpoint
                  ? `Set automatically by node type "${typeDef.id}"`
                  : typeDef
                    ? "This catalog value is a default. You can customize it for this node instance."
                    : undefined
              }
            />
          </label>

          {typeDef && <NodeTypeAuthMethods typeDef={typeDef} />}
        </>
      )}

      {tab === "privacy" && (
        <>
          {typeDef && <NodeTypeDataTypes typeDef={typeDef} />}

          {typeDef &&
            (typeDef.defaultPrivacyBoundary ||
              typeDef.geoBoundary ||
              typeDef.postSubscriptionRetention ||
              typeDef.gdprHandling) && (
              <NodeTypeSettings
                node={node}
                typeDef={typeDef}
                updateNode={updateNode}
              />
            )}

          <fieldset className="ps-edge-data">
            <legend>
              Data {activeScenario ? `(in ${activeScenario.name})` : ""}
            </legend>
            {!activeScenario ? (
              <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
                Select a scenario to manage attached data.
              </p>
            ) : !inScenario ? (
              <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
                Add this node to the scenario to attach data.
              </p>
            ) : attachedData.length === 0 ? (
              <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
                No data items attached in this scenario.
              </p>
            ) : (
              <table className="ps-edge-data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Classification</th>
                    <th>Retention</th>
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
                              d.classification, doc.catalogDefinitions, classificationDefinitions
                            )}
                          />
                        </span>
                      </td>
                      <td>
                        <select
                          value={scenarioNodeMap[d.id]}
                          onChange={(e) =>
                            changeRetention(d.id, e.target.value as Retention)
                          }
                        >
                          {[...RETENTION_TYPES]
                            .sort((a, b) =>
                              (RETENTION_LABELS[a] ?? a).localeCompare(
                                RETENTION_LABELS[b] ?? b
                              )
                            )
                            .map((r) => (
                              <option key={r} value={r}>
                                {RETENTION_LABELS[r]}
                              </option>
                            ))}
                        </select>
                        {retentionDescription(scenarioNodeMap[d.id] ?? "") && (
                          <div className="ps-description-below">
                            <RichText
                              text={retentionDescription(scenarioNodeMap[d.id])!}
                            />
                          </div>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ps-edge-data-detach"
                          title="Detach from this node"
                          onClick={() => detachItem(d.id)}
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
              {!activeScenario || !inScenario ? null : attachableData.length >
                0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    attachItem(e.target.value);
                    e.currentTarget.value = "";
                  }}
                  title={
                    nodeTypeDefFor(node, nodeTypeCatalog)
                      ? `Attach a data item accepted by ${
                          node.title || "this node"
                        }`
                      : "Attach a data item that already exists"
                  }
                >
                  <option value="">Attach existing data item…</option>
                  {[...attachableData]
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
                    : unattachedData.length === 0
                    ? "All data items are already attached."
                    : `No remaining data items are accepted by ${
                        node.title || "this node"
                      }.`}
                </span>
              )}
            </div>
          </fieldset>
        </>
      )}

      <TargetIssuesSection targetKind="node" targetId={node.id} />

      <button className="ps-danger" onClick={() => deleteNode(node.id)}>
        Delete node
      </button>
    </div>
  );
}

// Allowed auth methods are part of "General / Security" — they constrain
// how callers may authenticate to this node.
function NodeTypeAuthMethods({ typeDef }: { typeDef: NodeTypeDef }) {
  const { authenticationCatalog } = useStore();
  if (typeDef.policyStatus === "Unspecified") {
    return (
      <fieldset className="ps-edge-data ps-nodetype-info">
        <legend>Type policy ({typeDef.id})</legend>
        <p className="ps-catalog-policy-note">
          This catalog entry identifies the service, but its authentication
          policy has not been curated yet. Confirm allowed methods during
          review.
        </p>
      </fieldset>
    );
  }
  return (
    <fieldset className="ps-edge-data ps-nodetype-info">
      <legend>Type policy ({typeDef.id})</legend>
      <div className="ps-nodetype-section">
        <div className="ps-nodetype-heading">Allowed auth methods</div>
        {typeDef.allowedAuthMethods.length === 0 ? (
          <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
            None defined.
          </p>
        ) : (
          <ul className="ps-nodetype-list">
            {typeDef.allowedAuthMethods.map((a) => (
              <li key={a.id}>
                <LabelWithTooltip
                  label={
                    a.id === "*"
                      ? "Any other method"
                      : authTypeLabel(a.id, authenticationCatalog)
                  }
                  description={
                    a.id === "*"
                      ? "Fallback for any auth method not explicitly listed."
                      : authTypeDescription(a.id, authenticationCatalog)
                  }
                />
                <span
                  className={
                    a.status === "Allowed"
                      ? "ps-policy-pill ok"
                      : "ps-policy-pill warn"
                  }
                >
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

// Allowed data types are part of "Privacy" — they constrain what
// classifications may be attached to this node.
function NodeTypeDataTypes({ typeDef }: { typeDef: NodeTypeDef }) {
  const { doc, classificationDefinitions } = useStore();
  if (typeDef.policyStatus === "Unspecified") {
    return (
      <fieldset className="ps-edge-data ps-nodetype-info">
        <legend>Type policy ({typeDef.id})</legend>
        <p className="ps-catalog-policy-note">
          This catalog entry identifies the service, but its data-handling
          policy has not been curated yet. Confirm classifications and
          retention during review.
        </p>
      </fieldset>
    );
  }
  return (
    <fieldset className="ps-edge-data ps-nodetype-info">
      <legend>Type policy ({typeDef.id})</legend>
      <div className="ps-nodetype-section">
        <div className="ps-nodetype-heading">Allowed data types</div>
        {typeDef.allowedDataTypes.length === 0 ? (
          <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
            None defined.
          </p>
        ) : (
          <ul className="ps-nodetype-list">
            {typeDef.allowedDataTypes.map((rule, i) => {
              const clsLabel =
                rule.id === "*"
                  ? "Any classification"
                  : dataClassificationLabel(rule.id, doc.catalogDefinitions, classificationDefinitions);
              const clsDesc =
                rule.id === "*"
                  ? undefined
                  : dataClassificationDescription(rule.id, doc.catalogDefinitions, classificationDefinitions);
              const retLabel =
                rule.retention === "*"
                  ? "Any retention"
                  : RETENTION_LABELS[rule.retention] ?? rule.retention;
              const retDesc =
                rule.retention === "*"
                  ? undefined
                  : retentionDescription(rule.retention);
              return (
                <li key={`${rule.id}|${rule.retention}|${i}`}>
                  <span>
                    <LabelWithTooltip label={clsLabel} description={clsDesc} />
                    {" · "}
                    <LabelWithTooltip label={retLabel} description={retDesc} />
                  </span>
                  <span
                    className={
                      rule.action === "Allow"
                        ? "ps-policy-pill ok"
                        : "ps-policy-pill bad"
                    }
                  >
                    {rule.action}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

// Renders the four type-driven settings (default privacy boundary, geo
// boundary, post-subscription retention, GDPR handling). The privacy
// boundary and GDPR handling are read-only — they describe the type. Geo
// boundary and post-subscription retention support per-node overrides,
// required when the type's value defers to the caller (instanceMustSpecify)
// and optional otherwise. Hidden when the type sets none of these.
function NodeTypeSettings({
  node,
  typeDef,
  updateNode,
}: {
  node: PsNode;
  typeDef: NodeTypeDef;
  updateNode: (id: string, patch: Partial<PsNode>) => void;
}) {
  const { doc, availableCatalogDefinitions } = useStore();
  const geoTypeDef = typeDef.geoBoundary
    ? GEO_BOUNDARY_SETTING_DEF_MAP[typeDef.geoBoundary.id]
    : undefined;
  const geoTypeDefers = !!geoTypeDef?.instanceMustSpecify;
  const retentionTypeDef = typeDef.postSubscriptionRetention
    ? POST_SUBSCRIPTION_RETENTION_DEF_MAP[
        typeDef.postSubscriptionRetention.id
      ]
    : undefined;
  const retentionTypeDefers = !!retentionTypeDef?.instanceMustSpecify;

  // Variants the instance can pick. We exclude any variant flagged
  // instanceMustSpecify — those are "type defers to caller" markers, not
  // actual concrete behaviors.
  const geoOverrideOptions = GEO_BOUNDARY_SETTING_DEFS.filter(
    (d) => !d.instanceMustSpecify
  );
  const retentionOverrideOptions = POST_SUBSCRIPTION_RETENTION_DEFS.filter(
    (d) => !d.instanceMustSpecify
  );

  const setGeoOverrideId = (id: string) => {
    if (id === "") {
      updateNode(node.id, { geoBoundary: undefined });
      return;
    }
    let next: GeoBoundarySetting;
    if (id === "DataKeptInGeoUnlessCustomerAllowsXGeo") {
      const prevDesc =
        node.geoBoundary?.id === "DataKeptInGeoUnlessCustomerAllowsXGeo"
          ? node.geoBoundary.description
          : "";
      next = {
        id: "DataKeptInGeoUnlessCustomerAllowsXGeo",
        description: prevDesc,
      };
    } else if (id === "DataKeptInGeo") {
      next = { id: "DataKeptInGeo" };
    } else if (id === "DataNotKeptInGeo") {
      next = { id: "DataNotKeptInGeo" };
    } else {
      return;
    }
    updateNode(node.id, { geoBoundary: next });
  };

  const setGeoOverrideDescription = (desc: string) => {
    if (node.geoBoundary?.id !== "DataKeptInGeoUnlessCustomerAllowsXGeo") return;
    updateNode(node.id, {
      geoBoundary: {
        id: "DataKeptInGeoUnlessCustomerAllowsXGeo",
        description: desc,
      },
    });
  };

  const setRetentionOverrideId = (id: string) => {
    if (id === "") {
      updateNode(node.id, { postSubscriptionRetention: undefined });
      return;
    }
    let next: PostSubscriptionRetention;
    if (id === "RetainedDaysRange") {
      const prev =
        node.postSubscriptionRetention?.id === "RetainedDaysRange"
          ? node.postSubscriptionRetention
          : { minDays: 0, maxDays: 0 };
      next = {
        id: "RetainedDaysRange",
        minDays: prev.minDays,
        maxDays: prev.maxDays,
      };
    } else {
      return;
    }
    updateNode(node.id, { postSubscriptionRetention: next });
  };

  const setRetentionDays = (which: "minDays" | "maxDays", value: number) => {
    if (node.postSubscriptionRetention?.id !== "RetainedDaysRange") return;
    const next = { ...node.postSubscriptionRetention, [which]: value };
    updateNode(node.id, { postSubscriptionRetention: next });
  };

  // Effective values are what the analyzer would see: instance override if
  // present, else type value. Used purely for display.
  const effectiveGeo = node.geoBoundary ?? typeDef.geoBoundary;
  const effectiveRetention =
    node.postSubscriptionRetention ?? typeDef.postSubscriptionRetention;

  return (
    <fieldset className="ps-edge-data ps-nodetype-info">
      <legend>Type-driven settings</legend>

      {typeDef.defaultPrivacyBoundary && (
        <div className="ps-nodetype-section">
          <div className="ps-nodetype-heading">Default privacy boundary</div>
          <div
            className="ps-readonly-classification"
            title="Set by the node type"
          >
            <LabelWithTooltip
              label={privacyBoundaryTypeLabel(typeDef.defaultPrivacyBoundary, doc.catalogDefinitions, availableCatalogDefinitions)}
              description={privacyBoundaryTypeDescription(
                typeDef.defaultPrivacyBoundary, doc.catalogDefinitions, availableCatalogDefinitions
              )}
            />
          </div>
        </div>
      )}

      {typeDef.geoBoundary && (
        <div className="ps-nodetype-section">
          <div className="ps-nodetype-heading">Geo boundary</div>
          <div className="ps-nodetype-effective">
            <span className="ps-nodetype-source">
              {node.geoBoundary ? "Override:" : "From type:"}
            </span>{" "}
            {geoTypeDefers && !node.geoBoundary ? (
              <span className="ps-nodetype-required">
                Required — pick a concrete value
              </span>
            ) : (
              <span>{formatGeoBoundary(effectiveGeo)}</span>
            )}
          </div>
          <select
            value={node.geoBoundary?.id ?? ""}
            onChange={(e) => setGeoOverrideId(e.target.value)}
            title={
              geoTypeDefers
                ? "Type defers to caller; choose a concrete value here"
                : "Override the type's default geo boundary"
            }
          >
            <option value="">
              {geoTypeDefers
                ? "(no value — required)"
                : `(from type — ${formatGeoBoundary(typeDef.geoBoundary)})`}
            </option>
            {[...geoOverrideOptions]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
          </select>
          {(() => {
            // Show the description of whichever option is reflected by the
            // select — either the override the user picked, or, when no
            // override is set and the type isn't deferring, the type's value.
            const selectedId =
              node.geoBoundary?.id ??
              (geoTypeDefers ? "" : typeDef.geoBoundary?.id ?? "");
            const desc = selectedId
              ? geoBoundarySettingDescription(selectedId)
              : undefined;
            return desc ? (
              <div className="ps-description-below">
                <RichText text={desc} />
              </div>
            ) : null;
          })()}
          {node.geoBoundary?.id === "DataKeptInGeoUnlessCustomerAllowsXGeo" && (
            <input
              type="text"
              placeholder="Describe the specific controls exposed to the customer"
              value={node.geoBoundary.description}
              onChange={(e) => setGeoOverrideDescription(e.target.value)}
              className="ps-nodetype-param"
            />
          )}
        </div>
      )}

      {typeDef.postSubscriptionRetention && (
        <div className="ps-nodetype-section">
          <div className="ps-nodetype-heading">
            Post-subscription data retention
          </div>
          <div className="ps-nodetype-effective">
            <span className="ps-nodetype-source">
              {node.postSubscriptionRetention ? "Override:" : "From type:"}
            </span>{" "}
            {retentionTypeDefers && !node.postSubscriptionRetention ? (
              <span className="ps-nodetype-required">
                Required — pick a concrete value
              </span>
            ) : (
              <span>{formatPostSubscriptionRetention(effectiveRetention)}</span>
            )}
          </div>
          <select
            value={node.postSubscriptionRetention?.id ?? ""}
            onChange={(e) => setRetentionOverrideId(e.target.value)}
            title={
              retentionTypeDefers
                ? "Type defers to caller; choose a concrete value here"
                : "Override the type's default retention"
            }
          >
            <option value="">
              {retentionTypeDefers
                ? "(no value — required)"
                : `(from type — ${formatPostSubscriptionRetention(typeDef.postSubscriptionRetention)})`}
            </option>
            {[...retentionOverrideOptions]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
          </select>
          {(() => {
            const selectedId =
              node.postSubscriptionRetention?.id ??
              (retentionTypeDefers
                ? ""
                : typeDef.postSubscriptionRetention?.id ?? "");
            const desc = selectedId
              ? postSubscriptionRetentionDescription(selectedId)
              : undefined;
            return desc ? (
              <div className="ps-description-below">
                <RichText text={desc} />
              </div>
            ) : null;
          })()}
          {node.postSubscriptionRetention?.id === "RetainedDaysRange" && (
            <div className="ps-nodetype-day-range">
              <label>
                Min days
                <input
                  type="number"
                  min={0}
                  value={node.postSubscriptionRetention.minDays}
                  onChange={(e) =>
                    setRetentionDays(
                      "minDays",
                      Math.max(0, Math.floor(Number(e.target.value) || 0))
                    )
                  }
                />
              </label>
              <label>
                Max days
                <input
                  type="number"
                  min={0}
                  value={node.postSubscriptionRetention.maxDays}
                  onChange={(e) =>
                    setRetentionDays(
                      "maxDays",
                      Math.max(0, Math.floor(Number(e.target.value) || 0))
                    )
                  }
                />
              </label>
            </div>
          )}
        </div>
      )}

      {typeDef.gdprHandling && (
        <div className="ps-nodetype-section">
          <div className="ps-nodetype-heading">GDPR handling</div>
          <div
            className="ps-readonly-classification"
            title="Set by the node type"
          >
            <LabelWithTooltip
              label={formatGdprHandling(typeDef.gdprHandling)}
              description={gdprHandlingDescription(typeDef.gdprHandling.id)}
            />
          </div>
        </div>
      )}
    </fieldset>
  );
}
