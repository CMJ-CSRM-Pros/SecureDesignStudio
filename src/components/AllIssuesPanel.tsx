import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { IssueRow } from "./IssueRow";
import { AddThreatNote } from "./AddThreatNote";
import { ISSUE_NOT_EVALUATED_LABELS, type PsIssue } from "../types";

type StatusFilter = "all" | "active" | "resolved";

export function AllIssuesPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    doc,
    activeScenarioId,
    selection,
    setActiveScenarioId,
    setSelection,
    setAllIssuesViewOpen,
    setFocusTarget,
  } = useStore();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [textFilter, setTextFilter] = useState("");
  // Tracks which issue row should render in its "selected" visual state. We
  // clear this whenever the active diagram selection no longer matches the
  // issue's target (e.g. user clicked a different node, or deselected) so the
  // highlight stays meaningfully in sync with what's open in the detail pane.
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedIssueId) return;
    const issue = doc.issues.find((i) => i.id === selectedIssueId);
    if (!issue) {
      setSelectedIssueId(null);
      return;
    }
    if (
      !selection ||
      selection.kind !== issue.targetKind ||
      selection.id !== issue.targetId
    ) {
      setSelectedIssueId(null);
    }
  }, [selection, doc.issues, selectedIssueId]);

  const items = useMemo(() => {
    const list = doc.issues.filter((i) => {
      if (statusFilter === "active" && i.status !== "Active") return false;
      if (statusFilter === "resolved" && i.status !== "Resolved") return false;
      if (textFilter.trim()) {
        const q = textFilter.trim().toLowerCase();
        if (
          !i.title.toLowerCase().includes(q) &&
          !i.description.toLowerCase().includes(q) &&
          !(i.justification ?? "").toLowerCase().includes(q) &&
          !(i.kind && i.notEvaluatedReason && ISSUE_NOT_EVALUATED_LABELS[i.notEvaluatedReason].toLowerCase().includes(q)) &&
          !i.replies.some((r) => r.text.toLowerCase().includes(q))
        ) {
          return false;
        }
      }
      return true;
    });

    // Buckets: nodes first, then edges (in edge-number order), then anything
    // else (defensive — targetKind is currently node|edge only).
    const targetRank = (i: PsIssue): number => {
      if (i.targetKind === "node") return 0;
      if (i.targetKind === "edge") return 1;
      return 2;
    };

    // Lowest edge sequence number across the issue's scenarios. Prefer the
    // active scenario's number (so on-screen ordering matches the panel),
    // then fall back to the smallest assigned number in any of the issue's
    // other scenarios, then to doc.edges position so unnumbered edges still
    // sort deterministically (after numbered ones).
    const activeScenario = activeScenarioId
      ? doc.scenarios.find((s) => s.id === activeScenarioId)
      : null;
    const edgeDocIndex = new Map<string, number>();
    doc.edges.forEach((e, idx) => edgeDocIndex.set(e.id, idx));
    const edgeOrderKey = (i: PsIssue): number => {
      const activeNum = activeScenario?.edgeNumbers?.[i.targetId];
      if (typeof activeNum === "number") return activeNum;
      let best = Infinity;
      for (const sid of i.scenarioIds) {
        const sc = doc.scenarios.find((s) => s.id === sid);
        const n = sc?.edgeNumbers?.[i.targetId];
        if (typeof n === "number" && n < best) best = n;
      }
      if (Number.isFinite(best)) return best;
      const fallback = edgeDocIndex.get(i.targetId);
      return fallback != null ? 1_000_000 + fallback : 2_000_000;
    };

    return [...list].sort((a, b) => {
      const ra = targetRank(a);
      const rb = targetRank(b);
      if (ra !== rb) return ra - rb;
      if (a.targetKind === "edge" && b.targetKind === "edge") {
        const na = edgeOrderKey(a);
        const nb = edgeOrderKey(b);
        if (na !== nb) return na - nb;
      }
      // Within the same bucket (and equal edge order), keep most-recent
      // first so the historical ordering still applies as a tiebreaker.
      return b.createdAt - a.createdAt;
    });
  }, [
    doc.issues,
    doc.edges,
    doc.scenarios,
    activeScenarioId,
    statusFilter,
    textFilter,
  ]);

  const counts = useMemo(() => {
    let active = 0;
    let resolved = 0;
    let notEvaluated = 0;
    for (const i of doc.issues) {
      if (i.status === "Active") active += 1;
      else resolved += 1;
      if (i.kind && i.notEvaluatedReason) notEvaluated += 1;
    }
    return { active, resolved, notEvaluated, total: doc.issues.length };
  }, [doc.issues]);

  const navigate = (i: PsIssue) => {
    // Issues may span multiple scenarios — per the spec, when more than one
    // could be selected, always pick the first.
    const firstScenarioId = i.scenarioIds.find((sid) =>
      doc.scenarios.some((s) => s.id === sid)
    );
    setActiveScenarioId(firstScenarioId ?? null);
    setSelection({ kind: i.targetKind, id: i.targetId });
    setFocusTarget({ kind: i.targetKind, id: i.targetId });
    setSelectedIssueId(i.id);
  };

  return (
    <div className="ps-allcomments ps-allissues">
      <header className="ps-allcomments-header">
        <h3>All issues</h3>
        {!embedded && (
          <button
            className="ps-allcomments-close"
            aria-label="Close all issues view"
            title="Close"
            onClick={() => setAllIssuesViewOpen(false)}
          >
            ✕
          </button>
        )}
      </header>

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
          placeholder="Search issues…"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
        />
      </div>

      <div className="ps-allcomments-body">
        {selection && (selection.kind === "node" || selection.kind === "edge") ? (
          <AddThreatNote targetKind={selection.kind} targetId={selection.id} />
        ) : <p className="ps-description-below">Select a node or flow to add a threat note.</p>}
        {counts.notEvaluated > 0 && (
          <p className="ps-issue-evaluation" role="status">
            {counts.notEvaluated} not re-evaluated across all issues. Active/Resolved is the review status, not proof of a complete analysis.
          </p>
        )}
        {items.length === 0 ? (
          <p className="ps-empty">No issues match.</p>
        ) : (
          items.map((i) => (
            <IssueRow
              key={i.id}
              issue={i}
              onNavigate={() => navigate(i)}
              selected={i.id === selectedIssueId}
            />
          ))
        )}
      </div>
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
      role="tab"
      aria-selected={active}
      className={`ps-allcomments-pill ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
