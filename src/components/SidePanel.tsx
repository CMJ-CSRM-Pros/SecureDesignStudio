import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { useUiShell, type InspectorTab } from "../uiShell";
import { AllCommentsPanel } from "./AllCommentsPanel";
import { AllDeviationsPanel } from "./AllDeviationsPanel";
import { AllIssuesPanel } from "./AllIssuesPanel";
import { BoundaryDetails } from "./BoundaryDetails";
import { ChangesPanel } from "./ChangesPanel";
import { DataModal } from "./DataModal";
import { DesignAssistantPanel } from "./DesignAssistantPanel";
import { EdgeDetails } from "./EdgeDetails";
import { EdgeTable } from "./EdgeTable";
import { NodeDetails } from "./NodeDetails";
import { ScenarioDetails } from "./ScenarioDetails";
import { WorkItemsModal } from "./WorkItemsModal";

const NARROW_MIN_WIDTH = 320;
const DESKTOP_MIN_WIDTH = 500;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 500;
const CANVAS_MIN_WIDTH = 240;

function maximumWidth(): number {
  if (window.innerWidth <= 640) return window.innerWidth;
  if (window.innerWidth <= 1024) {
    return Math.min(
      520,
      Math.floor(window.innerWidth * 0.7),
      window.innerWidth - CANVAS_MIN_WIDTH,
    );
  }
  return Math.min(
    MAX_WIDTH,
    Math.floor(window.innerWidth * 0.55),
    window.innerWidth - CANVAS_MIN_WIDTH,
  );
}

function minimumWidth(): number {
  const preferredWidth =
    window.innerWidth > 700 ? DESKTOP_MIN_WIDTH : NARROW_MIN_WIDTH;
  return Math.min(preferredWidth, maximumWidth());
}

function clampWidth(width: number): number {
  return Math.min(maximumWidth(), Math.max(minimumWidth(), width));
}

