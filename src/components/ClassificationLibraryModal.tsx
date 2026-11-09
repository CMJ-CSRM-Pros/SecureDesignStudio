import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { uid } from "../types";
import { useLibraries } from "../libraries/LibraryProvider";
import {
  DEFAULT_CLASSIFICATION_LIBRARY, classificationDefinitionsForLibrary,
  classificationReferencesInDocument, exportClassificationCatalog,
  mergeClassificationLibrary, parseClassificationCatalog, validateClassificationLibrary,
  type ClassificationDefinition, type ClassificationLibrary, type ClassificationPresentation,
} from "../classificationLibrary";

type Draft =
  | { kind: "entry"; before: ClassificationLibrary; id: string; label: string; description: string; isNew: boolean }
  | { kind: "settings"; before: ClassificationLibrary; name: string; revision: string; guidanceUrl: string; defaultId: string };
type Preview = {
  fileName: string; before: ClassificationLibrary; incoming: ClassificationLibrary;
  mode: "merge" | "replace"; repairRaw?: string;
};
type Confirmation = { kind: "delete" | "resolve"; id: string; before: ClassificationLibrary };

function DefinitionDetails({ definition }: { definition?: {
  id: string; label: string; description?: string; disabled?: boolean;
  presentation?: ClassificationPresentation; library?: { id: string; version: string };
} }) {
  return definition ? <dl className="ps-auth-definition">
    <dt>Stable ID</dt><dd><code>{definition.id}</code></dd>
    <dt>Name</dt><dd>{definition.label}</dd>
    <dt>Description</dt><dd>{definition.description || "(none)"}</dd>
    {definition.disabled !== undefined && <>
      <dt>Enabled for new choices</dt><dd>{definition.disabled ? "No" : "Yes"}</dd>
      <dt>Display metadata</dt><dd>{definition.presentation
        ? `${definition.presentation.color} / ${definition.presentation.foreground}; priority ${definition.presentation.priority}`
        : "Neutral / unranked"}</dd>
    </>}
    {definition.library && <><dt>Library metadata (unverified)</dt><dd>{definition.library.id} @ {definition.library.version}</dd></>}
  </dl> : <p>No saved definition.</p>;
}

function download(text: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor); anchor.click();
  } finally { anchor.remove(); URL.revokeObjectURL(url); }
}

