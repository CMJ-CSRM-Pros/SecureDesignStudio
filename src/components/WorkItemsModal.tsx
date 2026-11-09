import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "../store";
import { safeNavigationHref } from "../urlSafety";
import { AdoClient, adoAuthenticationConfigured, adoConnectionAllowed, destinationKey, type AdoConfiguration } from "../adoClient";
import {
  ADO_CONFIG_KEY, ADO_LOCK_NAME, configurationSummary, effectiveReceipt,
  readSubmissionJournal, submissionEligible, submitWorkBatch, workItemEligibility, workQueueCounts,
  type BatchResult, type WorkEligibility,
} from "../workSubmission";
import type { PsWorkItem } from "../types";
import { ADO_MAX_REQUEST_BYTES, AdoRequestError, WORK_ITEM_SEVERITIES, WORK_ITEM_TYPES, isWorkItemSeverity, isWorkItemType, parseAdoConfigurationJson } from "../../shared/adoContract";
import { prepareAdoWorkExport, createAdoWorkCsv } from "../adoExport";
import { createAdoWorkWorkbook, FINDINGS_WORKBOOK_MIME } from "../findingsExport";
import { downloadBlob } from "../reportExport";

const EMPTY_CONFIG = {
  organizationUrl: "", project: "",
  inventoryId: "", reviewer: "",
  descriptionField: "System.Description",
  defaults: { "System.Tags": "SecureDesignStudio" },
};
const ELIGIBILITY_HELP: Record<WorkEligibility, string> = {
  eligible: "Selected for new ADO export/submission. Required fields are checked before exporting or submitting.",
  pending: "Not selected: Pending review. Choose Accept after reviewing this work.",
  rejected: "Not selected: Rejected.",
  linked: "Not selected: Link is populated, so this work is treated as already tracked.",
  recorded: "Not selected: an ADO result is recorded or needs reconciliation. Export will not recreate this work.",
};

function loadProfile() {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(ADO_CONFIG_KEY);
    const config = raw ? parseAdoConfigurationJson(raw) : null;
    return {
      config, error: "",
      draft: JSON.stringify(config ?? EMPTY_CONFIG, null, 2),
    };
  } catch (cause) {
    return {
      config: null, draft: raw ?? JSON.stringify(EMPTY_CONFIG, null, 2),
      error: `Saved ADO configuration could not be loaded; stored data was not overwritten. ${cause instanceof AdoRequestError ? cause.message : "Review the JSON and save the configuration again."}`,
    };
  }
}

