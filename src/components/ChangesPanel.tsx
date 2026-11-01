import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { useUiShell } from "../uiShell";
import { ChangeRow } from "./ChangeRow";
import type { ChangeCategory, ChangeItem, ChangeTarget } from "../diff";

type CategoryFilter = "all" | ChangeCategory;

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "scenario", label: "Scenarios" },
  { value: "node", label: "Nodes" },
  { value: "edge", label: "Edges" },
  { value: "boundary", label: "Boundaries" },
  { value: "annotation", label: "Text annotations" },
  { value: "data", label: "Data" },
  { value: "workItem", label: "Work Items" },
  { value: "nodeType", label: "Node Types" },
  { value: "authentication", label: "Authentication" },
  { value: "catalogDefinition", label: "Saved catalog definitions" },
  { value: "membership", label: "Membership" },
  { value: "attachment", label: "Attachments" },
];

function targetsEqual(
  a: ChangeTarget | null,
  b: ChangeTarget | null
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kind === b.kind && a.id === b.id && (a.scenarioId ?? null) === (b.scenarioId ?? null)
  );
}

export function ChangesPanel({ embedded = false }: { embedded?: boolean }) {
  const { inspectorActiveTab, inspectorPresentation, inspectorHostRef, setInspectorActiveTab } = useUiShell();
  const {
    doc,
    diffChanges,
    diffFileName,
    diffSelectedTarget,
    setDiffSelectedTarget,
    setDiffViewOpen,
    clearDiff,
    selection,
    activeScenarioId,
    setActiveScenarioId,
    setSelection,
    setFocusTarget,
  } = useStore();

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [textFilter, setTextFilter] = useState("");
  const savedScrollTopRef = useRef(0);

  useEffect(() => {
    if (!embedded || inspectorActiveTab !== "changes") return;
    const panel = inspectorHostRef.current?.querySelector<HTMLElement>("#ps-inspector-panel");
    if (!panel) return;
    const frame = requestAnimationFrame(() => {
      panel.scrollTop = savedScrollTopRef.current;
    });
    const rememberScroll = () => {
      savedScrollTopRef.current = panel.scrollTop;
    };
    panel.addEventListener("scroll", rememberScroll);
    return () => {
      cancelAnimationFrame(frame);
      panel.removeEventListener("scroll", rememberScroll);
    };
  }, [embedded, inspectorActiveTab, inspectorPresentation]);

  // Clear the highlighted change when the active selection drifts away from
  // its target. Mirrors the AllIssuesPanel "selectedIssueId" pattern but has
  // to handle scenario targets too (those don't show up in `selection`).
  useEffect(() => {
    const t = diffSelectedTarget;
    if (!t) return;
    if (t.kind === "scenario") {
      if (activeScenarioId !== t.id) setDiffSelectedTarget(null);
      return;
    }
    if (!selection || selection.kind !== t.kind || selection.id !== t.id) {
      setDiffSelectedTarget(null);
    }
  }, [selection, activeScenarioId, diffSelectedTarget, setDiffSelectedTarget]);

  const items = useMemo(() => {
    return diffChanges.filter((c) => {
      if (categoryFilter !== "all" && c.category !== categoryFilter)
        return false;
      if (textFilter.trim()) {
        const q = textFilter.trim().toLowerCase();
        if (!c.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [diffChanges, categoryFilter, textFilter]);

  const counts = useMemo(() => {
    const m = new Map<ChangeCategory, number>();
    for (const c of diffChanges) m.set(c.category, (m.get(c.category) ?? 0) + 1);
    return m;
  }, [diffChanges]);

  const navigate = (c: ChangeItem) => {
    const t = c.target;
    if (!t) return;
    // Activate scoping scenario first so per-scenario state is correct
    // when the detail pane reads it.
    if (t.scenarioId) {
      setActiveScenarioId(t.scenarioId);
    } else if (t.kind === "scenario") {
      setActiveScenarioId(t.id);
    } else if (t.kind === "edge") {
      // Edges always jump to their scenario — the row badge shows the
      // scenario / #N it was sorted under, and navigation should match.
      // Prefer the diff-generator's tagged scenario; fall back to the
      // first scenario in doc order that still contains the edge.
      const taggedExists =
        c.scenarioId &&
        doc.scenarios.some(
          (s) => s.id === c.scenarioId && s.edgeIds.includes(t.id),
        );
      const targetScenarioId =
        (taggedExists ? c.scenarioId : null) ??
        doc.scenarios.find((s) => s.edgeIds.includes(t.id))?.id ??
        null;
      if (targetScenarioId) setActiveScenarioId(targetScenarioId);
    } else if (t.kind === "node") {
      // Nodes only jump when the current scenario doesn't contain them —
      // visibility on the canvas would otherwise hide the navigation
      // target behind the scenario filter.
      const currentScenario = activeScenarioId
        ? doc.scenarios.find((s) => s.id === activeScenarioId)
        : null;
      const stillVisible =
        !currentScenario || currentScenario.nodeIds.includes(t.id);
      if (!stillVisible) {
        const next = doc.scenarios.find((s) => s.nodeIds.includes(t.id));
        if (next) setActiveScenarioId(next.id);
      }
    }
    if (t.kind === "annotation" && (!t.scenarioId ||
        !doc.scenarios.some(s => s.id === t.scenarioId && s.textAnnotationIds?.includes(t.id)))) {
      setActiveScenarioId(doc.scenarios.find(s => s.textAnnotationIds?.includes(t.id))?.id ?? null);
    }
    if (t.kind === "scenario") {
      setSelection(null);
    } else {
      setSelection({ kind: t.kind, id: t.id });
      if (t.kind === "node" || t.kind === "edge" || t.kind === "annotation" || t.kind === "boundary") {
        setFocusTarget({ kind: t.kind, id: t.id });
      }
    }
    setDiffSelectedTarget(t);
  };

  const openProperties = (c: ChangeItem) => {
    const panel = inspectorHostRef.current?.querySelector<HTMLElement>("#ps-inspector-panel");
    if (panel) savedScrollTopRef.current = panel.scrollTop;
    navigate(c);
    setInspectorActiveTab("properties");
  };

  return (
    <div className="ps-allcomments ps-allissues ps-diff-panel">
      <header className="ps-allcomments-header">
        <h3>Changes vs previous</h3>
        <button
          className="ps-diff-remove"
          title="Discard the loaded comparison (the toolbar Compare button will disappear until you load a new one)"
          onClick={event => {
            if (
              (event.currentTarget.ownerDocument.defaultView ?? window).confirm(
                "Remove the loaded comparison? You will need to re-pick the previous-version file to compare again.",
              )
            ) {
              clearDiff();
              setInspectorActiveTab("properties");
              requestAnimationFrame(() =>
                inspectorHostRef.current?.querySelector<HTMLElement>("#ps-inspector-tab-properties")?.focus(),
              );
            }
          }}
        >
          Remove comparison
        </button>
        {!embedded && (
          <button
            className="ps-allcomments-close"
            aria-label="Hide compare view"
            title="Hide this panel (comparison is preserved — reopen via Review > Changes)"
            onClick={() => setDiffViewOpen(false)}
          >
            ✕
          </button>
        )}
      </header>

      {diffFileName && (
        <p className="ps-diff-filename" title={diffFileName}>
          Previous: <strong>{diffFileName}</strong>
        </p>
      )}

      <div className="ps-allcomments-filterbar">
        <div className="ps-allcomments-status-tabs" role="tablist">
          {CATEGORY_FILTERS.map((f) => {
            const total =
              f.value === "all"
                ? diffChanges.length
                : (counts.get(f.value) ?? 0);
            if (f.value !== "all" && total === 0) return null;
            return (
              <button
                key={f.value}
                role="tab"
                aria-selected={categoryFilter === f.value}
                className={`ps-allcomments-pill ${categoryFilter === f.value ? "active" : ""}`}
                onClick={() => setCategoryFilter(f.value)}
              >
                {f.label} ({total})
              </button>
            );
          })}
        </div>
        <input
          type="search"
          placeholder="Search changes…"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
        />
      </div>

      <div className="ps-allcomments-body">
        {diffChanges.length === 0 ? (
          <p className="ps-empty">No changes between the two versions.</p>
        ) : items.length === 0 ? (
          <p className="ps-empty">No changes match the current filter.</p>
        ) : (
          items.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              selected={targetsEqual(c.target ?? null, diffSelectedTarget)}
              onNavigate={navigate}
              onOpenProperties={openProperties}
            />
          ))
        )}
      </div>
    </div>
  );
}