export function ClassificationLibraryModal({ onClose }: { onClose: () => void }) {
  const libraries = useLibraries();
  const {
    doc, classificationLibrary: library, classificationLibrarySource,
    classificationStorageError, classificationRecoveryRaw, applyClassificationLibrary,
    classificationDeleteReason, deleteClassification, useLibraryClassificationDefinition,
    canUndo, canRedo, undo, redo,
  } = useStore();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reading, setReading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const references = useMemo(() => classificationReferencesInDocument(doc), [doc]);
  const definitions = useMemo(() => classificationDefinitionsForLibrary(library), [library]);
  const filtered = useMemo(() => library.classifications.filter(item =>
    `${item.id}\n${item.label}\n${item.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a, b) => a.label.localeCompare(b.label)), [library, query]);
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0];
  const selectedSaved = doc.catalogDefinitions?.find(def => def.kind === "classification" && def.id === selected?.id);
  const selectedActive = definitions.find(def => def.id === selected?.id);
  const differs = selectedSaved && selectedActive && JSON.stringify(selectedSaved) !== JSON.stringify(selectedActive);
  const deleteReason = useMemo(() => selected ? classificationDeleteReason(selected.id) : null,
    [selected?.id, classificationDeleteReason]);
  const layer = confirmation ? "confirmation" : preview ? "preview" : reading ? "reading" : draft ? "draft" : "browse";
  const pending = layer !== "browse";
  const previewResult = useMemo(() => {
    if (!preview) return null;
    try {
      const next = preview.mode === "merge"
        ? mergeClassificationLibrary(preview.before, preview.incoming)
        : validateClassificationLibrary(preview.incoming);
      const previous = new Map(preview.before.classifications.map(item => [item.id, item]));
      const following = new Map(next.classifications.map(item => [item.id, item]));
      return {
        next, error: null,
        added: next.classifications.filter(item => !previous.has(item.id)),
        changed: next.classifications.filter(item => previous.has(item.id) && JSON.stringify(previous.get(item.id)) !== JSON.stringify(item)),
        removed: preview.before.classifications.filter(item => !following.has(item.id)),
        same: exportClassificationCatalog(next) === exportClassificationCatalog(preview.before),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [preview]);
  const libraryChanged = !!preview && exportClassificationCatalog(preview.before) !== exportClassificationCatalog(library);
  const needsConfirmation = !!preview && (preview.mode === "replace"
    || (previewResult?.changed?.length ?? 0) > 0 || preview.repairRaw !== undefined);

  useLayoutEffect(() => {
    const target = layer === "draft" ? nameRef.current
      : layer !== "browse" ? cancelRef.current
      : returnRef.current?.isConnected ? returnRef.current : searchRef.current;
    target?.focus();
  }, [layer]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const trap = (event: FocusEvent) => {
      if (dialogRef.current && event.target instanceof Node && !dialogRef.current.contains(event.target)) dialogRef.current.focus();
    };
    const input = importRef.current;
    const restore = () => importButtonRef.current?.focus();
    input?.addEventListener("cancel", restore);
    document.addEventListener("focusin", trap);
    return () => {
      requestRef.current++;
      input?.removeEventListener("cancel", restore);
      document.removeEventListener("focusin", trap);
    };
  }, []);

  const act = (operation: () => void, message = "") => {
    setError(null); setNotice("");
    try { operation(); setNotice(message); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
  };
  const begin = () => {
    returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null); setNotice("");
  };
  const cancelTop = () => {
    setError(null);
    if (confirmation) setConfirmation(null);
    else if (preview) { setPreview(null); setConfirmed(false); }
    else if (reading) { requestRef.current++; setReading(false); }
    else if (draft) setDraft(null);
    else onClose();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); cancelTop(); return; }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (["s", "n", "o"].includes(key)) event.preventDefault();
      const editing = event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable='true']");
      if (!editing && ["z", "y"].includes(key)) {
        event.preventDefault();
        if (!pending) act(() => {
          if (key === "y" || event.shiftKey) { if (canRedo) redo(); }
          else if (canUndo) undo();
        });
      }
    }
    if (event.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex='-1'])",
    ) ?? [])].filter(element => element.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (!first || !last) { event.preventDefault(); dialogRef.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); first.focus();
    }
  };
  const edit = (entry?: ClassificationDefinition) => {
    begin();
    setDraft({ kind: "entry", before: library, id: entry?.id ?? uid("cls"),
      label: entry?.label ?? "", description: entry?.description ?? "", isNew: !entry });
  };
  const saveDraft = () => {
    if (!draft) return;
    if (act(() => {
      const candidate = draft.kind === "settings"
        ? { ...draft.before, name: draft.name, revision: draft.revision, guidanceUrl: draft.guidanceUrl || undefined, defaultId: draft.defaultId }
        : { ...draft.before, classifications: draft.isNew
          ? [...draft.before.classifications, { id: draft.id, label: draft.label, description: draft.description, disabled: false }]
          : draft.before.classifications.map(item => item.id === draft.id
            ? { ...item, label: draft.label, description: draft.description } : item) };
      applyClassificationLibrary(validateClassificationLibrary(candidate), draft.before);
    }, "Library saved. Existing diagram definitions are retained; review differences before adopting new labels.")) {
      if (draft.kind === "entry") setSelectedId(draft.id);
      setQuery(""); setDraft(null);
    }
  };
  const readImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    begin(); const request = ++requestRef.current;
    setReading(true);
    const before = library;
    const recovery = classificationRecoveryRaw;
    try {
      const text = await file.text();
      if (request !== requestRef.current) return;
      const incoming = parseClassificationCatalog(JSON.parse(text));
      setPreview({ fileName: file.name, before, incoming, mode: recovery !== null ? "replace" : "merge",
        ...(recovery !== null ? { repairRaw: recovery } : {}) });
      setConfirmed(false);
    } catch (cause) {
      if (request === requestRef.current) setError(`Import not applied: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { if (request === requestRef.current) setReading(false); }
  };
  const showDefaults = () => {
    begin(); setConfirmed(false);
    setPreview({ fileName: "Shipped defaults (including configured libraries)", before: library, incoming: libraries.classifications, mode: "replace",
      ...(classificationRecoveryRaw !== null ? { repairRaw: classificationRecoveryRaw } : {}) });
  };
  const applyImport = () => {
    if (!preview || !previewResult?.next || libraryChanged || (needsConfirmation && !confirmed)) return;
    if (act(() => applyClassificationLibrary(previewResult.next!, preview.before, preview.repairRaw),
      "Classification Library applied. Model IDs and saved definitions were retained.")) {
      setPreview(null); setQuery(""); setSelectedId(null); setConfirmed(false);
    }
  };
  const confirmationEntry = confirmation?.before.classifications.find(item => item.id === confirmation.id);

  return <div className="ps-modal-overlay ps-fluent-dialog-overlay">
    <div ref={dialogRef} className="ps-modal ps-auth-library ps-classification-library"
      role={confirmation ? "alertdialog" : "dialog"} aria-modal="true"
      aria-labelledby={confirmation ? "ps-classification-confirm-title" : "ps-classification-library-title"}
      tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="ps-modal-header">
        <h2 id="ps-classification-library-title">Classification Library</h2>
        <button type="button" className="ps-modal-close" aria-label={pending ? "Cancel current classification operation" : "Close Classification Library"} onClick={cancelTop}>×</button>
      </header>
      <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={readImport} />
      <div className="ps-modal-body ps-auth-library-body">
        {classificationStorageError && <p className="ps-auth-error" role="alert">{classificationStorageError}</p>}
        {error && <div ref={errorRef} tabIndex={-1} className="ps-auth-error" role="alert">{error}</div>}
        {notice && <p className="ps-auth-notice" role="status">{notice}</p>}
        {confirmation ? <section>
          <h3 id="ps-classification-confirm-title">{confirmation.kind === "delete" ? "Delete classification?" : "Use active definition in this diagram?"}</h3>
          <DefinitionDetails definition={confirmation.kind === "resolve"
            ? classificationDefinitionsForLibrary(confirmation.before).find(def => def.id === confirmation.id)
            : confirmationEntry} />
          <p>{confirmation.kind === "delete"
            ? "Only unused, non-default entries can be deleted. Current model, node-policy and Undo/Redo references are checked again. Other saved files are not rewritten; disabling is safer."
            : "Replace the saved display definition for this ID in the current diagram only. IDs, policy rules and profile settings do not change. Undo restores the previous snapshot."}</p>
          {confirmation.kind === "resolve" && <>
            <h4>Current saved definition</h4>
            <DefinitionDetails definition={doc.catalogDefinitions?.find(def => def.kind === "classification" && def.id === confirmation.id)} />
          </>}
        </section> : preview ? <section>
          <h3>Preview classification catalog import</h3>
          <p className="ps-auth-file-name">{preview.fileName}</p>
          <label>Import mode<select value={preview.mode} disabled={preview.repairRaw !== undefined}
            onChange={event => { setPreview({ ...preview, mode: event.target.value as Preview["mode"] }); setConfirmed(false); }}>
            <option value="merge">Merge into active list</option><option value="replace">Replace active list</option>
          </select></label>
          <p>Merge keeps the active library identity and default, updates matching IDs, and adds new IDs. Replace uses the incoming identity and default. Neither operation reclassifies model data or changes policy IDs.</p>
          {previewResult?.error ? <p className="ps-auth-error" role="alert">{previewResult.error} Choose a valid default first or use Replace.</p> : previewResult?.next && <>
            <p>{previewResult.added.length} added; {previewResult.changed.length} updated; {previewResult.removed.length} removed.</p>
            <p>Library: {preview.before.name} → {previewResult.next.name}. Default: <code>{preview.before.defaultId}</code> → <code>{previewResult.next.defaultId}</code>.</p>
            <p>Library ID/revision: <code>{preview.before.id} @ {preview.before.revision}</code> → <code>{previewResult.next.id} @ {previewResult.next.revision}</code>.</p>
            <p>Guidance: <code>{preview.before.guidanceUrl ?? "(none)"}</code> → <code>{previewResult.next.guidanceUrl ?? "(none)"}</code>.</p>
            <p>Existing resolved references are snapshotted before switching. Added definitions may supply display metadata for previously unresolved IDs; they do not establish security or policy acceptance.</p>
            {previewResult.added.map(item => <details key={item.id} className="ps-auth-preview-entry"><summary>Added: {item.label}</summary><DefinitionDetails definition={item} /></details>)}
            {previewResult.changed.map(item => <details key={item.id} className="ps-auth-preview-entry">
              <summary>Updated: {item.label}</summary>
              <h4>Before</h4><DefinitionDetails definition={preview.before.classifications.find(old => old.id === item.id)} />
              <h4>After</h4><DefinitionDetails definition={item} />
              <p>Display priority and colors do not change policy rules.</p>
            </details>)}
            {previewResult.removed.map(item => <p key={item.id}>Remove from active list: <strong>{item.label}</strong> <code>{item.id}</code>{references.has(item.id) ? " - referenced by this diagram; snapshot retained." : ""}</p>)}
            {needsConfirmation && <label className="ps-auth-confirm-updates">
              <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
              <span>{preview.repairRaw !== undefined
                ? "I have backed up or accept replacing the invalid stored configuration. Undo restores effective defaults, not corrupt storage bytes."
                : preview.mode === "replace" ? "I confirm replacing the active list. Existing model IDs and saved definitions are retained."
                : "I confirm updating the matching library IDs shown above."}</span>
            </label>}
          </>}
          {libraryChanged && <p className="ps-auth-error" role="alert">The active library changed. Cancel and review a new preview.</p>}
        </section> : reading ? <p role="status">Reading and validating catalog. No changes have been applied.</p> : <>
          <p><strong>{library.name}</strong> ({classificationLibrarySource}) · revision {library.revision} · default <code>{library.defaultId}</code></p>
          <p>Library edits affect authoring choices, not existing IDs or saved diagram definitions. Use an explicit diagram-definition action below to adopt changed display metadata. Preferences stay in this browser profile; repository JSON is not edited.</p>
          {classificationRecoveryRaw !== null && <button type="button" onClick={() => act(() => download(classificationRecoveryRaw, "classification-library-stored-backup.txt", "text/plain"), "Stored configuration backup requested.")}>Download stored backup</button>}
          <div className="ps-auth-toolbar">
            <label>Search classifications<input ref={searchRef} type="search" disabled={!!draft} value={query} onChange={event => setQuery(event.target.value)} /></label>
            <div className="ps-auth-actions">
              <button type="button" disabled={!!draft} onClick={() => edit()}>Add classification</button>
              <button type="button" disabled={!!draft} onClick={() => { begin(); setDraft({ kind: "settings", before: library, name: library.name, revision: library.revision, guidanceUrl: library.guidanceUrl ?? "", defaultId: library.defaultId }); }}>Library settings</button>
              <button ref={importButtonRef} type="button" disabled={!!draft} onClick={() => { begin(); importRef.current?.click(); }}>Import JSON...</button>
              <button type="button" disabled={!!draft} onClick={() => act(() => download(exportClassificationCatalog(library), "secure-design-studio-classification-catalog.json"), "Library download requested.")}>Export JSON</button>
              <button type="button" disabled={!!draft} onClick={showDefaults}>Use shipped defaults...</button>
            </div>
          </div>
          <p className="ps-auth-count" role="status">{filtered.length} of {library.classifications.length} classifications</p>
          <div className="ps-auth-layout">
            <ul className="ps-auth-list" aria-label="Classifications">{filtered.map(item => <li key={item.id}>
              <button type="button" disabled={!!draft} aria-pressed={selected?.id === item.id} onClick={() => { setSelectedId(item.id); setError(null); }}>
                <strong>{item.label}</strong><span className="ps-auth-statuses">
                  {item.id === library.defaultId && <span>Default</span>}{item.disabled && <span>Disabled</span>}{references.has(item.id) && <span>In use</span>}
                </span>
              </button>
            </li>)}</ul>
            <section className="ps-auth-editor" aria-label={draft ? "Edit Classification Library" : "Classification details"}>
              {draft ? <form id="ps-classification-form" onSubmit={event => { event.preventDefault(); saveDraft(); }}>
                <h3>{draft.kind === "settings" ? "Library settings" : draft.isNew ? "Add classification" : "Edit classification"}</h3>
                {draft.kind === "entry" ? <>
                  <label>Name<input ref={nameRef} required maxLength={160} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
                  <label>Description<textarea rows={6} maxLength={4000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
                  <p>Stable ID: <code>{draft.id}</code>. Names and descriptions are display metadata; policy IDs and any existing presentation settings stay unchanged.</p>
                </> : <>
                  <label>Library name<input ref={nameRef} required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
                  <label>Revision<input required maxLength={128} value={draft.revision} onChange={event => setDraft({ ...draft, revision: event.target.value })} /></label>
                  <label>Guidance URL<input maxLength={2048} value={draft.guidanceUrl} onChange={event => setDraft({ ...draft, guidanceUrl: event.target.value })} /></label>
                  <label>Default for new data<select value={draft.defaultId} onChange={event => setDraft({ ...draft, defaultId: event.target.value })}>
                    {draft.before.classifications.filter(item => !item.disabled).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select></label>
                  <p>Stable library ID: <code>{draft.before.id}</code>. At least one enabled classification and an enabled default are required.</p>
                </>}
              </form> : selected ? <>
                <h3>{selected.label}</h3><DefinitionDetails definition={selected} />
                <p>{selected.disabled ? "Disabled for new choices; existing references remain readable." : "Enabled for new choices."}</p>
                <div className="ps-auth-actions">
                  <button type="button" onClick={() => edit(selected)}>Edit classification</button>
                  <button type="button" disabled={selected.id === library.defaultId}
                    title={selected.id === library.defaultId ? "Choose another default first." : undefined}
                    onClick={() => act(() => applyClassificationLibrary({
                      ...library, classifications: library.classifications.map(item => item.id === selected.id ? { ...item, disabled: !item.disabled } : item),
                    }, library), selected.disabled ? "Classification enabled." : "Classification disabled; existing values retained.")}>
                    {selected.disabled ? "Enable classification" : "Disable classification"}
                  </button>
                  <button type="button" className="ps-auth-danger" disabled={!!deleteReason} title={deleteReason ?? undefined}
                    onClick={() => { begin(); setConfirmation({ kind: "delete", id: selected.id, before: library }); }}>Delete classification...</button>
                </div>
                {deleteReason && <p>{deleteReason}</p>}
                {differs && references.has(selected.id) && <section className="ps-auth-warnings">
                  <h4>Saved diagram definition differs</h4>
                  <DefinitionDetails definition={selectedSaved} />
                  <button type="button" onClick={() => { begin(); setConfirmation({ kind: "resolve", id: selected.id, before: library }); }}>Use active definition in this diagram...</button>
                </section>}
              </> : <p>No classifications match.</p>}
            </section>
          </div>
        </>}
      </div>
      <footer className="ps-modal-footer ps-auth-footer">
        <div className="ps-auth-history"><div className="ps-auth-actions" role="group" aria-label="Library and diagram history">
          <button type="button" disabled={pending || !canUndo} onClick={() => act(undo)}>Undo</button>
          <button type="button" disabled={pending || !canRedo} onClick={() => act(redo)}>Redo</button>
        </div><small>One history; profile settings are never shared with collaborators.</small></div>
        <div className="ps-auth-actions">
          <button ref={cancelRef} type="button" onClick={cancelTop}>{pending ? "Cancel" : "Close"}</button>
          {draft && !confirmation && !preview && !reading && <button type="submit" form="ps-classification-form" className="ps-modal-primary">Save changes</button>}
          {preview && <button type="button" className="ps-modal-primary"
            disabled={!previewResult?.next || libraryChanged || (needsConfirmation && !confirmed) || (previewResult?.same && preview.repairRaw === undefined)}
            onClick={applyImport}>Apply import</button>}
          {confirmation && <button type="button" className={confirmation.kind === "delete" ? "ps-auth-danger" : "ps-modal-primary"}
            onClick={() => {
              if (act(() => confirmation.kind === "delete"
                ? deleteClassification(confirmation.id, confirmation.before)
                : useLibraryClassificationDefinition(confirmation.id, confirmation.before),
              confirmation.kind === "delete" ? "Classification deleted from this profile." : "Active definition applied to this diagram. Undo restores the previous snapshot.")) {
                if (confirmation.kind === "delete") { setSelectedId(null); returnRef.current = null; }
                setConfirmation(null);
              }
            }}>{confirmation.kind === "delete" ? "Delete classification" : "Use active definition"}</button>}
        </div>
      </footer>
    </div>
  </div>;
}
