import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { useLibraries } from "../libraries/LibraryProvider";
import { AiDesignGuidanceDetails, AiDesignGuidanceEditor } from "./AiDesignGuidanceEditor";
import type { AiDesignGuidance } from "../../shared/aiDesignGuidance";
import {
  authenticationReferences,
  authenticationVersionStatus,
  builtInAuthentication,
  installedAuthentication,
  authenticationUnavailableReason,
  assertInstalledAuthenticationContracts,
  isPackageAuthenticationId,
  isKnownInstalledAuthentication,
  exportAuthenticationCatalog,
  mergeAuthenticationLibrary,
  parseAuthenticationCatalog,
  sameAuthenticationDefinition,
  uid,
  type AuthTypeDef,
  type AuthenticationCompatibility,
} from "../types";

type MethodDraft = {
  id: string; label: string; description: string; isNew: boolean;
  aiDesignGuidance?: AiDesignGuidance; baseline?: string;
};
type Confirmation = { kind: "delete" | "reset" | "resolve"; method: AuthTypeDef };
type ImportPreview = {
  fileName: string;
  data: unknown;
  libraryBefore: string;
  added: AuthTypeDef[];
  changed: { before: AuthTypeDef; after: AuthTypeDef }[];
  unchanged: number;
};

function MethodStatus({ method, inUse }: { method: AuthTypeDef; inUse: boolean }) {
  const installed = useLibraries().authentication;
  const unavailable = authenticationUnavailableReason(method, installed);
  return (
    <span className="ps-auth-statuses">
      <span>{unavailable ? "Retained definition"
        : builtInAuthentication(method.id) ? "Built-in"
          : isKnownInstalledAuthentication(method.id, installed) ? "Library-supplied"
            : installedAuthentication(method.id, installed) ? "Library-supplied · unverified" : "Custom · unverified"}</span>
      {!unavailable && isKnownInstalledAuthentication(method.id, installed) && method.behavior.productionIdentity === "unknown" && <span>Unverified</span>}
      {method.legacy && <span>Legacy</span>}
      {method.disabled && <span>Disabled</span>}
      {inUse && <span>In use in this diagram</span>}
      {unavailable && <span>Unavailable for new selections</span>}
    </span>
  );
}

function DefinitionText({ method }: { method?: AuthTypeDef }) {
  if (!method) return <p>Definition unavailable.</p>;
  return (
    <dl className="ps-auth-definition">
      <dt>Method</dt>
      <dd>{method.label}</dd>
      <dt>Description</dt>
      <dd>{method.description}</dd>
      <dt>AI design guidance</dt>
      <dd><AiDesignGuidanceDetails value={method.aiDesignGuidance} /></dd>
    </dl>
  );
}

function AffectedAuthenticationItems({ compatibility }: { compatibility: AuthenticationCompatibility }) {
  return (
    <details className="ps-auth-affected">
      <summary>Affected items</summary>
      <p>Unique totals — Authentication methods: {compatibility.counts.methods}; flows: {compatibility.counts.flows}; node-type policies: {compatibility.counts.nodeTypePolicies}.</p>
      <p>Whole diagram, including inactive scenarios, flows with no scenario, and saved node-type policies even if no nodes use them. Unused library methods and wildcard-only rules are excluded. A flow or policy may appear under more than one method; totals count each once.</p>
      {compatibility.methods.map(method => (
        <section key={method.id} className="ps-auth-affected-method" aria-label={`${method.label} (${method.id})`}>
          <h4>{method.label} <code>({method.id})</code></h4>
          {method.flows.length ? (
            <>
              <p><strong>Flows ({method.flows.length})</strong></p>
              <ul>{method.flows.map(flow => (
                <li key={flow.id}>
                  <strong>{flow.title}</strong> <code>({flow.id})</code>
                  <p>{flow.source.label} <code>({flow.source.id})</code> → {flow.target.label} <code>({flow.target.id})</code></p>
                  {flow.scenarios.length ? (
                    <p>Scenarios: {flow.scenarios.map((scenario, index) => (
                      <span key={scenario.id}>{index > 0 && "; "}{scenario.label} <code>({scenario.id})</code></span>
                    ))}</p>
                  ) : <p>No scenario (unassigned flow)</p>}
                </li>
              ))}</ul>
            </>
          ) : <p><strong>Node-type policy only</strong> — no flow references this method.</p>}
          {method.nodeTypePolicies.length > 0 && (
            <>
              <p><strong>Node-type policies ({method.nodeTypePolicies.length})</strong></p>
              <ul>{method.nodeTypePolicies.map(policy => (
                <li key={policy.id}>
                  <strong>{policy.label}</strong> <code>({policy.id})</code>
                  <p>Allowed authentication methods (<code>allowedAuthMethods</code>): {policy.statuses.join(", ")}</p>
                </li>
              ))}</ul>
            </>
          )}
        </section>
      ))}
    </details>
  );
}

