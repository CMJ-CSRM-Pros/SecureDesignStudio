import { useEffect, useRef, type CSSProperties } from "react";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { SequenceDiagramView } from "./components/SequenceDiagramView";
import { SidePanel } from "./components/SidePanel";
import { Toolbar } from "./components/Toolbar";
import { DeleteKeyHandler } from "./components/DeleteKeyHandler";
import { StoreProvider, useStore } from "./store";
import { UiShellProvider, useUiShell } from "./uiShell";
import { BreachSimulationProvider } from "./breachSimulation";
import { LibrarySummary } from "./components/LibraryDetails";
import { SERVICES } from "./services";
import { AiProviderProvider } from "./aiProvider";
import "./styles.css";

// Auto-join a collaborative session in collaboration-enabled builds when the
// page was opened with a `#room=…&key=…` URL hash.
function HashRoomJoiner() {
  const { joinRoom, collab } = useStore();
  useEffect(() => {
    if (!SERVICES.collaboration.enabled) return;
    if (collab.room) return;
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const room = params.get("room");
    const key = params.get("key");
    if (room && key) {
      joinRoom(room, key, { seed: false });
    }
    // Run once on mount; subsequent in-app joins/leaves manipulate the
    // hash directly (see Toolbar). We deliberately don't react to
    // later hash changes — the user's "Leave" action wipes the hash
    // and we don't want this effect to immediately rejoin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Renders the active main view inside `.ps-canvas`. The DiagramCanvas is
// the React Flow graph; SequenceDiagramView renders the same underlying
// nodes/edges as a UML-style sequence diagram. Both read from the store —
// switching views never mutates the document.
function MainView() {
  const { viewMode } = useStore();
  if (viewMode === "sequence") return <SequenceDiagramView />;
  return <DiagramCanvas />;
}

function StatusBar() {
  const { doc } = useStore();
  const { documentFileName } = useUiShell();

  return (
    <footer className="ps-status-bar" aria-label="Document status">
      <span title={documentFileName}>{documentFileName}</span>
      <span aria-hidden="true">|</span>
      <span>{__PS_LOCAL_ONLY__ ? "Local mode" : SERVICES.collaboration.enabled ? "Collaboration available" : "Collaboration disabled"}</span>
      <span aria-hidden="true">|</span>
      <span>{doc.nodes.length} nodes</span>
      <span aria-hidden="true">|</span>
      <span>{doc.edges.length} flows</span>
      <span aria-hidden="true">|</span>
      <span className="ps-library-status" aria-label="Custom Libraries status"><LibrarySummary /></span>
    </footer>
  );
}

function AppShell() {
  const { darkTheme, inspectorVisible, inspectorPresentation, openInspector, reopenFocusRequest, outOfScopeColor, externalInteractorColor } =
    useUiShell();
  const reopenInspectorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (inspectorVisible || reopenFocusRequest === 0) return;
    requestAnimationFrame(() =>
      reopenInspectorRef.current?.focus({ preventScroll: true }),
    );
  }, [inspectorVisible, reopenFocusRequest]);

  return (
    <div className={`ps-shell ${darkTheme ? "ps-theme-dark" : ""}`}
      style={{ "--ps-oos-color": outOfScopeColor, "--ps-external-color": externalInteractorColor } as CSSProperties}>
      <Toolbar />
      <main
        className={`ps-main ${inspectorVisible && inspectorPresentation === "docked" ? "ps-inspector-visible" : "ps-inspector-hidden"}`}
      >
        <div className="ps-canvas">
          <MainView />
          {!inspectorVisible && (
            <button
              ref={reopenInspectorRef}
              type="button"
              className="ps-inspector-reopen"
              onClick={(event) =>
                openInspector("properties", event.currentTarget)
              }
              aria-label="Open inspector"
              title="Open inspector"
            >
              Open inspector
            </button>
          )}
        </div>
        <SidePanel />
      </main>
      <StatusBar />
      <DeleteKeyHandler />
    </div>
  );
}

export default function App() {
  return (
    <UiShellProvider>
      <StoreProvider>
        <AiProviderProvider>
        <BreachSimulationProvider>
          {SERVICES.collaboration.enabled && <HashRoomJoiner />}
          <AppShell />
        </BreachSimulationProvider>
        </AiProviderProvider>
      </StoreProvider>
    </UiShellProvider>
  );
}
