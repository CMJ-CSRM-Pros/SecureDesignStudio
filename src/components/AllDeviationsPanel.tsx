import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import {
  deviationKindLabel,
  catalogDefinitionChoices,
  type DeviationKind,
  type PsDeviation,
} from "../types";

type StatusFilter = "all" | "active" | "resolved";

interface Draft {
  key: string;
  kind: DeviationKind;
  title: string;
  description: string;
  explanation: string;
  evidenceIds: string;
}

const EMPTY_DRAFT: Draft = {
  key: "",
  kind: "other",
  title: "",
  description: "",
  explanation: "",
  evidenceIds: "",
};

function evidenceIds(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function AllDeviationsPanel() {
  const {
    doc,
    availableCatalogDefinitions,
    addDeviation,
    updateDeviation,
    setActiveScenarioId,
    setSelection,
    setFocusTarget,
  } = useStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [textFilter, setTextFilter] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => {
    const active = doc.deviations.filter((item) => item.status === "Active").length;
    return {
      active,
      resolved: doc.deviations.length - active,
      total: doc.deviations.length,
    };
  }, [doc.deviations]);

  const items = useMemo(() => {
    const query = textFilter.trim().toLowerCase();
    return doc.deviations
      .filter((item) => {
        if (statusFilter === "active" && item.status !== "Active") return false;
        if (statusFilter === "resolved" && item.status !== "Resolved") return false;
        if (!query) return true;
        return [
          item.key,
          item.title,
          item.description,
          item.explanation,
          ...item.evidenceIds,
          ...(item.sampleCalls ?? []).flatMap((call) => [
            call.source,
            call.destination,
            String(call.count),
          ]),
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [doc.deviations, statusFilter, textFilter]);

  const createDeviation = () => {
    try {
      addDeviation({
        ...draft,
        description: draft.description.trim(),
        evidenceIds: evidenceIds(draft.evidenceIds),
        status: "Active",
        scenarioIds: [],
      });
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create deviation.");
    }
  };

  return (
    <div className="ps-allcomments ps-deviations">
      <header className="ps-allcomments-header">
        <h3>Deviations</h3>
        <button type="button" onClick={() => setAdding((value) => !value)}>
          {adding ? "Cancel" : "Add deviation"}
        </button>
      </header>

      {adding && (
        <div className="ps-deviation-create">
          <DeviationFields draft={draft} setDraft={setDraft} />
          <button type="button" onClick={createDeviation}>
            Create deviation
          </button>
        </div>
      )}

      {error && (
        <p className="ps-deviation-error" role="alert">
          {error}
        </p>
      )}

      <div className="ps-allcomments-filterbar">
        <div className="ps-allcomments-status-tabs" role="tablist">
          <FilterPill
            label={`All (${counts.total})`}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <FilterPill
            label={`Active (${counts.active})`}
            active={statusFilter === "active"}
            onClick={() => setStatusFilter("active")}
          />
          <FilterPill
            label={`Resolved (${counts.resolved})`}
            active={statusFilter === "resolved"}
            onClick={() => setStatusFilter("resolved")}
          />
        </div>
        <input
          type="search"
          placeholder="Search deviations…"
          value={textFilter}
          onChange={(event) => setTextFilter(event.target.value)}
        />
      </div>

      <div className="ps-allcomments-body">
        {items.length === 0 ? (
          <p className="ps-empty">No deviations match.</p>
        ) : (
          items.map((deviation) => (
            <DeviationRow
              key={deviation.id}
              deviation={deviation}
              onUpdate={(explanation) =>
                updateDeviation(deviation.id, { explanation })
              }
              onNavigate={
                deviation.targetKind && deviation.targetId
                  ? () => {
                      const scenarioId = deviation.scenarioIds.find((id) =>
                        doc.scenarios.some((scenario) => scenario.id === id),
                      );
                      if (scenarioId) setActiveScenarioId(scenarioId);
                      const target = {
                        kind: deviation.targetKind!,
                        id: deviation.targetId!,
                      };
                      setSelection(target);
                      setFocusTarget(target);
                    }
                  : undefined
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function DeviationRow({
  deviation,
  onUpdate,
  onNavigate,
}: {
  deviation: PsDeviation;
  onUpdate: (explanation: string) => void;
  onNavigate?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { doc, availableCatalogDefinitions } = useStore();
  const [error, setError] = useState("");
  const [explanation, setExplanation] = useState(deviation.explanation);
  const [showSampleCalls, setShowSampleCalls] = useState(false);
  const sampleCallsButtonRef = useRef<HTMLButtonElement>(null);

  const save = () => {
    try {
      onUpdate(explanation);
      setEditing(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save deviation.");
    }
  };

  const openEditor = () => {
    setExplanation(deviation.explanation);
    setError("");
    setEditing(true);
  };

  const cancelEditor = () => {
    setExplanation(deviation.explanation);
    setError("");
    setEditing(false);
  };

  const closeSampleCalls = () => {
    setShowSampleCalls(false);
    requestAnimationFrame(() => sampleCallsButtonRef.current?.focus());
  };

  return (
    <article
      className={`ps-allcomments-row ps-deviation-row${
        deviation.status === "Resolved" ? " ps-allcomments-resolved" : ""
      }`}
    >
      {editing ? (
        <>
          <div className="ps-deviation-fields">
            <label>
              Explanation <span aria-hidden="true">*</span>
              <textarea
                required
                rows={3}
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
              />
            </label>
          </div>
          {error && (
            <p className="ps-deviation-error" role="alert">
              {error}
            </p>
          )}
          <div className="ps-deviation-actions">
            <button type="button" onClick={save}>Save</button>
            <button type="button" onClick={cancelEditor}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="ps-allcomments-row-head">
            <span className="ps-deviation-kind">{deviationKindLabel(deviation.kind, doc.catalogDefinitions, availableCatalogDefinitions)}</span>
            <span className="ps-allcomments-scenario">{deviation.status}</span>
          </div>
          <strong className="ps-deviation-title">{deviation.title}</strong>
          {deviation.description && <p>{deviation.description}</p>}
          <p className="ps-deviation-explanation">
            <strong>Explanation:</strong> {deviation.explanation}
          </p>
          <div className="ps-deviation-actions">
            {onNavigate && <button type="button" onClick={onNavigate}>View target</button>}
            {deviation.kind === "network-endpoint" &&
              deviation.sampleCalls &&
              deviation.sampleCalls.length > 0 && (
                <button
                  ref={sampleCallsButtonRef}
                  type="button"
                  onClick={() => setShowSampleCalls(true)}
                >
                  View sample calls
                </button>
              )}
            <button type="button" onClick={openEditor}>Explain</button>
          </div>
          {showSampleCalls && deviation.sampleCalls && (
            <SampleCallsDialog deviation={deviation} onClose={closeSampleCalls} />
          )}
        </>
      )}
    </article>
  );
}

function SampleCallsDialog({
  deviation,
  onClose,
}: {
  deviation: PsDeviation;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ps-modal-overlay ps-fluent-dialog-overlay">
      <div
        ref={dialogRef}
        className="ps-modal ps-fluent-dialog ps-deviation-sample-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`ps-deviation-samples-${deviation.id}`}
        onKeyDown={onDialogKeyDown}
      >
        <header className="ps-modal-header">
          <h2 id={`ps-deviation-samples-${deviation.id}`}>Sample calls</h2>
          <button
            ref={closeRef}
            type="button"
            className="ps-modal-close"
            aria-label="Close sample calls"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="ps-modal-body">
          <p>Representative observed calls for “{deviation.title}”.</p>
          <div className="ps-deviation-sample-table-wrap">
            <table className="ps-deviation-sample-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Destination</th>
                  <th scope="col">Observed count</th>
                </tr>
              </thead>
              <tbody>
                {deviation.sampleCalls?.map((call, index) => (
                  <tr key={`${call.source}\u0000${call.destination}\u0000${index}`}>
                    <td>{call.source}</td>
                    <td>{call.destination}</td>
                    <td>{call.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="ps-modal-footer ps-dialog-actions">
          <button type="button" className="ps-modal-primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeviationFields({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
}) {
  const { doc, availableCatalogDefinitions } = useStore();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="ps-deviation-fields">
      <label>
        Stable key
        <input value={draft.key} onChange={(event) => set("key", event.target.value)} />
      </label>
      <label>
        Kind
        <select
          value={draft.kind}
          onChange={(event) => set("kind", event.target.value as DeviationKind)}
        >
          {catalogDefinitionChoices("deviation", doc.catalogDefinitions, availableCatalogDefinitions).map((definition) => (
            <option key={definition.id} value={definition.id}>{definition.label}</option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input value={draft.title} onChange={(event) => set("title", event.target.value)} />
      </label>
      <label>
        Evidence details
        <textarea
          rows={3}
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </label>
      <label>
        Explanation <span aria-hidden="true">*</span>
        <textarea
          required
          rows={3}
          value={draft.explanation}
          onChange={(event) => set("explanation", event.target.value)}
        />
      </label>
      <label>
        Evidence IDs
        <textarea
          rows={2}
          placeholder="One per line or comma-separated"
          value={draft.evidenceIds}
          onChange={(event) => set("evidenceIds", event.target.value)}
        />
      </label>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`ps-allcomments-pill ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
