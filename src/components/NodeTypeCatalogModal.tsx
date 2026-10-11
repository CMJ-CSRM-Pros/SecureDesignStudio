import { useEffect, useMemo, useRef, useState } from "react";
import {
  GDPR_HANDLING_DEFS,
  GEO_BOUNDARY_SETTING_DEFS,
  NODE_TYPE_DEFS,
  NODE_TYPE_DEF_MAP,
  POST_SUBSCRIPTION_RETENTION_DEFS,
  useStore,
} from "../store";
import {
  RETENTION_TYPE_DEFS,
  emptyNodeTypeDefinition,
  dataClassificationLabel,
  privacyBoundaryTypeLabel,
  catalogDefinitionsFor,
  catalogDefinitionChoices,
  assertCatalogSelection,
  unresolvedAuthenticationDefinition,
  isGuid,
  resolveNodeTypeDef,
  uid,
  type AllowedAuthMethod,
  type AllowedDataType,
  type AuthenticationType,
  type DataClassification,
  type NodeTypeDefinition,
  type NodeTypeRef,
  type Retention,
} from "../types";
import { nodeTypeIconUrl, nodeTypeIconUrlForKey } from "../nodeTypeIcons";
import { classificationOptions } from "../classificationLibrary";
import { useLibraries } from "../libraries/LibraryProvider";
import { inventoryFieldFor, inventoryIdError } from "../inventoryIdentity";
import { DFD_ROLES, DFD_ROLE_LABELS, formatDfdValue, isDfdRole } from "../dfdSemantics";
import { AiDesignGuidanceEditor } from "./AiDesignGuidanceEditor";
import { validateAiDesignGuidance } from "../../shared/aiDesignGuidance";

function cloneDefinition(definition: NodeTypeDefinition): NodeTypeDefinition {
  return JSON.parse(JSON.stringify(definition)) as NodeTypeDefinition;
}

function definitionFromRef(
  ref: NodeTypeRef,
  allTypes: readonly NodeTypeRef[],
): NodeTypeDefinition {
  const effective = resolveNodeTypeDef(ref.id, allTypes);
  if (!effective) return emptyNodeTypeDefinition();
  const { id: _id, label: _label, ...definition } = effective;
  return {
    ...cloneDefinition(definition),
    catalogSource: "Document",
  };
}

