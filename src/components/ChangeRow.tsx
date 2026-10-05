import { useStore } from "../store";
import { isChangeNavigable, type ChangeItem } from "../diff";

const CATEGORY_LABELS: Record<ChangeItem["category"], string> = {
  scenario: "Scenario",
  node: "Node",
  edge: "Edge",
  boundary: "Boundary",
  annotation: "Text annotation",
  data: "Data",
  deviation: "Deviation",
  workItem: "Work Item",
  nodeType: "Node Type",
  authentication: "Authentication",
  catalogDefinition: "Catalog definition",
  membership: "Membership",
  attachment: "Attachment",
};

export function ChangeRow({
  change,
  selected,
  onNavigate,
  onOpenProperties,
}: {
  change: ChangeItem;
  selected: boolean;
  onNavigate: (change: ChangeItem) => void;
  onOpenProperties: (change: ChangeItem) => void;
}) {
  const { doc } = useStore();
  // Re-check navigability at render time. The diff was computed against the
  // current doc at click-Compare time, but the user can edit the document
  // afterwards — stale targets should stop being clickable. We only flag
  // "item no longer exists" when the change originally had a target but it
  // disappeared; rows that never had one (e.g. "Removed scenario X") just
  // render as static descriptions without the redundant badge.
  const hadTarget = !!change.target;
  const navigable = hadTarget && isChangeNavigable(change, doc);
  const stale = hadTarget && !navigable;

  // Treat "Removed ..." and "[scenario] Removed ..." rows as deletions so we
  // can visually distinguish them in the panel (strikethrough category pill +
  // trash icon on the right). Description prefixes are stable across all
  // removal messages emitted by diff.ts.
  const isRemoval = /^\s*(?:\[[^\]]+\]\s+)?Removed\b/i.test(change.description);

  const className =
    `ps-allcomments-row ps-diff-row ps-diff-${change.category}` +
    (selected ? " ps-diff-row-selected" : "") +
    (stale ? " ps-diff-row-stale" : "") +
    (isRemoval ? " ps-diff-row-removed" : "");

  const showEdgeContext =
    change.category === "edge" &&
    (change.scenarioName != null || change.edgeNumber != null);

  const inner = (
    <>
      <div className="ps-allcomments-row-head">
        <span
          className={
            `ps-diff-pill ps-diff-pill-${change.category}` +
            (isRemoval ? " ps-diff-pill-removed" : "")
          }
        >
          {CATEGORY_LABELS[change.category]}
        </span>
        {showEdgeContext && (
          <span className="ps-diff-edge-context">
            {change.scenarioName && (
              <span className="ps-diff-scenario-pill">
                {change.scenarioName}
              </span>
            )}
            {change.edgeNumber != null && (
              <span className="ps-diff-edgenum-pill">
                #{change.edgeNumber}
              </span>
            )}
          </span>
        )}
        {stale && (
          <span className="ps-diff-stale-note">item no longer exists</span>
        )}
        {isRemoval && (
          <span
            className="ps-diff-removed-icon"
            aria-label="Removed"
            title="Removed"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </span>
        )}
      </div>
      <p className="ps-diff-description">{change.description}</p>
    </>
  );

  return (
    <div className={className}>
      {navigable ? (
        <button
          type="button"
          className="ps-allissues-rowhead"
          onClick={() => onNavigate(change)}
          onDoubleClick={() => onOpenProperties(change)}
          title="Click to navigate; double-click to open properties"
        >
          {inner}
        </button>
      ) : (
        <div className="ps-allissues-rowhead ps-diff-rowhead-static">
          {inner}
        </div>
      )}
    </div>
  );
}