export function SidePanel() {
  const {
    selection,
    doc,
    activeScenario,
    diffChanges,
    diffFileName,
    setAllCommentsViewOpen,
    setAllIssuesViewOpen,
    setDiffViewOpen,
    assistantFindings,
  } = useStore();
  const {
    inspectorVisible,
    inspectorWidth,
    inspectorPinned,
    inspectorActiveTab,
    closeInspector,
    setInspectorWidth,
    setInspectorPinned,
    setInspectorActiveTab,
  } = useUiShell();
  const previousSelectionRef = useRef<string | null | undefined>(undefined);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonFocusedRef = useRef(false);
  const tabsRef = useRef(new Map<InspectorTab, HTMLButtonElement | null>());
  tabsRef.current = new Map();

  const selectionKey = selection
    ? selection.kind === "waypoint"
      ? `waypoint:${selection.edgeId}:${selection.waypointId}`
      : `${selection.kind}:${selection.id}`
    : null;

  useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = selectionKey;
    if (
      previous !== undefined &&
      previous !== selectionKey &&
      inspectorVisible &&
      inspectorActiveTab !== "edges" &&
      inspectorActiveTab !== "changes" &&
      !inspectorPinned
    ) {
      const focusWasInInspector =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.closest(".ps-inspector") !== null;
      setInspectorActiveTab("properties");
      if (focusWasInInspector) {
        requestAnimationFrame(() =>
          tabsRef.current.get("properties")?.focus(),
        );
      }
    }
  }, [
    selectionKey,
    inspectorVisible,
    inspectorActiveTab,
    inspectorPinned,
    setInspectorActiveTab,
  ]);

  useEffect(() => {
    setAllCommentsViewOpen(
      inspectorVisible && inspectorActiveTab === "comments",
    );
    setAllIssuesViewOpen(inspectorVisible && inspectorActiveTab === "issues");
    setDiffViewOpen(inspectorVisible && inspectorActiveTab === "changes");
  }, [
    inspectorVisible,
    inspectorActiveTab,
    setAllCommentsViewOpen,
    setAllIssuesViewOpen,
    setDiffViewOpen,
  ]);

  useEffect(() => {
    if (inspectorActiveTab === "changes" && !diffFileName) {
      const focusWasInChanges =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.closest("#ps-inspector-panel-changes") !== null;
      setInspectorActiveTab("properties");
      if (focusWasInChanges) {
        requestAnimationFrame(() =>
          tabsRef.current.get("properties")?.focus(),
        );
      }
    }
  }, [inspectorActiveTab, diffFileName, setInspectorActiveTab]);

  useEffect(() => {
    if (inspectorActiveTab === "deviations" && doc.deviations.length === 0) {
      const focusWasInDeviations =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.closest(
          "#ps-inspector-tab-deviations, #ps-inspector-panel-deviations",
        ) !== null;
      setInspectorActiveTab("properties");
      if (focusWasInDeviations) {
        requestAnimationFrame(() =>
          tabsRef.current.get("properties")?.focus(),
        );
      }
    }
  }, [inspectorActiveTab, doc.deviations.length, setInspectorActiveTab]);

  useEffect(() => {
    const onResize = () => {
      setInspectorWidth(clampWidth(inspectorWidth));
      if (window.innerWidth > 640) {
        setInspectorExpanded(false);
        if (expandButtonFocusedRef.current || document.activeElement === expandButtonRef.current) {
          expandButtonFocusedRef.current = false;
          requestAnimationFrame(() =>
            tabsRef.current.get(inspectorActiveTab)?.focus({ preventScroll: true }),
          );
        }
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [inspectorWidth, inspectorActiveTab, setInspectorWidth]);

  useEffect(() => {
    if (!inspectorVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        document.querySelector(
          ".ps-modal-overlay, [data-ps-temporary-surface='true']",
        )
      ) {
        return;
      }
      event.preventDefault();
      closeInspector();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inspectorVisible, closeInspector]);

  const detail = useMemo(() => {
    if (selection?.kind === "node") {
      const node = doc.nodes.find((candidate) => candidate.id === selection.id);
      if (node) return <NodeDetails node={node} />;
    } else if (selection?.kind === "edge") {
      const edge = doc.edges.find((candidate) => candidate.id === selection.id);
      if (edge) return <EdgeDetails edge={edge} />;
    } else if (selection?.kind === "waypoint") {
      const edge = doc.edges.find(
        (candidate) => candidate.id === selection.edgeId,
      );
      if (edge) {
        return (
          <>
            <div className="ps-waypoint-banner">
              Waypoint selected — press <kbd>Delete</kbd> to remove it.
            </div>
            <EdgeDetails edge={edge} />
          </>
        );
      }
    } else if (selection?.kind === "boundary") {
      const boundary = doc.boundaries.find(
        (candidate) => candidate.id === selection.id,
      );
      if (boundary) return <BoundaryDetails boundary={boundary} />;
    }
    if (activeScenario) return <ScenarioDetails scenario={activeScenario} />;
    return (
      <div className="ps-details ps-details-empty">
        <p>
          Select or create a scenario from the command bar — all diagram
          elements must be added inside a scenario.
        </p>
      </div>
    );
  }, [selection, doc.nodes, doc.edges, doc.boundaries, activeScenario]);

  const contextLabel = useMemo(() => {
    if (selection?.kind === "node") {
      return (
        doc.nodes.find((candidate) => candidate.id === selection.id)?.title ||
        "Selected node"
      );
    }
    if (selection?.kind === "edge") {
      return (
        doc.edges.find((candidate) => candidate.id === selection.id)?.title ||
        "Selected edge"
      );
    }
    if (selection?.kind === "boundary") return "Selected boundary";
    if (selection?.kind === "waypoint") return "Selected waypoint";
    return activeScenario?.name ?? "Show all scenarios";
  }, [selection, doc.nodes, doc.edges, activeScenario]);

  const tabs: { id: InspectorTab; label: string; count?: number }[] = [
    { id: "properties", label: "Properties" },
    { id: "edges", label: "Edges", count: activeScenario?.edgeIds.length ?? 0 },
    { id: "issues", label: "Issues", count: doc.issues.length },
    { id: "comments", label: "Comments", count: doc.comments.length },
    ...(doc.deviations.length > 0
      ? [{
          id: "deviations" as const,
          label: "Deviations",
          count: doc.deviations.length,
        }]
      : []),
    ...(diffFileName
      ? [{ id: "changes" as const, label: "Changes", count: diffChanges.length }]
      : []),
    { id: "data", label: "Data", count: doc.data.length },
    { id: "work", label: "Work", count: doc.workItems.length },
    { id: "assistant", label: "Findings", count: assistantFindings.length },
  ];

  const selectTab = (tab: InspectorTab, focus = false) => {
    setInspectorActiveTab(tab);
    if (focus) {
      requestAnimationFrame(() => tabsRef.current.get(tab)?.focus());
    }
  };

  const onTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    selectTab(tabs[nextIndex].id, true);
  };

  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const onMove = (pointerEvent: PointerEvent) => {
      setInspectorWidth(
        clampWidth(startWidth + (startX - pointerEvent.clientX)),
      );
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("ps-resizing-h");
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.body.classList.add("ps-resizing-h");
  };

  if (!inspectorVisible) return null;

  return (
    <aside
      className={`ps-side ps-inspector${inspectorExpanded ? " ps-inspector-expanded" : ""}`}
      aria-labelledby="ps-inspector-title"
      style={
        {
          "--ps-inspector-width": `${clampWidth(inspectorWidth)}px`,
        } as CSSProperties
      }
    >
      <div
        className="ps-side-resizer"
        onPointerDown={onResizeStart}
        onDoubleClick={() => setInspectorWidth(DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const delta = event.shiftKey ? 48 : 16;
          setInspectorWidth(
            clampWidth(
              inspectorWidth +
                (event.key === "ArrowLeft" ? delta : -delta),
            ),
          );
        }}
        tabIndex={0}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuemin={Math.round(minimumWidth())}
        aria-valuemax={Math.round(maximumWidth())}
        aria-valuenow={Math.round(clampWidth(inspectorWidth))}
        title="Drag or use arrow keys to resize; double-click to reset"
      />
      <header className="ps-inspector-header">
        <div>
          <h2 id="ps-inspector-title">
            {inspectorActiveTab === "assistant" ? (
              <>
                <span className="ps-assistant-mark" aria-hidden="true">
                  <span>✦</span>
                  <span>✦</span>
                </span>
                Design Assistant
              </>
            ) : (
              "Inspector"
            )}
          </h2>
          <p>
            {inspectorActiveTab === "assistant"
              ? "Security and privacy model review"
              : contextLabel}
          </p>
        </div>
        <button
          ref={expandButtonRef}
          type="button"
          className="ps-inspector-icon ps-inspector-expand"
          aria-label={inspectorExpanded ? "Restore inspector size" : "Expand inspector"}
          aria-expanded={inspectorExpanded}
          aria-controls="ps-inspector-panel"
          title={inspectorExpanded ? "Restore inspector size" : "Expand inspector"}
          onClick={() => setInspectorExpanded((expanded) => !expanded)}
          onFocus={() => { expandButtonFocusedRef.current = true; }}
          onBlur={() => {
            // A desktop resize can hide/blur the toggle before the resize event.
            if (window.innerWidth <= 640) expandButtonFocusedRef.current = false;
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={inspectorExpanded ? "M3 5l5 5 5-5" : "M3 11l5-5 5 5"} />
          </svg>
        </button>
        <button
          type="button"
          className="ps-inspector-icon"
          aria-label={inspectorPinned ? "Unpin inspector tab" : "Pin inspector tab"}
          aria-pressed={inspectorPinned}
          title={
            inspectorPinned
              ? "Allow Properties to follow selection"
              : "Keep the current tab when selection changes"
          }
          onClick={() => setInspectorPinned(!inspectorPinned)}
        >
          {inspectorPinned ? "◆" : "◇"}
        </button>
        <button
          type="button"
          className="ps-inspector-icon"
          aria-label="Close inspector"
          title="Close inspector (Escape)"
          onClick={closeInspector}
        >
          ×
        </button>
      </header>
      <div
        className="ps-inspector-tabs"
        role="tablist"
        aria-label="Inspector views"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => tabsRef.current.set(tab.id, element)}
            type="button"
            role="tab"
            id={`ps-inspector-tab-${tab.id}`}
            aria-selected={inspectorActiveTab === tab.id}
            aria-controls={`ps-inspector-panel-${tab.id}`}
            tabIndex={inspectorActiveTab === tab.id ? 0 : -1}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {tab.label}
            {typeof tab.count === "number" && (
              <span className="ps-inspector-tab-count">{tab.count}</span>
            )}
          </button>
        ))}
      </div>
      <div
        id="ps-inspector-panel"
        className={`ps-inspector-panel${
          inspectorActiveTab === "assistant"
            ? " ps-inspector-panel-assistant-active"
            : ""
        }`}
      >
        <section
          id="ps-inspector-panel-properties"
          role="tabpanel"
          aria-labelledby="ps-inspector-tab-properties"
          hidden={inspectorActiveTab !== "properties"}
        >
          {detail}
        </section>
        <section
          id="ps-inspector-panel-edges"
          role="tabpanel"
          aria-labelledby="ps-inspector-tab-edges"
          hidden={inspectorActiveTab !== "edges"}
        >
          <EdgeTable />
        </section>
        <section
          id="ps-inspector-panel-issues"
          role="tabpanel"
          aria-labelledby="ps-inspector-tab-issues"
          hidden={inspectorActiveTab !== "issues"}
        >
          <AllIssuesPanel embedded />
        </section>
        <section
          id="ps-inspector-panel-assistant"
          role="tabpanel"
          aria-labelledby="ps-inspector-tab-assistant"
          tabIndex={0}
          hidden={inspectorActiveTab !== "assistant"}
        >
          <DesignAssistantPanel />
        </section>
        <section
          id="ps-inspector-panel-comments"
          role="tabpanel"
          aria-labelledby="ps-inspector-tab-comments"
          hidden={inspectorActiveTab !== "comments"}
        >
          <AllCommentsPanel embedded />
        </section>
        {doc.deviations.length > 0 && (
          <section
            id="ps-inspector-panel-deviations"
            role="tabpanel"
            aria-labelledby="ps-inspector-tab-deviations"
            hidden={inspectorActiveTab !== "deviations"}
          >
            <AllDeviationsPanel />
          </section>
        )}
        {diffFileName && (
          <section
            id="ps-inspector-panel-changes"
            role="tabpanel"
            aria-labelledby="ps-inspector-tab-changes"
            hidden={inspectorActiveTab !== "changes"}
          >
            <ChangesPanel embedded />
          </section>
        )}
        <section
          id="ps-inspector-panel-data"
          role="tabpanel"
          aria-labelledby="ps-inspector-tab-data"
          hidden={inspectorActiveTab !== "data"}
        >
          <DataModal embedded />
        </section>
        <section
          id="ps-inspector-panel-work"
          role="tabpanel"
          aria-labelledby="ps-inspector-tab-work"
          hidden={inspectorActiveTab !== "work"}
        >
          <WorkItemsModal embedded />
        </section>
      </div>
    </aside>
  );
}