function DefinitionComparison({
  before,
  after,
  beforeTitle,
  afterTitle,
}: {
  before?: AuthTypeDef;
  after?: AuthTypeDef;
  beforeTitle: string;
  afterTitle: string;
}) {
  const otherChanges = before && after ? [
    before.shortLabel !== after.shortLabel && "short display label",
    before.disabled !== after.disabled && "enabled/disabled status",
    JSON.stringify(before.behavior) !== JSON.stringify(after.behavior) && "analysis behavior",
    before.legacy !== after.legacy && "legacy status",
    JSON.stringify(before.aliases) !== JSON.stringify(after.aliases) && "compatibility aliases",
  ].filter(Boolean) : [];
  return (
    <>
      <div className="ps-auth-comparison">
        <section aria-label={beforeTitle}>
          <h4>{beforeTitle}</h4>
          <DefinitionText method={before} />
        </section>
        <section aria-label={afterTitle}>
          <h4>{afterTitle}</h4>
          <DefinitionText method={after} />
        </section>
      </div>
      {otherChanges.length > 0 && (
        <p>Other definition differences: {otherChanges.join(", ")}.</p>
      )}
    </>
  );
}

export function AuthenticationLibraryModal({ onClose }: { onClose: () => void }) {
  const installed = useLibraries().authentication;
  const {
    doc, authenticationLibrary, authenticationCatalog, authenticationWarnings, authenticationCompatibility,
    authenticationStorageError, saveAuthenticationMethod,
    setAuthenticationMethodDisabled, deleteAuthenticationMethod,
    resetAuthenticationMethod, importAuthenticationCatalog,
    useLibraryAuthenticationDefinition, undo, redo, canUndo, canRedo,
  } = useStore();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MethodDraft | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmUpdates, setConfirmUpdates] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const methodRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const warningsRef = useRef<HTMLHeadingElement>(null);
  const compatibilityRef = useRef<HTMLHeadingElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const importRequestRef = useRef(0);

  const references = useMemo(() => authenticationReferences(doc), [doc]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return authenticationLibrary.filter(method =>
      `${method.label}\n${method.description}`.toLocaleLowerCase().includes(needle),
    ).sort((a, b) => a.label.localeCompare(b.label));
  }, [authenticationLibrary, query]);
  const selected = filtered.find(method => method.id === selectedId) ?? filtered[0];
  const definitionReviews = useMemo(() => [...new Set([
    ...references,
    ...(doc.authenticationDefinitions ?? []).filter(method => authenticationUnavailableReason(method, installed)).map(method => method.id),
  ])].flatMap(id => {
    const saved = doc.authenticationDefinitions?.find(method => method.id === id);
    const local = authenticationLibrary.find(method => method.id === id);
    const missing = !saved && !installedAuthentication(id, installed);
    const unavailable = authenticationCatalog.find(method => method.id === id)?.unavailableReason;
    if (!unavailable && !missing && (!saved || (local && sameAuthenticationDefinition(saved, local)))) return [];
    return [{ id, saved, local, label: saved?.label ?? local?.label ?? id }];
  }), [doc.authenticationDefinitions, authenticationLibrary, authenticationCatalog, installed, references]);
  const versionStatus = authenticationCompatibility
    ? authenticationVersionStatus(__PS_VERSION__, authenticationCompatibility.minimumVersion) : null;

  const layer = confirmation ? "confirmation" : preview ? "import" : readingFile ? "reading" : draft ? "draft" : "browse";
  const pending = layer !== "browse";
  const libraryChanged = !!preview && preview.libraryBefore !== exportAuthenticationCatalog(authenticationLibrary);
  const selectedBuiltIn = selected && installedAuthentication(selected.id, installed);
  const selectedUnavailable = selected && authenticationUnavailableReason(selected, installed);
  const presentationChanged = !!selected && !!selectedBuiltIn && (
    selected.label !== selectedBuiltIn.label ||
    selected.description !== selectedBuiltIn.description ||
    selected.shortLabel !== selectedBuiltIn.shortLabel ||
    JSON.stringify(selected.aiDesignGuidance) !== JSON.stringify(selectedBuiltIn.aiDesignGuidance)
  );

  useLayoutEffect(() => {
    const target = layer === "draft" ? methodRef.current
      : layer !== "browse" ? cancelRef.current
      : returnRef.current?.isConnected ? returnRef.current : warningsRef.current ?? compatibilityRef.current ?? searchRef.current;
    target?.focus();
  }, [layer]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    const keepFocusInside = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        dialog.focus();
      }
    };
    const input = importRef.current;
    const restoreImportFocus = () => importButtonRef.current?.focus();
    input?.addEventListener("cancel", restoreImportFocus);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      importRequestRef.current++;
      input?.removeEventListener("cancel", restoreImportFocus);
      document.removeEventListener("focusin", keepFocusInside);
    };
  }, []);

  const act = (action: () => void, success: string) => {
    setError(null);
    setNotice("");
    try {
      action();
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const cancelTop = () => {
    setError(null);
    if (confirmation) setConfirmation(null);
    else if (preview) { setPreview(null); setConfirmUpdates(false); }
    else if (readingFile) { importRequestRef.current++; setReadingFile(false); }
    else if (draft) setDraft(null);
    else onClose();
  };

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancelTop();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (["s", "n", "o"].includes(key)) event.preventDefault();
      const editing = event.target instanceof HTMLElement &&
        !!event.target.closest("input, textarea, [contenteditable='true']");
      if (!editing && (key === "z" || key === "y")) {
        event.preventDefault();
        if (!pending) {
          if (key === "y" || event.shiftKey) {
            if (canRedo) act(redo, "");
          } else if (canUndo) act(undo, "");
        }
      }
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])",
    ) ?? []).filter(element => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); dialogRef.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); first.focus();
    }
  };

  const startDraft = (method?: AuthTypeDef) => {
    returnRef.current = document.activeElement as HTMLElement;
    setError(null);
    setNotice("");
    setDraft({
      id: method?.id ?? uid("auth"), label: method?.label ?? "",
      description: method?.description ?? "", isNew: !method,
      aiDesignGuidance: method?.aiDesignGuidance ? structuredClone(method.aiDesignGuidance) : undefined,
      baseline: method ? JSON.stringify(method) : undefined,
    });
  };

  const requestConfirmation = (kind: Confirmation["kind"], method: AuthTypeDef) => {
    returnRef.current = document.activeElement as HTMLElement;
    setError(null);
    setNotice("");
    setConfirmation({ kind, method });
  };

  const chooseImport = () => {
    returnRef.current = document.activeElement as HTMLElement;
    importRef.current?.click();
  };

  const readImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const request = ++importRequestRef.current;
    setReadingFile(true);
    setError(null);
    setNotice("");
    try {
      const content = await file.text();
      if (request !== importRequestRef.current) return;
      const data: unknown = JSON.parse(content);
      const methods = parseAuthenticationCatalog(data, installed);
      assertInstalledAuthenticationContracts(methods, installed);
      mergeAuthenticationLibrary(authenticationLibrary, methods, installed);
      const added: AuthTypeDef[] = [];
      const changed: ImportPreview["changed"] = [];
      let unchanged = 0;
      for (const method of methods) {
        const before = authenticationLibrary.find(current => current.id === method.id);
        if (!before) added.push(method);
        else if (!sameAuthenticationDefinition(before, method)) changed.push({ before, after: method });
        else unchanged++;
      }
      setPreview({
        fileName: file.name, data, libraryBefore: exportAuthenticationCatalog(authenticationLibrary),
        added, changed, unchanged,
      });
      setConfirmUpdates(false);
    } catch (cause) {
      if (request === importRequestRef.current) {
        setError(`Import not applied: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    } finally {
      if (request === importRequestRef.current) setReadingFile(false);
    }
  };

  const applyImport = () => {
    if (!preview || (preview.changed.length > 0 && !confirmUpdates)) return;
    if (libraryChanged) {
      setError("Your library changed after this preview. Cancel and choose the file again to review the current changes.");
      return;
    }
    if (act(() => importAuthenticationCatalog(preview.data), "Catalog imported into this browser profile. Review any remaining diagram warnings below.")) {
      setPreview(null);
      setConfirmUpdates(false);
    }
  };

  const exportLibrary = () => act(() => {
    const url = URL.createObjectURL(new Blob(
      [exportAuthenticationCatalog(authenticationLibrary)], { type: "application/json" },
    ));
    const anchor = document.createElement("a");
    try {
      anchor.href = url;
      anchor.download = "secure-design-studio-authentication-catalog.json";
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }, "Catalog download requested. Repository source JSON was not changed.");

  const confirmAction = () => {
    if (!confirmation) return;
    const { kind, method } = confirmation;
    if (act(() => {
      if (kind === "delete") deleteAuthenticationMethod(method.id);
      else if (kind === "reset") resetAuthenticationMethod(method.id);
      else {
        const current = authenticationLibrary.find(entry => entry.id === method.id);
        if (!current || !sameAuthenticationDefinition(current, method)) {
          throw new Error("The library definition changed. Cancel and review it again before replacing the diagram definition.");
        }
        useLibraryAuthenticationDefinition(method.id);
      }
    }, kind === "resolve" ? "Library definition applied to this diagram. Undo restores its previous definition."
      : kind === "delete" ? "Method deleted from this browser profile." : "Supplied presentation reset.")) {
      setConfirmation(null);
    }
  };

  const confirmationTitle = confirmation?.kind === "delete" ? "Delete authentication method?"
    : confirmation?.kind === "reset" ? (builtInAuthentication(confirmation.method.id) ? "Reset built-in presentation?" : "Reset supplied presentation?")
    : "Use library definition in this diagram?";
  const confirmationAction = confirmation?.kind === "delete" ? "Delete method"
    : confirmation?.kind === "reset" ? "Reset presentation"
    : "Use library definition in this diagram";

  return (
    <div className="ps-modal-overlay ps-fluent-dialog-overlay">
      <div
        ref={dialogRef}
        className="ps-modal ps-auth-library"
        role={confirmation ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={confirmation ? "ps-auth-confirm-title" : "ps-auth-library-title"}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <header className="ps-modal-header">
          <h2 id="ps-auth-library-title">Authentication Library</h2>
          <button
            type="button" className="ps-modal-close"
            aria-label={pending ? "Cancel current authentication operation" : "Close Authentication Library"}
            onClick={cancelTop}
          >×</button>
        </header>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={readImport} />
        <div className="ps-modal-body ps-auth-library-body">
          {authenticationStorageError && <div className="ps-auth-error" role="alert">{authenticationStorageError}</div>}
          {error && <div ref={errorRef} className="ps-auth-error" role="alert" tabIndex={-1}>{error}</div>}
          {notice && <p className="ps-auth-notice" role="status">{notice}</p>}
          {confirmation ? (
            <section>
              <h3 id="ps-auth-confirm-title">{confirmationTitle}</h3>
              {confirmation.kind === "resolve" ? (
                <>
                  <p>This explicitly replaces the saved definition in the current diagram only. Existing selections keep their identity, but their meaning and analysis can change. Your profile library and other saved files are not changed. This action is undoable.</p>
                  <DefinitionComparison
                    before={doc.authenticationDefinitions?.find(method => method.id === confirmation.method.id)}
                    after={confirmation.method} beforeTitle="Current diagram (read-only)" afterTitle="Library replacement (read-only)"
                  />
                </>
              ) : (
                <>
                  <DefinitionText method={confirmation.method} />
                  <p>{confirmation.kind === "delete"
                    ? "Delete this custom method from your browser profile? Methods used by a flow, node policy, or undo/redo history cannot be deleted. Disable the method instead if it must remain available for existing models. Other saved files are never rewritten."
                    : "Restore the supplied Method, Description, short display label, and AI design guidance. The method keeps its enabled/disabled setting. Matching definitions in this diagram follow the reset; different saved definitions remain unchanged."}</p>
                </>
              )}
            </section>
          ) : preview ? (
            <section>
              <h3>Preview authentication catalog import</h3>
              <p className="ps-auth-file-name">{preview.fileName}</p>
              <p>{preview.added.length} new · {preview.changed.length} updated · {preview.unchanged} unchanged methods</p>
              <p>Nothing has been applied. This merges into the one library in this browser profile. Matching IDs are deliberately updated, not duplicated. Different or missing diagram definitions stay unchanged until you explicitly resolve them.</p>
              {preview.added.map(method => (
                <section className="ps-auth-preview-entry" key={method.id}>
                  <h4>New method: {method.label}</h4>
                  <MethodStatus method={method} inUse={references.has(method.id)} />
                  <DefinitionText method={method} />
                </section>
              ))}
              {preview.changed.map(({ before, after }) => (
                <section className="ps-auth-preview-entry" key={after.id}>
                  <h4>Update existing method: {before.label}</h4>
                  <p>Same stable ID. Matching definitions in this diagram follow this update.</p>
                  <DefinitionComparison before={before} after={after} beforeTitle="Current library (read-only)" afterTitle="Imported replacement (read-only)" />
                </section>
              ))}
              {preview.changed.length > 0 && (
                <label className="ps-auth-confirm-updates">
                  <input type="checkbox" checked={confirmUpdates} onChange={event => setConfirmUpdates(event.target.checked)} />
                  <span>I confirm updating {preview.changed.length} existing method definitions with matching IDs.</span>
                </label>
              )}
              {libraryChanged && <p className="ps-auth-error" role="alert">The library has changed. Cancel and choose the file again for an updated preview.</p>}
            </section>
          ) : readingFile ? <p role="status">Reading and validating catalog… No changes have been applied.</p> : (
            <>
              <p>Manage one Authentication Library for this browser profile, shared across diagrams. Matching definitions in the current diagram follow library edits. Different or missing saved definitions remain unchanged until you explicitly resolve them.</p>
              <p>Import and export JSON files to transfer or back up this library. The browser cannot write repository source JSON. Diagram-only definitions are not automatically added to your profile.</p>
              {authenticationWarnings.length > 0 && (
                <section className="ps-auth-warnings" aria-labelledby="ps-auth-warnings-title">
                  <h3 ref={warningsRef} id="ps-auth-warnings-title" tabIndex={-1}>Diagram authentication warnings ({authenticationWarnings.length})</h3>
                  <ul>{authenticationWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
                  {definitionReviews.map(({ id, saved, local, label }) => (
                    <details key={id}>
                      <summary>Review definition: {label}</summary>
                      <DefinitionComparison before={saved} after={local} beforeTitle="Saved in this diagram (read-only)" afterTitle="This browser's library (read-only)" />
                      {authenticationCatalog.find(method => method.id === id)?.unresolved && <p>Unresolved: retained for existing selections, unavailable for new selections.</p>}
                      {authenticationCatalog.find(method => method.id === id)?.unavailableReason && <p>{authenticationCatalog.find(method => method.id === id)?.unavailableReason}</p>}
                      {local ? (
                        <button type="button" disabled={pending || !!authenticationUnavailableReason(local, installed)} onClick={() => requestConfirmation("resolve", local)}>Use library definition in this diagram</button>
                      ) : (
                        <>
                          <p>This method is not in your profile. Import its Authentication Library catalog JSON first; the diagram will not be silently adopted into the library.</p>
                          <button type="button" disabled={pending} onClick={chooseImport}>Import catalog JSON…</button>
                        </>
                      )}
                    </details>
                  ))}
                </section>
              )}
              {authenticationCompatibility && (
                <section className={`ps-auth-compatibility${versionStatus === "older" ? " ps-auth-warnings" : ""}`} aria-labelledby="ps-auth-compatibility-title">
                  <h3 ref={compatibilityRef} id="ps-auth-compatibility-title" tabIndex={-1}>
                    {versionStatus === "older"
                      ? `Compatibility warning: requires SecureDesignStudio ${authenticationCompatibility.minimumVersion} or later`
                      : versionStatus === "unknown" ? "Compatibility not determined" : "Authentication compatibility"}
                  </h3>
                  {versionStatus === "older" ? (
                    <p>This running build ({__PS_VERSION__}) is older than the minimum required for these authentication references. Open the diagram in SecureDesignStudio {authenticationCompatibility.minimumVersion} or later before editing or collaborating.</p>
                  ) : versionStatus === "unknown" ? (
                    <p>The running build version is unavailable or invalid. These authentication references require SecureDesignStudio {authenticationCompatibility.minimumVersion} or later. Check your build version before editing or collaborating.</p>
                  ) : (
                    <p>This running build ({__PS_VERSION__}) meets the minimum version ({authenticationCompatibility.minimumVersion}) for these authentication references.</p>
                  )}
                  <p>Builds before {authenticationCompatibility.minimumVersion} may not preserve these IDs and definitions. Use a compatible build when editing or collaborating, and save an editable backup as .tma. This describes file compatibility, not an authentication failure or detection of older collaborators.</p>
                  <AffectedAuthenticationItems compatibility={authenticationCompatibility} />
                </section>
              )}
              <div className="ps-auth-toolbar">
                <label>
                  Search authentication methods
                  <input ref={searchRef} type="search" value={query} disabled={!!draft} onChange={event => setQuery(event.target.value)} />
                </label>
                <div className="ps-auth-actions">
                  <button type="button" disabled={!!draft} onClick={() => startDraft()}>Add method</button>
                  <button ref={importButtonRef} type="button" disabled={!!draft} onClick={chooseImport}>Import JSON…</button>
                  <button type="button" disabled={!!draft} onClick={exportLibrary}>Export JSON</button>
                </div>
              </div>
              <p className="ps-auth-count" role="status">{filtered.length} of {authenticationLibrary.length} library methods</p>
              <div className="ps-auth-layout">
                <ul className="ps-auth-list" aria-label="Authentication methods">
                  {filtered.map(method => (
                    <li key={method.id}>
                      <button type="button" disabled={!!draft} aria-pressed={selected?.id === method.id} onClick={() => { setSelectedId(method.id); setError(null); }}>
                        <strong>{method.label}</strong>
                        <MethodStatus method={method} inUse={references.has(method.id)} />
                      </button>
                    </li>
                  ))}
                </ul>
                <section className="ps-auth-editor" aria-label={draft ? "Edit authentication method" : "Authentication method details"}>
                  {draft ? (
                    <form id="ps-auth-method-form" onSubmit={event => {
                      event.preventDefault();
                      if (act(() => {
                        const current = authenticationLibrary.find(method => method.id === draft.id);
                        if (JSON.stringify(current) !== draft.baseline) {
                          throw new Error("This authentication method changed while you were editing. Cancel and reopen the editor; no changes were applied.");
                        }
                        saveAuthenticationMethod({
                          id: draft.id, label: draft.label, description: draft.description,
                          aiDesignGuidance: draft.aiDesignGuidance,
                        });
                      }, "Method saved to this browser profile.")) {
                        setSelectedId(draft.id);
                        setQuery("");
                        setDraft(null);
                      }
                    }}>
                      <h3>{draft.isNew ? "Add authentication method" : "Edit authentication method"}</h3>
                      <label>
                        Method
                        <input ref={methodRef} required maxLength={80} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} />
                      </label>
                      <label>
                        Description
                        <textarea required maxLength={4000} rows={7} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
                      </label>
                      <p>Plain text only. Method: up to 80 characters. Description: up to 4,000 characters.</p>
                      <p>{isKnownInstalledAuthentication(draft.id, installed) ? "Supplied behavior and identity stay protected; only presentation is edited." : "Custom methods are unverified. A name or description does not establish secure authentication behavior."}</p>
                      <AiDesignGuidanceEditor value={draft.aiDesignGuidance}
                        onChange={aiDesignGuidance => setDraft({ ...draft, aiDesignGuidance })}
                        removeConfirmation="Remove AI design guidance from this draft? Save method to apply this to your profile library and matching definitions in the current diagram." />
                    </form>
                  ) : selected ? (
                    <>
                      <h3>{selected.label}</h3>
                      <MethodStatus method={selected} inUse={references.has(selected.id)} />
                      <DefinitionText method={selected} />
                      {selectedUnavailable && <p role="status">{selectedUnavailable}</p>}
                      {selected.legacy && <p>Legacy method: retained for compatibility, unavailable for new selections even when enabled.</p>}
                      {selected.disabled && <p>Disabled for new selections. Existing selections and their saved metadata are retained.</p>}
                      {!selectedBuiltIn && <p>Custom methods are unverified; their descriptions are not proof of secure behavior.</p>}
                      <div className="ps-auth-actions">
                        <button type="button" onClick={() => startDraft(selected)}>Edit method</button>
                        <button type="button" disabled={selected.disabled && !!selectedUnavailable} onClick={() => act(() => setAuthenticationMethodDisabled(selected.id, !selected.disabled), selected.disabled ? "Method enabled. Legacy methods remain unavailable for new selections." : "Method disabled for new selections; existing values are retained.")}>{selected.disabled ? "Enable method" : "Disable method"}</button>
                        {selectedBuiltIn ? (
                          <button type="button" disabled={!presentationChanged} onClick={() => requestConfirmation("reset", selected)}>
                            {builtInAuthentication(selected.id) ? "Reset built-in presentation" : "Reset supplied presentation"}
                          </button>
                        ) : (
                          <button type="button" className="ps-auth-danger" disabled={references.has(selected.id) || isPackageAuthenticationId(selected.id)} onClick={() => requestConfirmation("delete", selected)}>Delete method…</button>
                        )}
                      </div>
                      <p>Supplied and compatibility-reserved methods cannot be deleted. Methods used by flows, node policies, or undo/redo history must be disabled instead.</p>
                    </>
                  ) : <p>No methods match your search.</p>}
                </section>
              </div>
            </>
          )}
        </div>
        <footer className="ps-modal-footer ps-auth-footer">
          <div className="ps-auth-history">
            <div className="ps-auth-actions" role="group" aria-label="Library and diagram history">
              <button type="button" disabled={!canUndo || pending} onClick={() => act(undo, "")}>Undo</button>
              <button type="button" disabled={!canRedo || pending} onClick={() => act(redo, "")}>Redo</button>
            </div>
            <small>{pending ? "Finish or cancel this operation to use history." : "One shared history for library and diagram changes."}</small>
          </div>
          <div className="ps-auth-actions">
            <button ref={cancelRef} type="button" onClick={cancelTop}>{pending ? "Cancel" : "Close"}</button>
            {draft && !preview && !confirmation && !readingFile && <button type="submit" form="ps-auth-method-form" className="ps-modal-primary">Save method</button>}
            {preview && <button type="button" className="ps-modal-primary" disabled={libraryChanged || (preview.changed.length > 0 && !confirmUpdates) || preview.added.length + preview.changed.length === 0} onClick={applyImport}>Apply import</button>}
            {confirmation && <button type="button" className={confirmation.kind === "delete" ? "ps-auth-danger" : "ps-modal-primary"} onClick={confirmAction}>{confirmationAction}</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