export function WorkItemsModal({
  onClose, embedded = false,
}: { onClose?: () => void; embedded?: boolean }) {
  const { doc, documentSessionId, createWorkItem, updateWorkItem, deleteWorkItem, getCurrentWorkItem } = useStore();
  const panelId = useId();
  const close = onClose ?? (() => undefined);
  const [profile] = useState(loadProfile);
  const [config, setConfig] = useState<AdoConfiguration | null>(profile.config);
  const [draft, setDraft] = useState(profile.draft);
  const [savedDraft, setSavedDraft] = useState(profile.draft);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configNotice, setConfigNotice] = useState("");
  const configFileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(profile.error);
  const [exportFeedback, setExportFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const exportFeedbackRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [batchSize, setBatchSize] = useState(0);
  const [journalState, setJournalState] = useState(() => {
    try { return { journal: readSubmissionJournal(window.localStorage), error: "" }; }
    catch { return { journal: {}, error: "The ADO submission journal is unavailable or invalid. Submission is blocked; preserve browser data for recovery." }; }
  });
  const clientRef = useRef<AdoClient | null>(null);
  const busyRef = useRef(false);
  const sessionRef = useRef(documentSessionId);
  sessionRef.current = documentSessionId;
  const networkAllowed = adoConnectionAllowed();
  const authenticationConfigured = adoAuthenticationConfigured();
  const accepted = doc.workItems.filter(item => submissionEligible(item, journalState.journal));
  const queueCounts = workQueueCounts(doc.workItems, journalState.journal);
  const configurationPending = loadingConfig || draft !== savedDraft;

  useEffect(() => {
    setResults([]);
    setBatchSize(0);
    setError(config ? "" : profile.error);
  }, [documentSessionId, profile.error, config]);

  useEffect(() => { setExportFeedback(null); }, [documentSessionId, doc.workItems, config, draft]);

  useEffect(() => {
    if (exportFeedback?.kind !== "error") return;
    exportFeedbackRef.current?.focus({ preventScroll: true });
    exportFeedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [exportFeedback]);

  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, embedded]);

  const refreshJournal = () => {
    try { setJournalState({ journal: readSubmissionJournal(window.localStorage), error: "" }); }
    catch { setJournalState(previous => ({ ...previous, error: "The submission journal could not be read. Further submission is blocked; preserve browser data for recovery." })); }
  };

  const saveConfig = () => {
    try {
      const next = parseAdoConfigurationJson(draft);
      const encoded = JSON.stringify(next);
      window.localStorage.setItem(ADO_CONFIG_KEY, encoded);
      if (window.localStorage.getItem(ADO_CONFIG_KEY) !== encoded) throw new Error("ADO configuration could not be saved.");
      setConfig(next);
      const formatted = JSON.stringify(next, null, 2);
      setDraft(formatted);
      setSavedDraft(formatted);
      clientRef.current = null;
      setConnected(false);
      setError("");
      setConfigNotice("Configuration saved for this browser. No sign-in or submission was performed.");
    } catch (cause) {
      setConfigNotice("");
      setError(cause instanceof Error ? cause.message : "ADO configuration could not be saved.");
    }
  };

  const loadConfigFile = async (file: File) => {
    setLoadingConfig(true);
    setConfigNotice("");
    try {
      if (file.size > ADO_MAX_REQUEST_BYTES) throw new AdoRequestError("Configuration JSON must not exceed 500,000 UTF-8 bytes.");
      const next = parseAdoConfigurationJson(await file.text());
      setDraft(JSON.stringify(next, null, 2));
      setError("");
      setConfigNotice("JSON loaded into the editor. Save ADO configuration to apply it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The JSON configuration file could not be loaded.");
    } finally {
      setLoadingConfig(false);
    }
  };

  const downloadConfig = (owner: Document) => {
    try {
      const next = parseAdoConfigurationJson(draft);
      downloadBlob(new Blob([JSON.stringify(next, null, 2) + "\n"], { type: "application/json" }),
        "secure-design-studio-ado-config.json", owner);
      setError("");
      setConfigNotice(draft === savedDraft ? "Configuration JSON downloaded." : "JSON downloaded. Save ADO configuration to apply these settings in SDS.");
    } catch (cause) {
      setConfigNotice("");
      setError(cause instanceof Error ? cause.message : "The configuration JSON could not be downloaded.");
    }
  };

  const exportAdo = (format: "csv" | "xlsx", owner: Document) => {
    try {
      if (configurationPending) throw new Error("Save the configuration JSON before exporting for ADO.");
      if (!config) throw new Error("Save the complete ADO configuration JSON before exporting for import.");
      const journal = readSubmissionJournal(window.localStorage);
      setJournalState({ journal, error: "" });
      const prepared = prepareAdoWorkExport(doc.workItems, config, journal);
      const content = format === "csv" ? createAdoWorkCsv(prepared)
        : Uint8Array.from(createAdoWorkWorkbook(prepared)).buffer;
      downloadBlob(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : FINDINGS_WORKBOOK_MIME }),
        `secure-design-studio-ado-import.${format}`, owner);
      setError("");
      setExportFeedback({
        kind: "success",
        message: `${format === "csv" ? "CSV" : "Excel"} export prepared for ${prepared.workIds.length} work item(s). Check your browser downloads. Nothing was submitted to ADO.`,
      });
    } catch (cause) {
      setExportFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "The ADO import export could not be prepared." });
    }
  };

  const connect = async (owner: Document) => {
    if (configurationPending) {
      setError("Save the configuration JSON before connecting to ADO.");
      return;
    }
    if (!config || busyRef.current || !networkAllowed || !authenticationConfigured) return;
    if (owner !== document) {
      setError("Dock or float the inspector in the main SDS window before connecting to ADO.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setConnected(false);
    try {
      const client = new AdoClient(config);
      await client.signIn();
      clientRef.current = client;
      setConnected(true);
    } catch (cause) {
      clientRef.current = null;
      setError(cause instanceof Error ? cause.message : "ADO sign-in failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submit = async (owner: Document) => {
    if (configurationPending) {
      setError("Save the configuration JSON before submitting to ADO.");
      return;
    }
    const client = clientRef.current;
    if (!config || !client || busyRef.current || !networkAllowed || journalState.error) return;
    if (!navigator.locks) {
      setError("This browser cannot safely coordinate ADO submission between tabs. Use a browser with Web Locks support.");
      return;
    }
    if (!(owner.defaultView ?? window).confirm(
      `Create ${accepted.length} accepted work item(s) in ${configurationSummary(config)}? This sends their names, descriptions and configured defaults to ADO. Creation cannot be undone in SDS.`,
    )) return;
    busyRef.current = true;
    setBusy(true);
    setResults([]);
    setBatchSize(accepted.length);
    setError("");
    const session = documentSessionId;
    const expected = new Map(doc.workItems.map(item => [item.id, item]));
    const isCurrent = (item: PsWorkItem) =>
      sessionRef.current === session && getCurrentWorkItem(item.id) === expected.get(item.id);
    try {
      await navigator.locks.request(ADO_LOCK_NAME, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("Another SDS tab is submitting to ADO. Wait for its result before retrying.");
        await submitWorkBatch({
          items: doc.workItems, destination: destinationKey(config), client,
          storage: window.localStorage, isCurrent,
          onReceipt: (item, receipt) => {
            if (isCurrent(item)) {
              updateWorkItem(item.id, {
                submission: receipt,
                ...(receipt.status === "submitted" && receipt.url ? { link: receipt.url } : {}),
              });
              const next = getCurrentWorkItem(item.id);
              if (next) expected.set(item.id, next);
            }
            if (receipt.status !== "submitting" && sessionRef.current === session) {
              setResults(previous => [...previous, { workId: item.id, title: item.title ?? "", receipt }]);
            }
          },
        });
      });
    } catch (cause) {
      if (sessionRef.current === session) setError(cause instanceof Error ? cause.message : "ADO submission stopped. Review saved results before retrying.");
    } finally {
      refreshJournal();
      busyRef.current = false;
      setBusy(false);
    }
  };

  return <div className={embedded ? "ps-inspector-asset-panel" : "ps-modal-overlay"}
    onMouseDown={embedded ? undefined : close}>
    <div className={embedded ? "ps-inspector-asset-content" : "ps-modal"} onMouseDown={event => event.stopPropagation()}
      role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="Security work items">
      <header className="ps-modal-header">
        <h2>Security work items</h2>
        {!embedded && <button className="ps-modal-close" aria-label="Close" onClick={close}>Close</button>}
      </header>
      <p className="ps-modal-help">Name the work, describe it, choose Bug or Task and its severity, then Accept or Reject it. Work Item Type and Severity are required for both types; Weakness Type is optional and may be blank. Accept queues work; only Submit creates ADO items.</p>
      <details className="ps-work-config">
        <summary>ADO configuration</summary>
        <p id={`${panelId}-config-help`}>One complete JSON object contains the destination, Inventory ID, Reviewer and field defaults. Paste it here or load the same JSON file. Save applies it to this browser profile; it is not shared with the model. No tenant ID, client ID, PAT or secret belongs here.</p>
        <fieldset disabled={busy || loadingConfig}>
          <legend>Complete configuration</legend>
          <div className="ps-work-field">
            <label htmlFor={`${panelId}-config`}>ADO configuration (JSON)</label>
            <textarea id={`${panelId}-config`} className="ps-work-config-json" rows={16} value={draft} spellCheck={false}
              aria-describedby={`${panelId}-config-help`}
              onChange={event => { setDraft(event.target.value); setConfigNotice(""); setError(""); }} />
          </div>
          <div className="ps-work-actions">
            <button type="button" onClick={() => configFileRef.current?.click()}>Load JSON file</button>
            <input ref={configFileRef} type="file" accept=".json,application/json" hidden aria-label="Load ADO configuration JSON"
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void loadConfigFile(file);
              }} />
            <button type="button" onClick={saveConfig}>Save ADO configuration</button>
            <button type="button" onClick={event => downloadConfig(event.currentTarget.ownerDocument)}>Download JSON</button>
          </div>
          <p>Use organizationUrl, project, inventoryId, reviewer, descriptionField and a defaults object with ADO field references. Area and iteration paths must start with project; use a single backslash separator (escaped in JSON). Inventory ID sets inventory tags, not Team ID. Reviewer is separate from Assigned To.</p>
          <p>Work Item Type, Weakness Type and Severity belong on each finding/Work item. Legacy global values are ignored and removed on save, not copied onto unrelated work. Risk Rating, Priority, Blocked and RootCause are no longer used. Existing unclassified work must be reviewed before export or submission.</p>
          {loadingConfig && <p role="status">Loading configuration JSON...</p>}
          {configNotice && <p role="status">{configNotice}</p>}
        </fieldset>
      </details>
      {draft !== savedDraft && <p role="status" className="ps-modal-help">Unsaved configuration JSON. Save ADO configuration before connecting, submitting or exporting for ADO; the previous saved settings have not changed.</p>}
      <p className="ps-modal-help">{config ? `Saved destination: ${configurationSummary(config)}` : "No ADO destination configured."}</p>
      {config && <p className="ps-modal-help">Inventory ID: {config.inventoryId ?? "not configured"}; Reviewer: {config.reviewer ?? "not configured"}.</p>}
      {!networkAllowed && <p className="ps-modal-help">ADO sign-in and submission are disabled in ordinary local/offline mode. Author and export work here; use npm run dev:ado with an administrator-configured registration, or a configured hosted HTTPS SDS page, to connect.</p>}
      {networkAllowed && __PS_LOCAL_ONLY__ && <p className="ps-modal-help">Connected local ADO mode: Microsoft sign-in and explicit ADO submission are enabled. Collaboration and AI remain disabled. Accept alone does not send work.</p>}
      {networkAllowed && !authenticationConfigured && <p role="alert" className="ps-assistant-error">Azure DevOps sign-in is not configured for this deployment. Contact the SDS administrator. You can still author and export work.</p>}
      {networkAllowed && authenticationConfigured && <p className="ps-modal-help">{connected
        ? "Connected to Azure DevOps. Submission uses your ADO permissions."
        : "Connect to Azure DevOps to sign in with Microsoft. Your existing Microsoft session may be reused; consent or MFA may still be required."}</p>}
      {journalState.error && <p role="alert" className="ps-assistant-error">{journalState.error}</p>}
      {error && <p role="alert" className="ps-assistant-error">{error}</p>}
      <div className="ps-work-list">
        {doc.workItems.length === 0 && <p className="ps-empty">No work items yet.</p>}
        {doc.workItems.map((item, index) => {
          const receipt = effectiveReceipt(item, journalState.journal);
          const eligibility = workItemEligibility(item, journalState.journal);
          const locked = busy || Boolean(receipt && receipt.status !== "failed");
          const safe = safeNavigationHref(item.link);
          return <section className="ps-work-card" key={item.id} aria-label={`Work item ${index + 1}`}>
            <div className="ps-work-field">
              <label htmlFor={`${panelId}-name-${index}`}>Name</label>
              <input id={`${panelId}-name-${index}`} type="text" value={item.title ?? ""} maxLength={255} disabled={locked}
                onChange={event => updateWorkItem(item.id, { title: event.target.value })} />
            </div>
            <div className="ps-work-field">
              <label htmlFor={`${panelId}-description-${index}`}>Description</label>
              <textarea id={`${panelId}-description-${index}`} rows={3} value={item.description} disabled={locked}
                placeholder="What needs to be done"
                onChange={event => updateWorkItem(item.id, { description: event.target.value })} />
            </div>
            <div className="ps-work-field">
              <label htmlFor={`${panelId}-type-${index}`}>Work item type</label>
              <select id={`${panelId}-type-${index}`} value={item.workItemType ?? ""} disabled={locked}
                onChange={event => {
                  const type = event.target.value;
                  if (type === "" || isWorkItemType(type)) updateWorkItem(item.id, { workItemType: type || undefined });
                }}>
                <option value="">Not set (required)</option>
                {WORK_ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="ps-work-field">
              <label htmlFor={`${panelId}-severity-${index}`}>Severity</label>
              <select id={`${panelId}-severity-${index}`} value={item.severity ?? ""} disabled={locked}
                onChange={event => {
                  const severity = event.target.value;
                  if (severity === "" || isWorkItemSeverity(severity)) {
                    updateWorkItem(item.id, { severity: severity || undefined });
                  }
                }}>
                <option value="">Not set (required)</option>
                {WORK_ITEM_SEVERITIES.map(severity => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </div>
            <div className="ps-work-field">
              <label htmlFor={`${panelId}-weakness-${index}`}>Weakness Type</label>
              <input id={`${panelId}-weakness-${index}`} type="text" value={item.weaknessType ?? ""} disabled={locked}
                placeholder="Optional (blank allowed)"
                onChange={event => updateWorkItem(item.id, { weaknessType: event.target.value || undefined })} />
            </div>
            <div className="ps-work-field">
              <label htmlFor={`${panelId}-decision-${index}`}>Submission decision</label>
              <select id={`${panelId}-decision-${index}`} value={item.decision ?? "pending"} disabled={locked}
              onChange={event => {
                const decision = event.target.value;
                if (decision === "pending" || decision === "accepted" || decision === "rejected") updateWorkItem(item.id, { decision });
              }}>
              <option value="pending">Pending review</option><option value="accepted">Accept</option><option value="rejected">Reject</option>
              </select>
            </div>
            <div className="ps-work-field">
              <label htmlFor={`${panelId}-link-${index}`}>Link</label>
              <input id={`${panelId}-link-${index}`} type="url" value={item.link} placeholder="https://..." disabled={locked}
                aria-describedby={`${panelId}-link-help-${index}`}
                onChange={event => updateWorkItem(item.id, { link: event.target.value })} />
              <p id={`${panelId}-link-help-${index}`} className="ps-modal-help">URL of an existing external work item or tracker record, not the ADO destination. Leave blank for new work. Any value excludes this item from new-item ADO export/submission.</p>
            </div>
            <p className="ps-modal-help">{ELIGIBILITY_HELP[eligibility]}</p>
            {item.link.trim() && (safe
              ? <a href={safe} target="_blank" rel="noopener noreferrer">Open tracker link</a>
              : <span>Unsafe or incomplete link; navigation blocked.</span>)}
            {receipt && <p role="status">Submission: {receipt.status}{receipt.adoId ? ` (ADO ${receipt.adoId})` : ""}.
              {receipt.status === "submitting" || receipt.status === "unknown"
                ? " Creation may have succeeded. Check ADO before further action; automatic retry is blocked." : ""}
              {receipt.error ? ` ${receipt.error}` : ""}
              {receipt.url && safeNavigationHref(receipt.url) && !item.link &&
                <> <a href={safeNavigationHref(receipt.url)!} target="_blank" rel="noopener noreferrer">Open recorded ADO result</a></>}
            </p>}
            {receipt && JSON.stringify(receipt) !== JSON.stringify(item.submission) &&
              <button type="button" disabled={busy} onClick={() => updateWorkItem(item.id, {
                submission: receipt,
                ...(receipt.status === "submitted" && receipt.url ? { link: receipt.url } : {}),
              })}>Keep recorded result in model</button>}
            <div className="ps-data-actions"><button type="button" className="ps-danger" disabled={busy}
              aria-label={`Delete work item ${index + 1}`} onClick={event => {
                if ((event.currentTarget.ownerDocument.defaultView ?? window).confirm("Delete this SDS work item? This does not delete any external ADO item or submission journal.")) deleteWorkItem(item.id);
              }}>Delete</button></div>
          </section>;
        })}
      </div>
      <p role="status" aria-label="ADO work selection" className="ps-modal-help">
        {journalState.error ? "ADO selection cannot be verified because the submission journal is unavailable."
          : `${queueCounts.eligible} selected for new ADO items; ${queueCounts.pending} pending review; ${queueCounts.rejected} rejected; ${queueCounts.linked} linked; ${queueCounts.recorded} recorded or uncertain ADO results.`}
      </p>
      {configurationPending && <p className="ps-modal-help">ADO exports are disabled until the configuration JSON has finished loading and is saved.</p>}
      <footer className="ps-modal-footer ps-work-actions">
        <button type="button" disabled={busy} onClick={() => createWorkItem()}>+ Add work item</button>
        <button type="button" disabled={busy || configurationPending} onClick={event => exportAdo("csv", event.currentTarget.ownerDocument)}>Export ADO CSV</button>
        <button type="button" disabled={busy || configurationPending} onClick={event => exportAdo("xlsx", event.currentTarget.ownerDocument)}>Export ADO Excel template</button>
        <button type="button" disabled={busy || configurationPending || !config || !networkAllowed || !authenticationConfigured}
          onClick={event => void connect(event.currentTarget.ownerDocument)}>{connected ? "Reconnect to Azure DevOps" : "Connect to Azure DevOps"}</button>
        <button type="button" disabled={busy || configurationPending || !connected || !accepted.length || !networkAllowed || Boolean(journalState.error)}
          onClick={event => void submit(event.currentTarget.ownerDocument)}>
          {busy ? "ADO operation in progress..." : `Submit accepted (${accepted.length})`}
        </button>
        {!embedded && <button onClick={close}>Close</button>}
      </footer>
      {exportFeedback && <div ref={exportFeedbackRef} tabIndex={-1}
        role={exportFeedback.kind === "error" ? "alert" : "status"} aria-label="ADO export result"
        className={`ps-work-export-feedback ${exportFeedback.kind === "error" ? "ps-assistant-error" : "ps-modal-help"}`}>
        {exportFeedback.message}
      </div>}
      <p className="ps-modal-help">ADO exports are offline files for accepted, unlinked work (up to 1,000 items), not submissions. Import the CSV in the saved ADO project and review its validation results before saving. The Excel template retains blank generated columns and the configured assignee for reference; the creation CSV omits ID, Created Date, State and Assigned To. After import, record the created tracker links in SDS to prevent duplicates. The inspector-wide Excel export remains a complete review snapshot.</p>
      <p className="ps-modal-help">Only one collaborator should submit. This browser prevents repeated creation for recorded work IDs, but cannot coordinate other browsers. Undo cannot undo ADO creation. Use Keep recorded result in model when recovering a journal result, then export all inspector data (.xlsx) to include saved results.</p>
      {results.length > 0 && <div role="status" className="ps-work-summary">
        <h3>Submission summary</h3>
        <p>{results.filter(result => result.receipt.status === "submitted").length} submitted; {results.filter(result => result.receipt.status === "failed").length} failed; {results.filter(result => result.receipt.status === "unknown").length} unknown; {Math.max(0, batchSize - results.length)} not attempted.</p>
        <ul>{results.map(result => <li key={result.receipt.operationId}>{result.title}: {result.receipt.status}
          {result.receipt.url && safeNavigationHref(result.receipt.url) &&
            <> - <a href={safeNavigationHref(result.receipt.url)!} target="_blank" rel="noopener noreferrer">ADO {result.receipt.adoId}</a></>}
        </li>)}</ul>
      </div>}
    </div>
  </div>;
}
