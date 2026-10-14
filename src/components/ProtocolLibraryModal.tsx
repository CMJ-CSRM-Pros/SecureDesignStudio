import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import {
  createCustomProtocolDefinition,
  exportProtocolCatalog,
  mergeProtocolLibrary,
  parseProtocolCatalog,
  protocolDefinitionConflicts,
  resolveProtocolLibraryConflicts,
  validateProtocolDefinition,
  type ProtocolConflictResolution,
  type ProtocolTypeDef,
} from "../protocols";

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  try { anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); }
  finally { anchor.remove(); URL.revokeObjectURL(url); }
}

export function ProtocolLibraryModal({ onClose }: { onClose: () => void }) {
  const { protocolLibrary, protocolStorageError, applyProtocolLibrary } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(protocolLibrary[0]?.id ?? null);
  const [draft, setDraft] = useState<ProtocolTypeDef | null>(null);
  const [suggestions, setSuggestions] = useState("");
  const [sources, setSources] = useState("");
  const [importValue, setImportValue] = useState<{ name: string; definitions: ProtocolTypeDef[] } | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, ProtocolConflictResolution["resolution"]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = protocolLibrary.find(profile => profile.id === selectedId) ?? protocolLibrary[0];
  const editing = draft ?? selected ?? null;
  const conflicts = useMemo(() => importValue
    ? protocolDefinitionConflicts(protocolLibrary, importValue.definitions) : [], [importValue, protocolLibrary]);
  const readyResolutions = conflicts.every(conflict => resolutions[conflict.id] !== undefined);
  const importedNext = useMemo(() => {
    if (!importValue) return null;
    try {
      if (conflicts.length) return readyResolutions ? resolveProtocolLibraryConflicts(protocolLibrary, importValue.definitions,
          conflicts.map(({ id }) => ({ id, resolution: resolutions[id] }))) : null
      const merged = mergeProtocolLibrary(protocolLibrary, importValue.definitions);
      return merged.status === "merged" ? merged.definitions : null;
    } catch { return null; }
  }, [importValue, protocolLibrary, conflicts, readyResolutions, resolutions]);

  useEffect(() => { dialogRef.current?.focus(); }, []);

  const updateDraft = (patch: Partial<ProtocolTypeDef>) => {
    if (!editing) return;
    if (!draft) beginEdit();
    setDraft({ ...editing, ...patch });
  };
  const beginEdit = () => {
    if (!selected) return;
    setDraft(structuredClone(selected));
    setSuggestions(selected.authenticationSuggestions.join(", "));
    setSources((selected.aiDesignGuidance.sources ?? []).join("\n"));
    setError(null);
    setNotice("");
  };
  const saveDraft = () => {
    if (!draft) return;
    try {
      const candidate = validateProtocolDefinition({
        ...draft,
        authenticationSuggestions: suggestions.split(",").map(value => value.trim()).filter(Boolean),
        aiDesignGuidance: {
          ...draft.aiDesignGuidance,
          sources: sources.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        },
      });
      const next = protocolLibrary.some(profile => profile.id === candidate.id)
        ? protocolLibrary.map(profile => profile.id === candidate.id ? candidate : profile)
        : [...protocolLibrary, candidate];
      applyProtocolLibrary(next, protocolLibrary);
      setSelectedId(candidate.id);
      setDraft(null);
      setNotice("Profile saved. Existing diagrams keep their portable saved definition until explicitly updated.");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const addCustom = () => {
    try {
      const profile = createCustomProtocolDefinition("Custom profile", protocolLibrary);
      setDraft(profile);
      setSelectedId(profile.id);
      setSuggestions(profile.authenticationSuggestions.join(", "));
      setSources((profile.aiDesignGuidance.sources ?? []).join("\n"));
      setError(null);
      setNotice("Complete the custom profile guidance and save it before selecting it on an edge.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const readImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const incoming = parseProtocolCatalog(JSON.parse(await file.text()));
      setImportValue({ name: file.name, definitions: incoming });
      setResolutions({});
    } catch (cause) { setError(`Import not applied: ${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { setBusy(false); }
  };
  const applyImport = () => {
    if (!importValue || !importedNext) return;
    try {
      applyProtocolLibrary(importedNext, protocolLibrary);
      setImportValue(null); setResolutions({});
      setNotice("Communication Library imported. Conflicts were resolved explicitly; diagrams were not rewritten.");
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const cancel = () => {
    if (draft && (JSON.stringify(draft) !== JSON.stringify(selected)
        || suggestions !== (selected?.authenticationSuggestions.join(", ") ?? "")
        || sources !== (selected?.aiDesignGuidance.sources ?? []).join("\n"))) {
      if (!window.confirm("Discard the unsaved communication profile edits?")) return;
    }
    onClose();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
    ) ?? [])].filter(element => element.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (!first || !last) { event.preventDefault(); dialogRef.current?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const field = (label: string, value: string, onChange: (value: string) => void, multiline = false) => (
    <label className="ps-protocol-field">{label}
      {multiline
        ? <textarea value={value} onChange={event => onChange(event.target.value)} rows={4} />
        : <input value={value} onChange={event => onChange(event.target.value)} />}
    </label>
  );

  return <div className="ps-modal-overlay ps-fluent-dialog-overlay">
    <div ref={dialogRef} className="ps-modal ps-auth-library ps-protocol-library" role="dialog"
      aria-modal="true" aria-labelledby="ps-protocol-library-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="ps-modal-header">
        <h2 id="ps-protocol-library-title">Communication Library</h2>
        <button type="button" className="ps-modal-close" aria-label="Close Communication Library" onClick={cancel}>×</button>
      </header>
      <div className="ps-modal-body">
        <p className="ps-description-below">
          Profiles are browser-profile preferences. Referenced definitions are saved into diagrams and resolve saved-first.
          A profile name or protection label is design intent, not evidence of negotiated security.
        </p>
        {protocolStorageError && <p className="ps-auth-error" role="alert">{protocolStorageError}</p>}
        <div className="ps-protocol-library-toolbar">
          <button type="button" onClick={addCustom} disabled={!!draft}>Add custom profile</button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !!draft}>Import JSON</button>
          <button type="button" onClick={() => download(exportProtocolCatalog(protocolLibrary), "secure-design-studio-protocol-catalog.json")}>Export JSON</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={readImport} />
        </div>
        <div className="ps-protocol-library-content">
          <nav aria-label="Communication profiles">
            {protocolLibrary.map(profile => <button type="button" key={profile.id}
              aria-current={profile.id === selected?.id ? "true" : undefined}
              onClick={() => { if (draft) return; setSelectedId(profile.id); setError(null); }}>
              {profile.label}{profile.disabled ? " (disabled)" : ""}
            </button>)}
          </nav>
          <section>
            {editing ? <>
              <p><strong>Stable ID:</strong> <code>{editing.id}</code> (not editable)</p>
              {field("Name", editing.label, value => updateDraft({ label: value }))}
              {field("Short graph label", editing.shortLabel, value => updateDraft({ shortLabel: value }))}
              {field("Group", editing.group, value => updateDraft({ group: value }))}
              {field("Description", editing.description, value => updateDraft({ description: value }), true)}
              {field("Protocol", editing.semantics.protocol, value => updateDraft({ semantics: { ...editing.semantics, protocol: value } }))}
              <label className="ps-protocol-field">Transport
                <select value={editing.semantics.transport}
                  onChange={event => updateDraft({ semantics: { ...editing.semantics, transport: event.target.value as ProtocolTypeDef["semantics"]["transport"] }})}>
                  {["tcp", "udp-or-tcp", "http-dependent", "unspecified", "custom"].map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="ps-protocol-field">Channel protection intent
                <select value={editing.semantics.channelProtection}
                  onChange={event => updateDraft({ semantics: { ...editing.semantics, channelProtection: event.target.value as ProtocolTypeDef["semantics"]["channelProtection"] }})}>
                  {["unspecified", "implicit-tls", "tls-upgrade", "ssh", "custom"].map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              {field("Semantics description", editing.semantics.description,
                value => updateDraft({ semantics: { ...editing.semantics, description: value } }), true)}
              {field("Advisory authentication IDs (comma separated; does not change edge authentication)",
                draft ? suggestions : editing.authenticationSuggestions.join(", "),
                value => { if (!draft) beginEdit(); setSuggestions(value); })}
              {field("AI design guidance", editing.aiDesignGuidance.content,
                value => updateDraft({ aiDesignGuidance: { ...editing.aiDesignGuidance, content: value } }), true)}
              {field("AI guidance source URLs (one URL per line)",
                draft ? sources : (editing.aiDesignGuidance.sources ?? []).join("\n"),
                value => { if (!draft) beginEdit(); setSources(value); }, true)}
              <div className="ps-protocol-library-meta">
                {field("Guidance revision", String(editing.aiDesignGuidance.revision),
                  value => updateDraft({ aiDesignGuidance: { ...editing.aiDesignGuidance, revision: Number(value) } }))}
                {field("Guidance edit date (YYYY-MM-DD)", editing.aiDesignGuidance.updatedOn,
                  value => updateDraft({ aiDesignGuidance: { ...editing.aiDesignGuidance, updatedOn: value } }))}
              </div>
              <label><input type="checkbox" checked={editing.disabled}
                onChange={event => updateDraft({ disabled: event.target.checked })} /> Disabled for new selections</label>
              <p className="ps-description-below">{editing.aiDesignGuidance.content}</p>
            </> : <p>No communication profiles.</p>}
          </section>
        </div>
        {draft && <div className="ps-modal-actions">
          <button type="button" onClick={() => setDraft(null)}>Cancel edits</button>
          <button type="button" onClick={saveDraft}>Save profile</button>
        </div>}
        {importValue && <section className="ps-protocol-import-preview" aria-label="Import preview">
          <h3>Import preview: {importValue.name}</h3>
          <p>{importValue.definitions.length} profiles; {conflicts.length} same-ID conflicts. Existing saved diagram definitions are not rewritten.</p>
          {conflicts.map(conflict => <fieldset key={conflict.id}>
            <legend>{conflict.id}: {conflict.current.label} vs {conflict.incoming.label}</legend>
            <label><input type="radio" name={`protocol-conflict-${conflict.id}`} checked={resolutions[conflict.id] === "keep-current"}
              onChange={() => setResolutions(current => ({ ...current, [conflict.id]: "keep-current" }))} /> Keep profile currently installed</label>
            <label><input type="radio" name={`protocol-conflict-${conflict.id}`} checked={resolutions[conflict.id] === "use-imported"}
              onChange={() => setResolutions(current => ({ ...current, [conflict.id]: "use-imported" }))} /> Use imported profile</label>
          </fieldset>)}
          <button type="button" onClick={() => { setImportValue(null); setResolutions({}); }}>Cancel import</button>
          <button type="button" disabled={!importedNext} onClick={applyImport}>Apply import</button>
        </section>}
        {error && <p className="ps-auth-error" role="alert">{error}</p>}
        {notice && <p className="ps-auth-notice" role="status">{notice}</p>}
      </div>
    </div>
  </div>;
}