function downloadText(content: string, fileName: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function NodeTypeCatalogModal({ onClose }: { onClose: () => void }) {
  const libraries = useLibraries();
  const inventoryField = inventoryFieldFor(libraries.fields);
  const {
    doc,
    nodeTypeCatalog,
    saveNodeType,
    saveNodeTypeGuidance,
    removeNodeType,
    importNodeTypeCatalog,
    exportNodeTypeCatalog,
  } = useStore();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<NodeTypeRef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const draftBaseline = useRef<string>();

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (draft) { setDraft(null); requestAnimationFrame(() => searchRef.current?.focus()); }
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [draft, onClose]);

  const filteredTypes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...nodeTypeCatalog]
      .filter((ref) => {
        if (!needle) return true;
        const def = resolveNodeTypeDef(ref.id, nodeTypeCatalog);
        return [ref.label, ref.id, def?.category, def?.catalogSource]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle));
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [nodeTypeCatalog, query]);

  const iconOptions = useMemo(() => {
    const seen = new Set<string>();
    const options = [
      { key: "generic/component.svg", label: "Generic component" },
    ];
    seen.add("generic/component.svg");
    for (const def of NODE_TYPE_DEFS) {
      if (!def.icon || seen.has(def.icon)) continue;
      seen.add(def.icon);
      options.push({ key: def.icon, label: def.label });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const edit = (ref: NodeTypeRef) => {
    draftBaseline.current = JSON.stringify(resolveNodeTypeDef(ref.id, nodeTypeCatalog));
    setDraft({
      id: ref.id,
      label: ref.label,
      definition: definitionFromRef(ref, nodeTypeCatalog),
    });
    setIsNew(false);
    setError(null);
  };

  const create = () => {
    setDraft({
      id: uid("nt"),
      label: "New node type",
      definition: emptyNodeTypeDefinition(),
    });
    setIsNew(true);
    setError(null);
  };

  const updateDefinition = (patch: Partial<NodeTypeDefinition>) => {
    setDraft((current) =>
      current?.definition
        ? {
            ...current,
            definition: { ...current.definition, ...patch },
          }
        : current,
    );
  };

  const save = () => {
    if (!draft?.definition) return;
    const id = draft.id.trim();
    const label = draft.label.trim();
    const original = resolveNodeTypeDef(draft.id, nodeTypeCatalog);
    if (!isNew && draftBaseline.current !== JSON.stringify(original)) {
      setError("This type changed while you were editing. Cancel and reopen it before saving; no changes were applied.");
      return;
    }
    if (isNew && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      setError(
        "Stable ID must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.",
      );
      return;
    }
    if (
      isNew &&
      nodeTypeCatalog.some((type) => type.id.toLowerCase() === id.toLowerCase())
    ) {
      setError("That stable ID already exists.");
      return;
    }
    if (!label) {
      setError("Label is required.");
      return;
    }
    try {
      validateAiDesignGuidance(draft.definition.aiDesignGuidance);
      assertCatalogSelection("privacyBoundary", draft.definition.defaultPrivacyBoundary,
        resolveNodeTypeDef(draft.id, nodeTypeCatalog)?.defaultPrivacyBoundary, libraries.taxonomy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Privacy boundary definition is unavailable.");
      return;
    }
    if (
      nodeTypeCatalog.some(
        (type) =>
          type.id !== draft.id &&
          type.label.trim().toLowerCase() === label.toLowerCase(),
      )
    ) {
      setError("That label is already used by another node type.");
      return;
    }
    const identityError = inventoryIdError(draft.definition.serviceTreeId, inventoryField);
    if (identityError) {
      setError(identityError);
      return;
    }
    if (draft.definition.endpointRegex.length > 1000) {
      setError("Endpoint regex must be 1000 characters or fewer.");
      return;
    }
    try {
      new RegExp(draft.definition.endpointRegex);
    } catch (cause) {
      setError(`Endpoint regex is invalid: ${(cause as Error).message}`);
      return;
    }
    if (
      draft.definition.geoBoundary?.id ===
        "DataKeptInGeoUnlessCustomerAllowsXGeo" &&
      !draft.definition.geoBoundary.description.trim()
    ) {
      setError("Cross-geo opt-in description is required.");
      return;
    }
    if (draft.definition.postSubscriptionRetention?.id === "RetainedDaysRange") {
      const { minDays, maxDays } = draft.definition.postSubscriptionRetention;
      if (
        !Number.isInteger(minDays) ||
        !Number.isInteger(maxDays) ||
        minDays < 0 ||
        maxDays < minDays
      ) {
        setError(
          "Retention days must be non-negative whole numbers with maximum greater than or equal to minimum.",
        );
        return;
      }
    }
    if (
      draft.definition.policyStatus !== "Unspecified" &&
      draft.definition.allowedDataTypes.filter(
        (rule) => rule.id === "*" && rule.retention === "*",
      ).length !== 1
    ) {
      setError("Defined data policy requires exactly one fallback rule.");
      return;
    }

    const withoutGuidance = (definition: NodeTypeDefinition) => {
      const { aiDesignGuidance, catalogSource, ...rest } = definition;
      return JSON.stringify(rest);
    };
    if (!isNew && original && original.label === label) {
      const { id: _id, label: _label, ...originalDefinition } = original;
      if (withoutGuidance(originalDefinition) === withoutGuidance(draft.definition)) {
        try {
          saveNodeTypeGuidance(id, draft.definition.aiDesignGuidance);
          setDraft(null); setIsNew(false); setError(null);
          requestAnimationFrame(() => searchRef.current?.focus());
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Guidance could not be saved.");
        }
        return;
      }
    }
    if (
      saveNodeType({
        id,
        label,
        definition: draft.definition,
      })
    ) {
      setDraft(null);
      setIsNew(false);
      setError(null);
    } else {
      setError("The definition could not be saved.");
    }
  };

  const remove = (id: string) => {
    if (!doc.nodeTypes.some(type => type.id === id)) {
      setError("This type comes from a configured library. Change the deployment package configuration to remove it.");
      return;
    }
    const result = removeNodeType(id);
    if (result === "in-use") {
      setError(null);
      setImportNotice(
        "This custom node type is used by one or more nodes. Change those nodes before deleting it.",
      );
      return;
    }
    setDraft(null);
    setIsNew(false);
  };

  const importCatalog = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const count = importNodeTypeCatalog(parsed);
      setError(null);
      setImportNotice(
        count > 0
          ? `Imported ${count} document node type${count === 1 ? "" : "s"}.`
          : "No valid document node type definitions were found.",
      );
    } catch (cause) {
      setImportNotice("");
      setError(`Catalog import failed: ${(cause as Error).message}`);
    }
  };

  return (
    <div className="ps-modal-overlay" onMouseDown={onClose}>
      <div
        className="ps-modal ps-modal-catalog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ps-node-catalog-title"
      >
        <header className="ps-modal-header">
          <h2 id="ps-node-catalog-title">Node type catalog</h2>
          <button className="ps-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ps-catalog-toolbar">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search label, ID, category, or source"
            aria-label="Search node types"
          />
          <button onClick={create}>New type</button>
          <button onClick={() => importRef.current?.click()}>
            Import catalog…
          </button>
          <button
            onClick={() => {
              try {
                downloadText(exportNodeTypeCatalog(), "secure-design-studio-node-catalog.json");
                setError(null);
              } catch (cause) { setError((cause as Error).message); }
            }}
            disabled={!doc.nodeTypes.some((type) => type.definition)}
          >
            Export custom catalog
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importCatalog(file);
              event.target.value = "";
            }}
          />
        </div>

        {error && !draft && <div className="ps-catalog-error" role="alert">{error}</div>}
        {importNotice && <p role="status">{importNotice}</p>}
        <div className="ps-catalog-layout">
          <div className="ps-catalog-list">
            {filteredTypes.map((ref) => {
              const def = resolveNodeTypeDef(ref.id, nodeTypeCatalog);
              const builtIn = NODE_TYPE_DEF_MAP[ref.id] != null;
              return (
                <button
                  key={ref.id}
                  type="button"
                  className={
                    draft?.id === ref.id ? "ps-catalog-row is-selected" : "ps-catalog-row"
                  }
                  onClick={() => edit(ref)}
                  aria-pressed={draft?.id === ref.id}
                >
                  <img
                    src={nodeTypeIconUrl(ref.id, nodeTypeCatalog)}
                    alt=""
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{ref.label}</strong>
                    <small>
                      {def?.category ?? "Custom"} ·{" "}
                      {ref.definition && !doc.nodeTypes.some(type => type.id === ref.id && type.definition)
                        ? "Configured library type"
                        : ref.definition
                        ? builtIn
                          ? "Document override"
                          : "Document type"
                        : def?.catalogSource ?? "Legacy"}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="ps-catalog-editor">
            {!draft?.definition ? (
              <div className="ps-empty">
                Select a node type to edit it, or create a new document type.
              </div>
            ) : (
              <>
                <div className="ps-catalog-editor-grid">
                  <label>
                    Label
                    <input
                      type="text"
                      value={draft.label}
                      onChange={(event) =>
                        setDraft({ ...draft, label: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Stable ID
                    <input
                      type="text"
                      value={draft.id}
                      readOnly={!isNew}
                      onChange={(event) =>
                        setDraft({ ...draft, id: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Category
                    <input
                      type="text"
                      value={draft.definition.category ?? ""}
                      onChange={(event) =>
                        updateDefinition({ category: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Default DFD role
                    <select
                      value={draft.definition.defaultDfdRole === undefined ? ""
                        : isDfdRole(draft.definition.defaultDfdRole) ? draft.definition.defaultDfdRole : "unresolved"}
                      onChange={event => updateDefinition({ defaultDfdRole: event.target.value || undefined })}
                    >
                      <option value="">Unspecified (Process fallback)</option>
                      {draft.definition.defaultDfdRole !== undefined && !isDfdRole(draft.definition.defaultDfdRole)
                        && <option value="unresolved" disabled>Unrecognized saved role</option>}
                      {DFD_ROLES.map(role => <option key={role} value={role}>{DFD_ROLE_LABELS[role]}</option>)}
                    </select>
                    {draft.definition.defaultDfdRole !== undefined && !isDfdRole(draft.definition.defaultDfdRole)
                      && <span role="status">{formatDfdValue(draft.definition.defaultDfdRole)}</span>}
                    <span>Independent of service identity. Legacy nodes keep Process until explicitly adopting this default.</span>
                  </label>
                  <label>
                    {inventoryField.label}
                    <input
                      type="text"
                      value={draft.definition.serviceTreeId}
                      onChange={(event) =>
                        updateDefinition({ serviceTreeId: event.target.value })
                      }
                      placeholder={inventoryField.validation === "guid" ? "GUID or blank" : "Inventory identifier or blank"}
                      maxLength={4000}
                    />
                  </label>
                  <label className="ps-catalog-span">
                    Endpoint regex
                    <input
                      type="text"
                      value={draft.definition.endpointRegex}
                      onChange={(event) =>
                        updateDefinition({ endpointRegex: event.target.value })
                      }
                    />
                  </label>
                  <label className="ps-catalog-span">
                    Template hints
                    <input
                      type="text"
                      value={(draft.definition.templateHints ?? []).join(", ")}
                      onChange={(event) =>
                        updateDefinition({
                          templateHints: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder=".contoso.com, /api/path"
                    />
                  </label>
                  <label className="ps-catalog-span">
                    Documentation URL
                    <input
                      type="url"
                      value={draft.definition.documentationUrl ?? ""}
                      onChange={(event) =>
                        updateDefinition({
                          documentationUrl: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="ps-catalog-span">
                    Resource providers
                    <input
                      type="text"
                      value={(draft.definition.resourceProviders ?? []).join(", ")}
                      onChange={(event) =>
                        updateDefinition({
                          resourceProviders: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label>
                    Icon
                    <select
                      value={draft.definition.icon ?? "generic/component.svg"}
                      onChange={(event) =>
                        updateDefinition({ icon: event.target.value })
                      }
                    >
                      {iconOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="ps-catalog-icon-preview" aria-hidden="true">
                    <img
                      src={nodeTypeIconUrlForKey(
                        draft.definition.icon ?? "generic/component.svg",
                      )}
                      alt=""
                    />
                  </div>
                  <label className="ps-catalog-span">
                    Description
                    <textarea
                      rows={3}
                      value={draft.definition.description ?? ""}
                      onChange={(event) =>
                        updateDefinition({ description: event.target.value })
                      }
                    />
                  </label>
                </div>

                <AiDesignGuidanceEditor value={draft.definition.aiDesignGuidance}
                  onChange={aiDesignGuidance => updateDefinition({ aiDesignGuidance })} />

                <fieldset className="ps-catalog-policy">
                  <legend>Policy</legend>
                  <label>
                    Policy status
                    <select
                      value={
                        draft.definition.policyStatus === "Unspecified"
                          ? "Unspecified"
                          : "Defined"
                      }
                      onChange={(event) => {
                        if (event.target.value === "Unspecified") {
                          updateDefinition({
                            policyStatus: "Unspecified",
                            allowedAuthMethods: [],
                            allowedDataTypes: [],
                          });
                        } else {
                          updateDefinition({
                            policyStatus: undefined,
                            allowedAuthMethods: [],
                            allowedDataTypes: [
                              { id: "*", retention: "*", action: "Deny" },
                            ],
                          });
                        }
                      }}
                    >
                      <option value="Unspecified">Unspecified</option>
                      <option value="Defined">Defined</option>
                    </select>
                  </label>

                  {draft.definition.policyStatus !== "Unspecified" && (
                    <>
                      <AuthPolicyEditor
                        value={draft.definition.allowedAuthMethods}
                        onChange={(allowedAuthMethods) =>
                          updateDefinition({ allowedAuthMethods })
                        }
                      />
                      <DataPolicyEditor
                        value={draft.definition.allowedDataTypes}
                        onChange={(allowedDataTypes) =>
                          updateDefinition({ allowedDataTypes })
                        }
                      />
                      <PrivacyPolicyEditor
                        value={draft.definition}
                        onChange={updateDefinition}
                      />
                    </>
                  )}
                </fieldset>

                {error && <div className="ps-catalog-error">{error}</div>}
                <div className="ps-catalog-editor-actions">
                  <button onClick={() => setDraft(null)}>Cancel</button>
                  {!isNew && (
                    <button
                      className="ps-danger"
                      onClick={() => remove(draft.id)}
                    >
                      {NODE_TYPE_DEF_MAP[draft.id]
                        ? "Reset built-in"
                        : "Delete type"}
                    </button>
                  )}
                  <button className="ps-modal-primary" onClick={save}>
                    Save type
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthPolicyEditor({
  value,
  onChange,
}: {
  value: AllowedAuthMethod[];
  onChange: (value: AllowedAuthMethod[]) => void;
}) {
  const { authenticationCatalog, authenticationLibrary } = useStore();
  const explicit = new Map(value.filter((rule) => rule.id !== "*").map((rule) => [rule.id, rule.status]));
  const displayedCatalog = [
    ...authenticationCatalog,
    ...[...explicit.keys()].filter(id => !authenticationCatalog.some(def => def.id === id))
      .map(id => unresolvedAuthenticationDefinition(id as AuthenticationType)),
  ];
  const wildcard = value.find((rule) => rule.id === "*")?.status ?? "";
  return (
    <div className="ps-catalog-policy-section">
      <h3>Authentication</h3>
      <label>
        Other methods
        <select
          value={wildcard}
          onChange={(event) => {
            const withoutWildcard = value.filter((rule) => rule.id !== "*");
            onChange(
              event.target.value
                ? [
                    ...withoutWildcard,
                    {
                      id: "*",
                      status: event.target.value as "Allowed" | "Deprecated",
                    },
                  ]
                : withoutWildcard,
            );
          }}
        >
          <option value="">Not accepted</option>
          <option value="Allowed">Allowed</option>
          <option value="Deprecated">Deprecated</option>
        </select>
      </label>
      <div className="ps-catalog-checkbox-grid">
        {displayedCatalog.filter(auth => !auth.unavailableReason || explicit.has(auth.id)).map((auth) => {
          const status = explicit.get(auth.id as AuthenticationType);
          return (
            <label key={auth.id}>
              <input
                type="checkbox"
                checked={status != null}
                disabled={status == null && (auth.disabled || auth.legacy || !!auth.unavailableReason || !authenticationLibrary.some(def => def.id === auth.id && !def.disabled))}
                onChange={(event) => {
                  const rest = value.filter((rule) => rule.id !== auth.id);
                  onChange(
                    event.target.checked
                      ? [...rest, { id: auth.id as AuthenticationType, status: "Allowed" }]
                      : rest,
                  );
                }}
              />
              <span>{auth.label}{auth.disabled ? " (disabled)" : ""}{auth.unavailableReason ? " (unavailable)" : ""}</span>
              {status && (
                <select
                  value={status}
                  onChange={(event) =>
                    onChange(
                      value.map((rule) =>
                        rule.id === auth.id
                          ? {
                              ...rule,
                              status: event.target.value as
                                | "Allowed"
                                | "Deprecated",
                            }
                          : rule,
                      ),
                    )
                  }
                >
                  <option value="Allowed">Allowed</option>
                  <option value="Deprecated">Deprecated</option>
                </select>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function DataPolicyEditor({
  value,
  onChange,
}: {
  value: AllowedDataType[];
  onChange: (value: AllowedDataType[]) => void;
}) {
  const { doc, classificationLibrary } = useStore();
  const fallback =
    value.find((rule) => rule.id === "*" && rule.retention === "*") ??
    ({ id: "*", retention: "*", action: "Deny" } as AllowedDataType);
  const specific = value.filter(
    (rule) => !(rule.id === "*" && rule.retention === "*"),
  );
  return (
    <div className="ps-catalog-policy-section">
      <h3>Data handling</h3>
      <label>
        Fallback action
        <select
          value={fallback.action}
          onChange={(event) =>
            onChange([
              ...specific,
              {
                id: "*",
                retention: "*",
                action: event.target.value as "Allow" | "Deny",
              },
            ])
          }
        >
          <option value="Deny">Deny</option>
          <option value="Allow">Allow</option>
        </select>
      </label>
      {specific.map((rule, index) => (
        <div className="ps-catalog-rule-row" key={`${index}-${rule.id}`}>
          <select
            aria-label={`Classification for data rule ${index + 1}`}
            value={rule.id}
            onChange={(event) => {
              const next = [...specific];
              next[index] = {
                ...rule,
                id: event.target.value as DataClassification,
              };
              onChange([...next, fallback]);
            }}
          >
            <option value="*">Any classification</option>
            {classificationOptions(classificationLibrary, doc.catalogDefinitions, rule.id).map((classification) => (
              <option key={classification.id} value={classification.id} disabled={classification.disabled}>
                {classification.label}
              </option>
            ))}
          </select>
          <select
            value={rule.retention}
            onChange={(event) => {
              const next = [...specific];
              next[index] = {
                ...rule,
                retention: event.target.value as Retention | "*",
              };
              onChange([...next, fallback]);
            }}
          >
            <option value="*">Any retention</option>
            {RETENTION_TYPE_DEFS.map((retention) => (
              <option key={retention.id} value={retention.id}>
                {retention.label}
              </option>
            ))}
          </select>
          <select
            value={rule.action}
            onChange={(event) => {
              const next = [...specific];
              next[index] = {
                ...rule,
                action: event.target.value as "Allow" | "Deny",
              };
              onChange([...next, fallback]);
            }}
          >
            <option value="Allow">Allow</option>
            <option value="Deny">Deny</option>
          </select>
          <button
            aria-label="Remove data rule"
            onClick={() =>
              onChange([
                ...specific.filter((_, ruleIndex) => ruleIndex !== index),
                fallback,
              ])
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([
            ...specific,
            {
              id: classificationLibrary.defaultId,
              retention: "*",
              action: "Allow",
            },
            fallback,
          ])
        }
      >
        Add data rule
      </button>
    </div>
  );
}

function PrivacyPolicyEditor({
  value,
  onChange,
}: {
  value: NodeTypeDefinition;
  onChange: (patch: Partial<NodeTypeDefinition>) => void;
}) {
  const { doc, availableCatalogDefinitions } = useStore();
  const privacyTypes = catalogDefinitionChoices("privacyBoundary", doc.catalogDefinitions, availableCatalogDefinitions);
  const retentionId = value.postSubscriptionRetention?.id ?? "";
  return (
    <div className="ps-catalog-policy-section">
      <h3>Privacy and retention</h3>
      <div className="ps-catalog-editor-grid">
        <label>
          Privacy boundary
          <select
            value={value.defaultPrivacyBoundary ?? ""}
            onChange={(event) =>
              onChange({
                defaultPrivacyBoundary: event.target.value || undefined,
              })
            }
          >
            <option value="">Unspecified</option>
            {value.defaultPrivacyBoundary && !privacyTypes.some((p) => p.id === value.defaultPrivacyBoundary) && (
              <option value={value.defaultPrivacyBoundary} disabled>{privacyBoundaryTypeLabel(value.defaultPrivacyBoundary, doc.catalogDefinitions)}</option>
            )}
            {privacyTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Geo behavior
          <select
            value={value.geoBoundary?.id ?? ""}
            onChange={(event) => {
              const id = event.target.value;
              onChange({
                geoBoundary:
                  id === "DataKeptInGeoUnlessCustomerAllowsXGeo"
                    ? { id, description: "" }
                    : id
                      ? ({ id } as NodeTypeDefinition["geoBoundary"])
                      : undefined,
              });
            }}
          >
            <option value="">Unspecified</option>
            {GEO_BOUNDARY_SETTING_DEFS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Post-subscription retention
          <select
            value={retentionId}
            onChange={(event) => {
              const id = event.target.value;
              onChange({
                postSubscriptionRetention:
                  id === "RetainedDaysRange"
                    ? { id, minDays: 0, maxDays: 30 }
                    : id === "ControlledByCallingService"
                      ? { id }
                      : undefined,
              });
            }}
          >
            <option value="">Unspecified</option>
            {POST_SUBSCRIPTION_RETENTION_DEFS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          GDPR handling
          <select
            value={value.gdprHandling?.id ?? ""}
            onChange={(event) =>
              onChange({
                gdprHandling: event.target.value
                  ? ({
                      id: event.target.value,
                    } as NodeTypeDefinition["gdprHandling"])
                  : undefined,
              })
            }
          >
            <option value="">Unspecified</option>
            {GDPR_HANDLING_DEFS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {value.geoBoundary?.id ===
        "DataKeptInGeoUnlessCustomerAllowsXGeo" && (
        <label>
          Cross-geo opt-in description
          <input
            type="text"
            value={value.geoBoundary.description}
            onChange={(event) =>
              onChange({
                geoBoundary: {
                  id: "DataKeptInGeoUnlessCustomerAllowsXGeo",
                  description: event.target.value,
                },
              })
            }
          />
        </label>
      )}
      {value.postSubscriptionRetention?.id === "RetainedDaysRange" && (
        <div className="ps-catalog-rule-row">
          <label>
            Minimum days
            <input
              type="number"
              min={0}
              value={value.postSubscriptionRetention.minDays}
              onChange={(event) =>
                onChange({
                  postSubscriptionRetention: {
                    id: "RetainedDaysRange",
                    minDays: Number(event.target.value),
                    maxDays:
                      value.postSubscriptionRetention?.id ===
                      "RetainedDaysRange"
                        ? value.postSubscriptionRetention.maxDays
                        : 30,
                  },
                })
              }
            />
          </label>
          <label>
            Maximum days
            <input
              type="number"
              min={0}
              value={value.postSubscriptionRetention.maxDays}
              onChange={(event) =>
                onChange({
                  postSubscriptionRetention: {
                    id: "RetainedDaysRange",
                    minDays:
                      value.postSubscriptionRetention?.id ===
                      "RetainedDaysRange"
                        ? value.postSubscriptionRetention.minDays
                        : 0,
                    maxDays: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
