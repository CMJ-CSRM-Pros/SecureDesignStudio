import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SERVICES } from "../services";
import {
  normalizeDoc,
  useStore,
  type FilterState,
} from "../store";
import { dataClassificationLabel, resolveNodeTypeDef, uid, withAuthenticationDefinitions } from "../types";
import {
  AUTOSAVE_INTERVAL_OPTIONS,
  useUiShell,
  type InspectorTab,
} from "../uiShell";
import { resetDetailsTab } from "./detailsTabStore";
import { generateKey } from "../collab/crypto";
import { diffDocuments } from "../diff";
import { prepareTm7Export } from "../tm7Export";
import { exportVsdx } from "../vsdxExport";
import { importTmcExport, TmcImportError } from "../tmcImport";
import { parseTm7, Tm7ImportError } from "../tm7Import";
import { parsePrivExp, type ParsedPrivExp } from "../privacyManagerImport";
import { buildStandaloneHtml } from "../embeddedDoc";
import {
  buildReviewReportHtml,
  captureDiagramPng,
  downloadDiagramPng,
  downloadReviewReport,
} from "../reportExport";
import { SECURE_DESIGN_STUDIO_DOCUMENT_FORMAT } from "../documentFormat";
import { DataModal } from "./DataModal";
import { WorkItemsModal } from "./WorkItemsModal";
import { NewScenarioDialog } from "./NewScenarioDialog";
import { PrivacyManagerImportDialog } from "./PrivacyManagerImportDialog";
import { VsdxExportNoticeDialog } from "./VsdxExportNoticeDialog";
import { ImportEndpointsDialog } from "./ImportEndpointsDialog";
import { SaveAsDialog } from "./SaveAsDialog";
import { AboutDialog } from "./AboutDialog";
import { useLibraries } from "../libraries/LibraryProvider";
import { inventoryFieldFor } from "../inventoryIdentity";
import { withCatalogDefinitions } from "../catalogDefinitions";
import { CatalogDefinitionsNotice } from "./CatalogDefinitionsNotice";
import { AuthenticationLibraryModal } from "./AuthenticationLibraryModal";
import { ClassificationLibraryModal } from "./ClassificationLibraryModal";
import secureDesignStudioLogo from "../assets/secure-design-studio-logo.svg?inline";

type ToolbarMenu = "file" | "model" | "review" | "view";

const DEFAULT_FILE_NAME = "secure-design-studio-diagram.tma";

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
}

function normalizeTmaFileName(value: string): string {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "");
  if (!safe) return DEFAULT_FILE_NAME;
  return safe.toLowerCase().endsWith(".tma") ? safe : `${safe}.tma`;
}
import { NodeTypeCatalogModal } from "./NodeTypeCatalogModal";
import { DeleteScenarioDialog } from "./DeleteScenarioDialog";

type CommandMenuId =
  | "file"
  | "model"
  | "review"
  | "view"
  | "filter"
  | "export"
  | "settings"
  | "collaboration";

type CommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.compare"
  | "file.importTmc"
  | "file.importTm7"
  | "file.importPrivacyManager"
  | "file.importEndpoints"
  | "file.exportTm7"
  | "file.exportVsdx"
  | "file.exportImage"
  | "file.exportReport"
  | "file.exportStandalone"
  | "scenario.new"
  | "scenario.duplicate"
  | "scenario.settings"
  | "scenario.delete"
  | "model.catalog"
  | "model.annotation"
  | "model.authentication"
  | "model.classifications"
  | "model.customLibraries"
  | "model.data"
  | "model.work"
  | "review.analyze"
  | "assistant.open"
  | "review.issues"
  | "review.comments"
  | "review.deviations"
  | "review.changes"
  | "view.graph"
  | "view.sequence"
  | "view.inspector"
  | "view.properties"
  | "view.edges"
  | "preferences.autosave.500"
  | "preferences.autosave.2000"
  | "preferences.autosave.5000"
  | "preferences.autosave.15000"
  | "preferences.reset"
  | "canvas.fitView"
  | "history.undo"
  | "history.redo"
  | "collaboration.share"
  | "collaboration.leave"
  | "app.about";

export function Toolbar() {
  const libraries = useLibraries();
  const inventoryField = inventoryFieldFor(libraries.fields);
  const {
    doc,
    nodeTypeCatalog,
    authenticationCatalog,
    authenticationWarnings,
    authenticationStorageError,
    classificationDefinitions,
    availableCatalogDefinitions,
    classificationStorageError,
    activeScenarioId,
    activeScenario,
    setActiveScenarioId,
    setSelection,
    createScenario,
    cloneScenario,
    deleteScenario,
    exportJson,
    importJson,
    createNode,
    createTextAnnotation,
    setFocusTarget,
    updateNode,
    addNodeToScenario,
    filter,
    setFilter,
    clearFilter,
    undo,
    redo,
    canUndo,
    canRedo,
    allCommentsViewOpen,
    setAllCommentsViewOpen,
    allIssuesViewOpen,
    setAllIssuesViewOpen,
    diffViewOpen,
    setDiffViewOpen,
    diffChanges,
    diffFileName,
    loadDiff,
    analyze,
    newDocument,
    importPrivacyManagerData,
    collab,
    joinRoom,
    leaveRoom,
    viewMode,
    setViewMode,
  } = useStore();
  const {
    inspectorVisible,
    inspectorActiveTab,
    openInspector,
    toggleInspector,
    requestFitView,
    darkTheme,
    setDarkTheme,
    autosaveIntervalMs,
    setAutosaveIntervalMs,
    resetPreferences,
    documentFileName,
    setDocumentFileName,
  } = useUiShell();

  const fileRef = useRef<HTMLInputElement>(null);
  const compareFileRef = useRef<HTMLInputElement>(null);
  const endpointsFileRef = useRef<HTMLInputElement>(null);
  const tmcFileRef = useRef<HTMLInputElement>(null);
  const tm7FileRef = useRef<HTMLInputElement>(null);
  const pmFileRef = useRef<HTMLInputElement>(null);
  const restoreFileCommandFocus = () => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="ps-command-menu-file"]',
        )
        ?.focus();
    }, 0);
  };
  const fileOpsMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const reviewMenuRef = useRef<HTMLDivElement | null>(null);
  const viewOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const fileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [nodeTypeCatalogOpen, setNodeTypeCatalogOpen] = useState(false);
  const [authenticationLibraryOpen, setAuthenticationLibraryOpen] = useState(false);
  const [classificationLibraryOpen, setClassificationLibraryOpen] = useState(false);
  const [customLibrariesOpen, setCustomLibrariesOpen] = useState(false);
  const [workItemsModalOpen, setWorkItemsModalOpen] = useState(false);
  const [newScenarioOpen, setNewScenarioOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<ToolbarMenu | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [vsdxNoticeOpen, setVsdxNoticeOpen] = useState(false);
  const [endpointsDialogOpen, setEndpointsDialogOpen] = useState(false);
  const [commandMenu, setCommandMenu] = useState<CommandMenuId | null>(null);
  const [filterDraft, setFilterDraft] = useState<FilterState>(filter);
  const [scenarioToDelete, setScenarioToDelete] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const commandBarRef = useRef<HTMLElement>(null);
  const commandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const commandReturnControlsRef = useRef<string | null>(null);
  const commandRef = useRef<(id: CommandId) => void>(() => undefined);
  // Privacy Manager import flow state: parsed file + which services
  // already auto-mapped to existing nodes. Null = no import in progress.
  const [pmImportState, setPmImportState] = useState<{
    parsed: ParsedPrivExp;
    autoMappedNodeByService: Record<string, string>;
  } | null>(null);

  const fileOpsOpen = openMenu === "file";
  const modelOpen = openMenu === "model";
  const reviewOpen = openMenu === "review";
  const viewOptionsOpen = openMenu === "view";

  const triggerForMenu = (menu: ToolbarMenu | null) => {
    switch (menu) {
      case "file":
        return fileTriggerRef.current;
      case "model":
        return modelTriggerRef.current;
      case "review":
        return reviewTriggerRef.current;
      case "view":
        return viewTriggerRef.current;
      default:
        return null;
    }
  };

  const menuForName = (menu: ToolbarMenu | null) => {
    switch (menu) {
      case "file":
        return fileOpsMenuRef.current;
      case "model":
        return modelMenuRef.current;
      case "review":
        return reviewMenuRef.current;
      case "view":
        return viewOptionsMenuRef.current;
      default:
        return null;
    }
  };

  const toggleMenu = (menu: ToolbarMenu) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  useEffect(() => {
    const onCancel = () => restoreFileCommandFocus();
    const inputs = [
      fileRef.current,
      compareFileRef.current,
      endpointsFileRef.current,
      tmcFileRef.current,
      tm7FileRef.current,
      pmFileRef.current,
    ].filter((input): input is HTMLInputElement => input !== null);
    inputs.forEach((input) => input.addEventListener("cancel", onCancel));
    return () =>
      inputs.forEach((input) => input.removeEventListener("cancel", onCancel));
  }, []);

  // Close open dropdowns on outside click / Escape. We only register the
  // listener while at least one menu is open.
  useEffect(() => {
    if (!openMenu) return;
    const onClickAway = (e: MouseEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(".ps-dropdown")
      ) {
        return;
      }
      setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const trigger = triggerForMenu(openMenu);
        setOpenMenu(null);
        if (trigger) window.requestAnimationFrame(() => trigger.focus());
      }
    };
    document.addEventListener("mousedown", onClickAway, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  useLayoutEffect(() => {
    const bar = commandBarRef.current;
    if (!bar) return;
    const updateLayout = () => {
      bar.style.setProperty(
        "--ps-command-bar-height",
        `${bar.getBoundingClientRect().height}px`,
      );
      const menu = commandMenu
        ? document.getElementById(`ps-command-menu-${commandMenu}`)
        : null;
      if (!menu) return;
      // A right-aligned menu can cross the left edge after its trigger wraps.
      menu.style.transform = "";
      const rect = menu.getBoundingClientRect();
      const shift = Math.max(
        8 - rect.left,
        Math.min(0, window.innerWidth - 8 - rect.right),
      );
      if (shift) menu.style.transform = `translateX(${shift}px)`;
    };
    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [commandMenu]);

  // Move focus into an opened menu so arrow-key navigation starts predictably.
  useEffect(() => {
    if (!commandMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".ps-command-menu-wrap")
      ) {
        return;
      }
      setCommandMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setCommandMenu(null);
      commandTriggerRef.current?.focus();
      commandTriggerRef.current = null;
      commandReturnControlsRef.current = null;
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [commandMenu]);

  useEffect(() => {
    const onFileShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const command: CommandId | null =
        event.key.toLowerCase() === "s" && event.shiftKey
          ? "file.saveAs"
          : event.key.toLowerCase() === "s"
          ? "file.save"
          : event.key.toLowerCase() === "n"
            ? "file.new"
            : event.key.toLowerCase() === "o"
              ? "file.open"
              : null;
      if (!command) return;
      if (
        command !== "file.save" &&
        document.querySelector(".ps-modal-overlay")
      ) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      commandRef.current(command);
    };
    window.addEventListener("keydown", onFileShortcut);
    return () => window.removeEventListener("keydown", onFileShortcut);
  }, []);

  const closeCommandMenu = () => setCommandMenu(null);

  const focusCommandItem = (menu: CommandMenuId, last = false) => {
    requestAnimationFrame(() => {
      const menuSelector = `#ps-command-menu-${menu}`;
      const selector =
        menu === "filter"
          ? `${menuSelector} input:not(:disabled), ${menuSelector} select:not(:disabled), ${menuSelector} button:not(:disabled)`
          : `${menuSelector} button:not(:disabled)`;
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      );
      const target = last ? items[items.length - 1] : items[0];
      target?.focus();
    });
  };

  const openCommandMenu = (
    menu: CommandMenuId,
    trigger: HTMLButtonElement,
    focusFirst = false,
  ) => {
    commandTriggerRef.current = trigger;
    commandReturnControlsRef.current = `ps-command-menu-${menu}`;
    if (menu === "filter") setFilterDraft(filter);
    setCommandMenu((current) => (current === menu ? null : menu));
    if (focusFirst) focusCommandItem(menu);
  };

  const onCommandTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    menu: CommandMenuId,
  ) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const triggers = Array.from(
        commandBarRef.current?.querySelectorAll<HTMLButtonElement>(
          "button[aria-controls^='ps-command-menu-']",
        ) ?? [],
      ).filter((trigger) => trigger.getClientRects().length > 0);
      const currentIndex = triggers.indexOf(event.currentTarget);
      if (currentIndex >= 0 && triggers.length > 1) {
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex =
          (currentIndex + delta + triggers.length) % triggers.length;
        triggers[nextIndex]?.focus();
      }
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Enter" &&
      event.key !== " "
    ) {
      return;
    }
    event.preventDefault();
    commandTriggerRef.current = event.currentTarget;
    commandReturnControlsRef.current = `ps-command-menu-${menu}`;
    if (menu === "filter") setFilterDraft(filter);
    setCommandMenu(menu);
    focusCommandItem(menu, event.key === "ArrowUp");
  };

  const onCommandMenuKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    const currentIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (event.key === "Tab") {
      setCommandMenu(null);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const query = event.key.toLowerCase();
        const match = buttons.find((button) =>
          button.textContent?.trim().toLowerCase().startsWith(query),
        );
        if (match) {
          event.preventDefault();
          match.focus();
        }
      }
      return;
    }
    event.preventDefault();
    if (buttons.length === 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    }
    buttons[nextIndex]?.focus();
  };

  // When the File Operations menu opens, measure its bounding rect in the
  // default left-anchored placement. If it would overflow the right edge
  // of the viewport (long localized labels, narrow window), flip it to a
  // right-anchored placement so the menu grows toward the trigger's left.
  // useLayoutEffect runs after DOM commit but before paint, so the flip
  // is applied in the same frame and the user never sees the clipped
  // placement.
  useLayoutEffect(() => {
    const menu = menuForName(openMenu);
    const first = menu?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
    );
    if (!first) return;
    const frame = window.requestAnimationFrame(() => first.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [openMenu]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
      ),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (e.key === "ArrowDown") nextIndex = (index + 1) % items.length;
    else if (e.key === "ArrowUp")
      nextIndex = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = items.length - 1;
    if (nextIndex == null) return;
    e.preventDefault();
    items[nextIndex].focus();
  };

  const onAnalyze = () => {
    try {
      analyze();
    } catch (error) {
      window.alert(`Analyze failed. The model, findings and history were not changed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setOpenMenu(null);
    closeCommandMenu();
    // Surface the (potentially updated) issues list immediately.
    setAllIssuesViewOpen(true);
    openInspector("issues", commandTriggerRef.current);
  };

  const onNewScenario = () => setNewScenarioOpen(true);

  const onCreateScenarioFromDialog = ({
    name,
    description,
    sourceId,
  }: {
    name: string;
    description: string;
    sourceId: string | null;
  }) => {
    const s = sourceId
      ? cloneScenario(sourceId, name, description)
      : createScenario(name, description);
    if (s) setActiveScenarioId(s.id);
    setNewScenarioOpen(false);
    restoreCommandFocus();
  };


  const downloadTma = (fileName: string) => {
    let json: string;
    try {
      json = exportJson();
    } catch (error) {
      window.alert(`Failed to save model: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  };

  const saveTmaWithPicker = async (): Promise<boolean> => {
    const pickerWindow = window as SaveFilePickerWindow;
    if (!pickerWindow.showSaveFilePicker) return false;

    try {
      const json = exportJson();
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: documentFileName,
        types: [
          {
            description: "SecureDesignStudio model",
            accept: { "application/json": [".tma"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      setDocumentFileName(normalizeTmaFileName(handle.name));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return true;
      }
      window.alert(`Failed to save model: ${(error as Error).message}`);
    }
    return true;
  };

  const onDownload = async () => {
    setOpenMenu(null);
    if (!(await saveTmaWithPicker())) {
      setSaveAsOpen(true);
    }
  };

  const onSaveAs = async () => {
    setOpenMenu(null);
    if (!(await saveTmaWithPicker())) {
      setSaveAsOpen(true);
    }
  };

  const onExportTm7 = () => {
    setOpenMenu(null);
    try {
      const result = prepareTm7Export(withCatalogDefinitions(withAuthenticationDefinitions(doc, authenticationCatalog), availableCatalogDefinitions),
        { modelName: "SecureDesignStudio model", inventoryLabel: inventoryField.label });
      if (!window.confirm([
        "Export the supported TM7 drawing projection?",
        "Save a .tma copy first to retain full detail. Only explicitly authored threat notes become native threat records; review the format limitations below.",
        ...result.diagnostics.map(message => `- ${message}`),
        "", "Continue with download?",
      ].join("\n"))) return;
      const blob = new Blob([result.xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      try {
        a.href = url;
        a.download = "secure-design-studio-diagram.tm7";
        document.body.appendChild(a);
        a.click();
      } finally {
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      window.alert(`Failed to export TM7 file: ${(err as Error).message}`);
    } finally {
      restoreFileCommandFocus();
    }
  };

  // "Export as VSDX" — produces a Microsoft Visio file (one page per
  // scenario) suitable for upload to Microsoft Privacy Manager. Each
  // node shows its title, type label, and Service Tree id; privacy
  // boundaries render as labelled rectangles behind their nodes.
  const onExportVsdx = () => {
    setOpenMenu(null);
    if (doc.textAnnotations?.length && !window.confirm(
      `Visio export omits ${doc.textAnnotations.length} canvas text annotations. Keep the .tma model to retain all text. Continue with this lossy export?`,
    )) return;
    try {
      const bytes = exportVsdx(withCatalogDefinitions(doc, availableCatalogDefinitions), {
        inventoryLabel: inventoryField.label,
        modelName: "SecureDesignStudio diagram",
        classificationDefinitions,
      });
      // Blob() needs a BlobPart — copy into a fresh ArrayBuffer-backed
      // view to satisfy lib.dom's stricter typing (Uint8Array's buffer
      // is ArrayBufferLike which now includes SharedArrayBuffer).
      const buf = new Uint8Array(bytes.byteLength);
      buf.set(bytes);
      const blob = new Blob([buf], {
        type: "application/vnd.ms-visio.drawing",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "secure-design-studio-diagram.vsdx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // VSDX connectors only finish glueing after Visio runs its layout
      // engine; surface that as a post-export instruction.
      setVsdxNoticeOpen(true);
    } catch (err) {
      window.alert(
        "VSDX export failed: " +
          ((err as Error).message ?? String(err)),
      );
    }
  };

  const onExportImage = async () => {
    setOpenMenu(null);
    closeCommandMenu();
    if (!activeScenario || viewMode !== "graph") return;
    try {
      const image = await captureDiagramPng(doc, activeScenario);
      downloadDiagramPng(image, documentFileName);
    } catch (error) {
      window.alert(`Diagram image export failed: ${(error as Error).message}`);
    }
  };

  const onExportReport = async () => {
    setOpenMenu(null);
    closeCommandMenu();
    if (!activeScenario) return;
    let diagramDataUrl: string | undefined;
    if (viewMode === "graph") {
      try {
        diagramDataUrl = await captureDiagramPng(doc, activeScenario);
      } catch {
        // The report remains useful if a browser cannot rasterize the canvas.
      }
    }
    const html = buildReviewReportHtml({
      inventoryLabel: inventoryField.label,
      inventoryRequired: libraries.rules.some(rule => rule.target === "node" && rule.fieldId === inventoryField.id && rule.check === "required"),
      classificationDefinitions,
      doc: withCatalogDefinitions(withAuthenticationDefinitions(doc, authenticationCatalog), availableCatalogDefinitions),
      scenario: activeScenario,
      diagramDataUrl,
      documentFileName,
      appVersion: __PS_VERSION__,
    });
    downloadReviewReport(html, documentFileName);
  };

  // "Export as standalone HTML" — only available in the BUILD_SINGLE_FILE
  // build. Reuses the pristine startup HTML and reinjects the current
  // model JSON into an embedded-doc script tag. The result is a single
  // double-clickable file that opens to the exact current state.
  const onExportStandaloneHtml = () => {
    setOpenMenu(null);
    try {
      const json = exportJson();
      const html = buildStandaloneHtml(json);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "secure-design-studio-diagram.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(
        "Standalone HTML export failed: " +
          ((err as Error).message ?? String(err)),
      );
    }
  };

  const onUploadClick = () => {
    setOpenMenu(null);
    fileRef.current?.click();
  };

  const onNew = () => {
    setOpenMenu(null);
    const hasContent =
      doc.nodes.length > 0 ||
      doc.edges.length > 0 ||
      doc.scenarios.length > 0 ||
      (doc.textAnnotations?.length ?? 0) > 0 ||
      doc.boundaries.length > 0 ||
      doc.data.length > 0;
    if (
      hasContent &&
      !window.confirm(
        "Create a brand-new document? The current diagram will be cleared. " +
          "You can use Undo (Ctrl+Z) to recover it."
      )
    ) {
      return;
    }
    newDocument();
    setDocumentFileName(DEFAULT_FILE_NAME);
  };

  const onImportEndpointsClick = () => {
    setOpenMenu(null);
    if (!activeScenarioId) {
      // Belt-and-suspenders: the menu item is disabled when there's no
      // active scenario, but guard the entry point too in case the menu
      // is opened programmatically.
      window.alert(
        "Select or create a scenario first — nodes must belong to a scenario."
      );
      return;
    }
    // Show the example-query/instructions dialog first; the file picker
    // is only opened when the user clicks "Choose file…".
    setEndpointsDialogOpen(true);
  };

  const onEndpointsFileChosen = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length === 0) {
        window.alert("The selected file is empty.");
        return;
      }

      // Extract a URL from each line. Lines may be raw URLs, or
      // request-line-style "METHOD URL [HTTP/x.y]". We grab the first
      // http(s) token; if none, fall back to the whole line so the regex
      // can still try to match path-only entries.
      const extractUrl = (line: string): string => {
        const m = line.match(/https?:\/\/\S+/i);
        return m ? m[0] : line;
      };

      // For each known node type with a non-trivial endpointRegex, compile
      // once. Skip the empty-endpoint placeholder ("^$") since it would
      // never match a real URL.
      const compiled: {
        typeId: string;
        regex: RegExp;
        pattern: string;
        policyRank: number;
      }[] = [];
      for (const ref of nodeTypeCatalog) {
        const def = resolveNodeTypeDef(ref.id, nodeTypeCatalog);
        if (!def) continue;
        const pattern = def.endpointRegex?.trim();
        if (!pattern || pattern === "^$") continue;
        try {
          compiled.push({
            typeId: def.id,
            regex: new RegExp(pattern, "i"),
            pattern,
            // Prefer curated definitions over broad catalog-only patterns when
            // both identify the same endpoint.
            policyRank: def.policyStatus === "Unspecified" ? 0 : 1,
          });
        } catch {
          // Skip catalog entries with malformed regex — they're a data bug
          // we shouldn't crash on during import.
        }
      }

      const matchedTypeIds = new Set<string>();
      const ambiguousMatches: {
        line: string;
        url: string;
        typeIds: string[];
      }[] = [];
      const unknownLines: string[] = [];
      for (const line of lines) {
        const url = extractUrl(line);
        // Collect every matching regex for this URL, then pick the most
        // specific one — defined as the longest matched substring, with
        // ties broken by the longest source pattern. Without this,
        // overlapping rules (e.g. "\.crm\.dynamics\.com" vs that-plus
        // "/api/.../RetrieveAnalyticsStoreDetails") would both create
        // their own node even though the more specific one obviates the
        // generic one.
        let best:
          | {
              typeId: string;
              policyRank: number;
              matchLen: number;
              patternLen: number;
            }
          | null = null;
        const matches: {
          typeId: string;
          policyRank: number;
          matchLen: number;
          patternLen: number;
        }[] = [];
        for (const { typeId, regex, pattern, policyRank } of compiled) {
          const m = url.match(regex);
          if (!m) continue;
          const matchLen = m[0].length;
          const patternLen = pattern.length;
          matches.push({ typeId, policyRank, matchLen, patternLen });
          if (
            !best ||
            policyRank > best.policyRank ||
            (policyRank === best.policyRank && matchLen > best.matchLen) ||
            (policyRank === best.policyRank &&
              matchLen === best.matchLen &&
              patternLen > best.patternLen)
          ) {
            best = { typeId, policyRank, matchLen, patternLen };
          }
        }
        if (best) {
          const finalists = matches.filter(
            (candidate) =>
              candidate.policyRank === best!.policyRank &&
              candidate.matchLen === best!.matchLen &&
              candidate.patternLen === best!.patternLen,
          );
          if (best.policyRank === 0 && finalists.length > 1) {
            ambiguousMatches.push({
              line,
              url,
              typeIds: finalists.map((candidate) => candidate.typeId),
            });
            continue;
          }
          matchedTypeIds.add(best.typeId);
        } else {
          unknownLines.push(line);
        }
      }

      if (ambiguousMatches.length > 0) {
        const choiceMap = new Map<string, string>();
        for (const match of ambiguousMatches) {
          const key = match.typeIds.join("|");
          if (choiceMap.has(key)) {
            matchedTypeIds.add(choiceMap.get(key)!);
            continue;
          }
          const labels = match.typeIds.map((id, index) => {
            const def = resolveNodeTypeDef(id, nodeTypeCatalog);
            return `${index + 1}. ${def?.label ?? id}`;
          });
          const answer = window.prompt(
            `Multiple node types match this endpoint:\n${match.url}\n\n${labels.join(
              "\n",
            )}\n\nEnter a number, or Cancel to leave it unresolved.`,
            "1",
          );
          if (answer == null) {
            unknownLines.push(match.line);
            continue;
          }
          const selectedIndex = Number(answer) - 1;
          const selected = match.typeIds[selectedIndex];
          if (!selected) {
            unknownLines.push(match.line);
            continue;
          }
          choiceMap.set(key, selected);
          matchedTypeIds.add(selected);
        }
      }

      // Don't create a duplicate node when one with that type already
      // exists in the diagram — repeated imports should be idempotent.
      const existingTypes = new Set(doc.nodes.map((n) => n.type));
      const typesToCreate = [...matchedTypeIds].filter(
        (t) => !existingTypes.has(t),
      );

      // Lay new nodes out in a grid below/to-the-right of the densest area
      // of the existing diagram so they don't overlap whatever's there.
      let baseX = 200;
      let baseY = 200;
      if (doc.nodes.length > 0) {
        const maxY = Math.max(...doc.nodes.map((n) => n.position.y));
        baseY = Math.round(maxY) + 200;
      }
      const COLS = 4;
      const DX = 200;
      const DY = 150;
      typesToCreate.forEach((typeId, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const created = createNode({
          x: baseX + col * DX,
          y: baseY + row * DY,
        });
        // Mirror what NodeDetails.onTypeChange does for predefined types
        // so ServiceTreeId / EndpointRegex come from the def.
        const def = resolveNodeTypeDef(typeId, nodeTypeCatalog);
        updateNode(created.id, {
          type: typeId,
          title: def?.label ?? typeId,
          serviceTreeId: def?.serviceTreeId ?? "",
          endpointRegex: def?.endpointRegex ?? "",
        });
        // Nodes are only valid inside a scenario; attach to the active
        // one so the imported node is immediately visible and editable.
        if (activeScenarioId) {
          addNodeToScenario(activeScenarioId, created.id);
        }
      });

      // Save unknown endpoints to a sibling .txt file and let the user
      // know — they may want to add new node-type definitions for those.
      if (unknownLines.length > 0) {
        const base = f.name.replace(/\.[^.]+$/, "");
        const unknownName = `${base}_unknown.txt`;
        const blob = new Blob([unknownLines.join("\n") + "\n"], {
          type: "text/plain",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = unknownName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.alert(
          `Imported ${typesToCreate.length} new node type${
            typesToCreate.length === 1 ? "" : "s"
          } (${matchedTypeIds.size} matched in total).\n\n${
            unknownLines.length
          } endpoint${
            unknownLines.length === 1 ? "" : "s"
          } did not match any known node type. They have been saved to "${unknownName}" in your downloads.`
        );
      } else {
        window.alert(
          `Imported ${typesToCreate.length} new node type${
            typesToCreate.length === 1 ? "" : "s"
          } (${matchedTypeIds.size} matched in total). All endpoints recognized.`
        );
      }
    } catch (err) {
      window.alert(`Failed to import endpoints: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
      restoreFileCommandFocus();
    }
  };

  const onImportTmcClick = () => {
    setOpenMenu(null);
    // TMC import REPLACES the current document (matching Open's behavior).
    // Confirm when there is meaningful work to lose so we don't silently
    // blow away the user's diagram.
    const hasContent =
      doc.scenarios.length > 0 || doc.nodes.length > 0 || doc.edges.length > 0 ||
      (doc.textAnnotations?.length ?? 0) > 0;
    if (hasContent) {
      const ok = window.confirm(
        "Importing scenario/DFD JSON will REPLACE the current diagram " +
          "(undoable with Ctrl+Z). This command requires the supported " +
          '"scenarios" and "dfds" structure, not arbitrary JSON. ' +
          "Use File > Open for native model JSON. Continue?",
      );
      if (!ok) {
        restoreFileCommandFocus();
        return;
      }
    }
    tmcFileRef.current?.click();
  };

  const onTmcFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new TmcImportError(
          `File is not valid JSON: ${(err as Error).message}`,
        );
      }
      const result = importTmcExport(parsed);
      // Hand off to the existing import path so snapshot()/active-scenario
      // wiring is identical to Open's. The wrapped {doc, view} shape is the
      // documented v2 contract importJson knows how to consume.
      importJson({
        format: SECURE_DESIGN_STUDIO_DOCUMENT_FORMAT,
        version: 2,
        doc: result.doc,
        view: {
          activeScenarioId: result.activeScenarioId,
          filter: { text: "", nodeType: "", authType: "", dataClassification: "" },
        },
      });

      const s = result.summary;
      const lines = [
        `Imported ${s.scenarioCount} scenario${
          s.scenarioCount === 1 ? "" : "s"
        } from scenario/DFD JSON.`,
        `Nodes: ${s.uniqueNodeCount} unique source instances (from ${s.rawNodeInstanceCount} records).`,
        `Boundaries: ${s.boundaryCount}.`,
        `Edges: ${s.edgeCount}.`,
      ];
      if (s.splitEdgeCount > 0) {
        lines.push(
          `Split ${s.splitEdgeCount} multi-numbered label${
            s.splitEdgeCount === 1 ? "" : "s"
          } into separate edges.`,
        );
      }
      if (s.skippedFreetextCount > 0) {
        lines.push(
          `Skipped ${s.skippedFreetextCount} freetext annotation${
            s.skippedFreetextCount === 1 ? "" : "s"
          } (this external importer does not map them to native canvas text).`,
        );
      }
      if (s.skippedUnresolvedEdgeCount > 0) {
        lines.push(
          `Skipped ${s.skippedUnresolvedEdgeCount} edge${
            s.skippedUnresolvedEdgeCount === 1 ? "" : "s"
          } whose source/target was a freetext, boundary, or unknown id.`,
        );
      }
      if (s.scenariosWithoutDiagramCount > 0) {
        lines.push(
          `${s.scenariosWithoutDiagramCount} scenario${
            s.scenariosWithoutDiagramCount === 1 ? "" : "s"
          } had no diagram and were imported empty.`,
        );
      }
      if (s.diagramsWithoutScenarioCount > 0) {
        lines.push(
          `${s.diagramsWithoutScenarioCount} diagram${
            s.diagramsWithoutScenarioCount === 1 ? "" : "s"
          } in the export had no matching scenario and were ignored.`,
        );
      }
      window.alert(lines.join("\n"));
    } catch (err) {
      if (err instanceof TmcImportError) {
        window.alert(`Failed to import JSON format: ${err.message}`);
      } else {
        window.alert(`Failed to import JSON format: ${(err as Error).message}`);
      }
    } finally {
      e.target.value = "";
      restoreFileCommandFocus();
    }
  };

  const onImportTm7Click = () => {
    setOpenMenu(null);
    // Confirm only after parsing, so replacement consent includes actual losses.
    tm7FileRef.current?.click();
  };

  const onTm7FileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const result = parseTm7(text);
      const s = result.summary;
      const lines = [
        `Import ${s.scenarioCount} scenario${
          s.scenarioCount === 1 ? "" : "s"
        } from TM7 (${s.surfaceCount} drawing surface${
          s.surfaceCount === 1 ? "" : "s"
        }).`,
        `Nodes: ${s.nodeCount}.  Edges: ${s.edgeCount}.  Boundaries: ${s.boundaryCount}.  Text annotations: ${s.annotationCount}.`,
      ];
      if (s.skippedAnnotationCount > 0) {
        lines.push(
          `Skipped ${s.skippedAnnotationCount} free-text annotation${
            s.skippedAnnotationCount === 1 ? "" : "s"
          } (unsupported native annotation shape).`,
        );
      }
      if (s.skippedLineBoundaryCount > 0) {
        lines.push(
          `Skipped ${s.skippedLineBoundaryCount} line boundar${
            s.skippedLineBoundaryCount === 1 ? "y" : "ies"
          } (SecureDesignStudio boundaries are rectangular).`,
        );
      }
      if (s.skippedDanglingEdgeCount > 0) {
        lines.push(
          `Skipped ${s.skippedDanglingEdgeCount} edge${
            s.skippedDanglingEdgeCount === 1 ? "" : "s"
          } with explicitly unattached endpoints; details and label preservation are listed below.`,
        );
      }
      lines.push(
        "",
        "Supported native DFD roles and per-tab node scope are mapped. Service types remain blank; assign them in Properties.",
        ...result.diagnostics.map(message => `- ${message}`),
        "",
        "Keep the original TM7 and save a .tma copy of the current diagram. Unsupported content is not retained.",
        "REPLACE the current diagram (undoable with Ctrl+Z)?",
      );
      if (!window.confirm(lines.join("\n"))) return;
      importJson({
        format: SECURE_DESIGN_STUDIO_DOCUMENT_FORMAT,
        version: 2,
        doc: result.doc,
        view: {
          activeScenarioId: result.activeScenarioId,
          filter: { text: "", nodeType: "", authType: "", dataClassification: "" },
        },
      });
    } catch (err) {
      if (err instanceof Tm7ImportError) {
        window.alert(`Failed to import TM7 file: ${err.message}`);
      } else {
        window.alert(`Failed to import TM7 file: ${(err as Error).message}`);
      }
    } finally {
      e.target.value = "";
      restoreFileCommandFocus();
    }
  };

  const onImportPrivacyManagerClick = () => {
    setOpenMenu(null);
    if (doc.scenarios.length === 0) {
      restoreFileCommandFocus();
      return;
    }
    pmFileRef.current?.click();
  };

  // Reads a .pmexp file, parses it, computes auto-mappings, and either
  // opens the dialog (when there are unmapped services) or runs the import
  // immediately (when every service auto-mapped).
  const onPmFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) {
      return;
    }
    let openedMappingDialog = false;
    try {
      const text = await f.text();
      const parsed = parsePrivExp(text);
      if (parsed.groups.length === 0) {
        window.alert(
          "No services with data items were found in this PMEXP file.",
        );
        return;
      }

      // Auto-match by serviceTreeId (normalized trim+lowercase) only when
      // exactly one node has that id — multiple matches require a user
      // decision in the dialog.
      const nodesByCanonicalSid = new Map<string, string[]>();
      for (const n of doc.nodes) {
        const sid = (n.serviceTreeId ?? "").trim().toLowerCase();
        if (!sid) continue;
        const list = nodesByCanonicalSid.get(sid) ?? [];
        list.push(n.id);
        nodesByCanonicalSid.set(sid, list);
      }
      const autoMapped: Record<string, string> = {};
      for (const g of parsed.groups) {
        if (!g.canonicalServiceId) continue;
        const matches = nodesByCanonicalSid.get(g.canonicalServiceId);
        if (matches && matches.length === 1) {
          autoMapped[g.key] = matches[0];
        }
      }

      const hasUnmapped = parsed.groups.some(
        (g) => !(g.key in autoMapped),
      );
      if (!hasUnmapped) {
        // Nothing to ask the user; merge directly.
        const decisions: Record<string, import("../store").ServiceImportDecision> = {};
        for (const [k, nodeId] of Object.entries(autoMapped)) {
          decisions[k] = { kind: "use-existing", nodeId };
        }
        const summary = importPrivacyManagerData(parsed, decisions);
        showPmImportSummary(parsed, summary);
        return;
      }

      setPmImportState({ parsed, autoMappedNodeByService: autoMapped });
      openedMappingDialog = true;
    } catch (err) {
      window.alert(
        `Failed to import PMEXP file: ${(err as Error).message}`,
      );
    } finally {
      e.target.value = "";
      if (!openedMappingDialog) restoreFileCommandFocus();
    }
  };

  // Shared post-import summary alert (used by both the no-dialog and
  // dialog-confirm paths).
  const showPmImportSummary = (
    parsed: ParsedPrivExp,
    summary: import("../store").ImportPrivacyManagerSummary,
  ) => {
    const lines = [
      `Imported ${parsed.recordCount} record${
        parsed.recordCount === 1 ? "" : "s"
      } from the PMEXP file.`,
      `Services: ${summary.servicesMapped} mapped to existing, ${summary.servicesCreated} created, ${summary.servicesIgnored} ignored.`,
      `Data items: ${summary.dataItemsCreated} created, ${summary.dataItemsReused} reused.`,
      `Attachments: ${summary.attachmentsAdded} added across scenarios` +
        (summary.attachmentsSkipped > 0
          ? `, ${summary.attachmentsSkipped} skipped (already present).`
          : "."),
    ];
    if (parsed.unknownClassificationCount > 0) {
      lines.push(
        `${parsed.unknownClassificationCount} record${
          parsed.unknownClassificationCount === 1 ? "" : "s"
        } had an unrecognized classification and were imported as "Other".`,
      );
    }
    lines.push("Use Ctrl+Z to undo.");
    window.alert(lines.join("\n"));
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed: unknown = JSON.parse(text);
      importJson(parsed);
      setDocumentFileName(normalizeTmaFileName(f.name));
    } catch (err) {
      window.alert(`Failed to import JSON: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
      restoreFileCommandFocus();
    }
  };

  const onCompareClick = () => {
    // Pure show/hide toggle for the cached comparison's right-panel
    // visibility. Loading a fresh comparison is now done from the File
    // Operations menu; this button only appears once a comparison has
    // been loaded.
    setDiffViewOpen(!diffViewOpen);
  };

  const onLoadCompareClick = () => {
    setOpenMenu(null);
    compareFileRef.current?.click();
  };

  // Build a "#room=…&key=…" URL the user can share with another browser
  // and write it to the clipboard. Generates a fresh room id + AES-GCM
  // key on first invocation; subsequent invocations (while still in the
  // same room) just re-copy the same URL so the user can paste it again.
  //
  // For the SWA build we anchor the share URL at the current location.
  // For the standalone-HTML build the current location is a `file://`
  // path, which the recipient can't load — so we anchor at the publicly
  // hosted version of the app (baked in at build time as
  // __PS_PUBLIC_APP_URL__). The recipient opens *that* URL in their
  // browser and immediately joins the room.
  const onShare = async () => {
    if (!SERVICES.collaboration.enabled) return;
    let roomId: string;
    let key: string;
    if (collab.room) {
      // Already in a room — recover params from the URL hash so the
      // copied link matches what was originally distributed. If the
      // hash was stripped somehow, regenerate fresh credentials and
      // rejoin to keep the share link well-formed.
      const params = new URLSearchParams(location.hash.replace(/^#/, ""));
      roomId = params.get("room") ?? collab.room;
      const k = params.get("key");
      if (!k) {
        // Hash was clobbered — start a fresh room rather than copy an
        // unusable link.
        leaveRoom();
        roomId = uid("room");
        key = generateKey();
        joinRoom(roomId, key, { seed: true });
      } else {
        key = k;
      }
    } else {
      roomId = uid("room");
      key = generateKey();
      joinRoom(roomId, key, { seed: true });
    }
    const baseUrl = __PS_SINGLE_FILE__
      ? SERVICES.shareAppUrl
      : `${location.origin}${location.pathname}`;
    const url = `${baseUrl}#room=${encodeURIComponent(
      roomId
    )}&key=${encodeURIComponent(key)}`;
    try {
      // history.replaceState fails on file:// in some browsers — fine,
      // the share link is still going to the clipboard either way. We
      // skip it entirely in single-file builds because the share URL
      // doesn't match the current location anyway.
      if (!__PS_SINGLE_FILE__) {
        history.replaceState(null, "", url);
      }
    } catch {
      // ignore
    }
    try {
      await navigator.clipboard.writeText(url);
      const isEdge = /\bEdg\//.test(navigator.userAgent);
      const browserNotice = __PS_SINGLE_FILE__
        ? isEdge
          ? "\n\nNote: Microsoft Edge's tracking prevention can block the live connection when the app is opened from a file:// path. To host this session, please open this file in Google Chrome or in an Edge InPrivate window. Recipients who follow your share link open the configured hosted app."
          : "\n\nNote: if your browser blocks the live connection when running from a file:// path, open this file in Google Chrome or in an Edge InPrivate window. Recipients who follow your share link are unaffected."
        : "";
      window.alert(
        (__PS_SINGLE_FILE__
          ? "Share link copied to clipboard. The link opens the configured hosted app — anyone with it will join your collaborative session."
          : "Share link copied to clipboard. Anyone with this link will join your collaborative session.") +
          browserNotice
      );
    } catch {
      window.prompt("Copy this link and share it:", url);
    }
  };

  const onLeaveRoom = () => {
    leaveRoom();
    // Remove the hash so a refresh doesn't auto-rejoin.
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      // ignore
    }
  };

  const collabLabel = (() => {
    switch (collab.status) {
      case "disabled":
        return "Disabled";
      case "connecting":
        return "Connecting…";
      case "connected":
        return "Live";
      case "error":
        return "Error";
      case "idle":
      default:
        return null;
    }
  })();

  const filterOptions = useMemo(() => {
    const scopedNodeIds = activeScenario
      ? new Set(activeScenario.nodeIds)
      : null;
    const scopedEdgeIds = activeScenario
      ? new Set(activeScenario.edgeIds)
      : null;
    const nodeTypeIds = new Set(
      doc.nodes
        .filter((node) => !scopedNodeIds || scopedNodeIds.has(node.id))
        .map((node) => node.type),
    );
    const scopedEdges = doc.edges.filter(
      (edge) => !scopedEdgeIds || scopedEdgeIds.has(edge.id),
    );
    const authTypeIds = new Set<string>(
      scopedEdges.flatMap((edge) => edge.authenticationTypes ?? []),
    );
    const attachedDataIds = new Set<string>();
    const scenarios = activeScenario ? [activeScenario] : doc.scenarios;
    const includedEdgeIds = new Set(scopedEdges.map((edge) => edge.id));
    for (const scenario of scenarios) {
      for (const edgeId of scenario.edgeIds) {
        if (!includedEdgeIds.has(edgeId)) continue;
        for (const dataId of scenario.edgeRequestData[edgeId] ?? []) {
          attachedDataIds.add(dataId);
        }
        for (const dataId of scenario.edgeResponseData[edgeId] ?? []) {
          attachedDataIds.add(dataId);
        }
      }
    }
    const dataClassificationIds = new Set<string>(
      doc.data
        .filter((data) => attachedDataIds.has(data.id))
        .map((data) => data.classification),
    );

    return {
      nodeTypes: doc.nodeTypes.filter((type) => nodeTypeIds.has(type.id)),
      authTypes: authenticationCatalog.filter((type) => authTypeIds.has(type.id)),
      dataClassifications: Array.from(dataClassificationIds, (id) => ({
        id, label: dataClassificationLabel(id, doc.catalogDefinitions, classificationDefinitions),
      })),
    };
  }, [
    activeScenario,
    authenticationCatalog,
    doc.data,
    doc.edges,
    doc.nodes,
    doc.nodeTypes,
    doc.scenarios,
    doc.catalogDefinitions,
    classificationDefinitions,
  ]);

  const nodeTypeFilterGroups = Object.entries(
    filterOptions.nodeTypes.reduce<Record<string, typeof doc.nodeTypes>>(
      (groups, type) => {
        const source =
          resolveNodeTypeDef(type.id, doc.nodeTypes)?.catalogSource ?? "Custom";
        (groups[source] ??= []).push(type);
        return groups;
      },
      {},
    ),
  ).sort(([a], [b]) => a.localeCompare(b));

  const onCompareFileChosen = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed: unknown = JSON.parse(text);
      if (parsed == null || typeof parsed !== "object") {
        throw new Error(
          "File is not a valid SecureDesignStudio JSON document.",
        );
      }
      const obj = parsed as Record<string, unknown>;
      // Support both the v2 wrapped shape ({ doc, view }) and a raw doc.
      const docPart =
        "doc" in obj && obj.doc && typeof obj.doc === "object"
          ? (obj.doc as Record<string, unknown>)
          : obj;
      const prevDoc = normalizeDoc(docPart);
      const changes = diffDocuments(prevDoc, doc, availableCatalogDefinitions, inventoryField.label);
      loadDiff(changes, f.name);
      openInspector("changes", commandTriggerRef.current);
    } catch (err) {
      window.alert(`Failed to compare: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
      restoreFileCommandFocus();
    }
  };

  const activeFilterCount = [
    filter.text,
    filter.nodeType,
    filter.authType,
    filter.dataClassification,
  ].filter(Boolean).length;

  const showInspectorTab = (tab: InspectorTab) => {
    setAllCommentsViewOpen(tab === "comments");
    setAllIssuesViewOpen(tab === "issues");
    setDiffViewOpen(tab === "changes");
    openInspector(tab, commandTriggerRef.current);
  };

  const duplicateActiveScenario = () => {
    if (!activeScenario) return;
    const clone = cloneScenario(
      activeScenario.id,
      `${activeScenario.name} copy`,
      activeScenario.description,
    );
    if (clone) setActiveScenarioId(clone.id);
  };

  const restoreCommandFocus = (controlsId = commandReturnControlsRef.current) => {
    if (!controlsId) return;
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          `button[aria-controls="${controlsId}"]`,
        )
        ?.focus();
      if (commandReturnControlsRef.current === controlsId) {
        commandReturnControlsRef.current = null;
        commandTriggerRef.current = null;
      }
    }, 0);
  };

  const executeCommand = (id: CommandId) => {
    if (authenticationLibraryOpen || classificationLibraryOpen || customLibrariesOpen) return;
    const returnControlsId =
      commandMenu != null ? `ps-command-menu-${commandMenu}` : null;
    closeCommandMenu();
    let restoreFocus = true;
    switch (id) {
      case "file.new":
        onNew();
        break;
      case "file.open":
        restoreFocus = false;
        onUploadClick();
        break;
      case "file.save":
        onDownload();
        break;
      case "file.saveAs":
        restoreFocus = false;
        onSaveAs();
        break;
      case "file.compare":
        restoreFocus = false;
        onLoadCompareClick();
        break;
      case "file.importTmc":
        restoreFocus = false;
        onImportTmcClick();
        break;
      case "file.importTm7":
        restoreFocus = false;
        onImportTm7Click();
        break;
      case "file.importPrivacyManager":
        restoreFocus = false;
        onImportPrivacyManagerClick();
        break;
      case "file.importEndpoints":
        restoreFocus = false;
        onImportEndpointsClick();
        break;
      case "file.exportTm7":
        onExportTm7();
        break;
      case "file.exportVsdx":
        restoreFocus = false;
        onExportVsdx();
        break;
      case "file.exportImage":
        restoreFocus = false;
        void onExportImage();
        break;
      case "file.exportReport":
        restoreFocus = false;
        void onExportReport();
        break;
      case "file.exportStandalone":
        if (__PS_SINGLE_FILE__) onExportStandaloneHtml();
        break;
      case "scenario.new":
        restoreFocus = false;
        onNewScenario();
        break;
      case "scenario.duplicate":
        duplicateActiveScenario();
        break;
      case "scenario.settings":
        restoreFocus = false;
        setSelection(null);
        showInspectorTab("properties");
        break;
      case "scenario.delete":
        restoreFocus = false;
        if (activeScenario) setScenarioToDelete(activeScenario.id);
        break;
      case "model.catalog":
        restoreFocus = false;
        setNodeTypeCatalogOpen(true);
        break;
      case "model.annotation": {
        restoreFocus = false;
        const annotation = createTextAnnotation({ x: 100, y: 100 });
        setSelection({ kind: "annotation", id: annotation.id });
        setFocusTarget({ kind: "annotation", id: annotation.id });
        setViewMode("graph");
        showInspectorTab("properties");
        break;
      }
      case "model.authentication":
        restoreFocus = false;
        setAuthenticationLibraryOpen(true);
        break;
      case "model.classifications":
        restoreFocus = false;
        setClassificationLibraryOpen(true);
        break;
      case "model.customLibraries":
        restoreFocus = false;
        setCustomLibrariesOpen(true);
        break;
      case "model.data":
        restoreFocus = false;
        showInspectorTab("data");
        break;
      case "model.work":
        restoreFocus = false;
        showInspectorTab("work");
        break;
      case "review.analyze":
        restoreFocus = false;
        onAnalyze();
        break;
      case "assistant.open":
        restoreFocus = false;
        showInspectorTab("assistant");
        break;
      case "review.issues":
        restoreFocus = false;
        showInspectorTab("issues");
        break;
      case "review.comments":
        restoreFocus = false;
        showInspectorTab("comments");
        break;
      case "review.deviations":
        restoreFocus = false;
        showInspectorTab("deviations");
        break;
      case "review.changes":
        restoreFocus = false;
        if (diffFileName) showInspectorTab("changes");
        break;
      case "view.graph":
        setViewMode("graph");
        break;
      case "view.sequence":
        setViewMode("sequence");
        break;
      case "view.inspector":
        restoreFocus = false;
        toggleInspector(commandTriggerRef.current);
        break;
      case "view.properties":
        restoreFocus = false;
        showInspectorTab("properties");
        break;
      case "view.edges":
        restoreFocus = false;
        showInspectorTab("edges");
        break;
      case "preferences.autosave.500":
      case "preferences.autosave.2000":
      case "preferences.autosave.5000":
      case "preferences.autosave.15000":
        setAutosaveIntervalMs(Number(id.split(".").at(-1)));
        break;
      case "preferences.reset":
        resetPreferences();
        resetDetailsTab();
        break;
      case "canvas.fitView":
        setViewMode("graph");
        requestFitView();
        break;
      case "history.undo":
        undo();
        break;
      case "history.redo":
        redo();
        break;
      case "collaboration.share":
        restoreFocus = false;
        if (SERVICES.collaboration.enabled) void onShare();
        break;
      case "collaboration.leave":
        onLeaveRoom();
        break;
      case "app.about":
        restoreFocus = false;
        setAboutOpen(true);
        break;
    }
    if (restoreFocus) restoreCommandFocus(returnControlsId);
  };
  commandRef.current = executeCommand;

  const applyFilters = () => {
    setFilter(filterDraft);
    closeCommandMenu();
    restoreCommandFocus("ps-command-menu-filter");
  };

  const clearFilters = () => {
    clearFilter();
    setFilterDraft({
      text: "",
      nodeType: "",
      authType: "",
      dataClassification: "",
    });
  };

  const restoreDeleteScenarioFocus = () => {
    restoreCommandFocus("ps-command-menu-model");
  };

  const cancelDeleteScenario = () => {
    setScenarioToDelete(null);
    restoreDeleteScenarioFocus();
  };

  const confirmDeleteScenario = () => {
    if (scenarioToDelete) deleteScenario(scenarioToDelete);
    setScenarioToDelete(null);
    requestAnimationFrame(() =>
      document.getElementById("ps-command-scenario-select")?.focus(),
    );
  };

  return (
    <>
    <header className="ps-toolbar ps-command-bar" ref={commandBarRef}>
      <div className="ps-command-row">
        <div
          className="ps-command-brand"
          aria-label="SecureDesignStudio"
        >
          <img
            className="ps-command-brand-mark"
            src={secureDesignStudioLogo}
            alt=""
            aria-hidden="true"
          />
          <span className="ps-command-brand-copy">
            <strong>
              SecureDesignStudio
              <span className="ps-command-version">v{__PS_VERSION__}</span>
            </strong>
            <span>Privacy &amp; security designer</span>
          </span>
        </div>

        <nav
          className="ps-command-nav"
          aria-label="SecureDesignStudio commands"
        >
          <div className="ps-command-menu-wrap">
            <button
              type="button"
              className="ps-command-domain"
              aria-haspopup="menu"
              aria-expanded={commandMenu === "file"}
              aria-controls="ps-command-menu-file"
              onClick={(event) =>
                openCommandMenu("file", event.currentTarget)
              }
              onKeyDown={(event) => onCommandTriggerKeyDown(event, "file")}
            >
              File
            </button>
            {commandMenu === "file" && (
              <div
                id="ps-command-menu-file"
                className="ps-command-menu"
                role="menu"
                data-ps-temporary-surface="true"
                onKeyDown={onCommandMenuKeyDown}
              >
                <button role="menuitem" onClick={() => executeCommand("file.new")}>
                  <span>New</span><kbd>Ctrl+N</kbd>
                </button>
                <button role="menuitem" onClick={() => executeCommand("file.open")}>
                  <span>Open…</span><kbd>Ctrl+O</kbd>
                </button>
                <button role="menuitem" onClick={() => executeCommand("file.save")}>
                  <span>Save</span><kbd>Ctrl+S</kbd>
                </button>
                <div className="ps-command-menu-label">Save as</div>
                <button role="menuitem" onClick={() => executeCommand("file.saveAs")}>
                  SecureDesignStudio model (.tma)
                </button>
                <button role="menuitem" onClick={() => executeCommand("file.exportTm7")}>
                  Microsoft Threat Modeling Tool (.tm7)…
                </button>
                <button role="menuitem" onClick={() => executeCommand("file.exportVsdx")}>
                  Microsoft Visio (.vsdx)…
                </button>
                {__PS_SINGLE_FILE__ && (
                  <button
                    role="menuitem"
                    onClick={() => executeCommand("file.exportStandalone")}
                  >
                    Standalone HTML…
                  </button>
                )}
                <div className="ps-command-menu-label">Import</div>
                <button role="menuitem" onClick={() => executeCommand("file.importTmc")}
                  title={'Import a local scenario/DFD JSON file with the supported "scenarios" and "dfds" structure. Not arbitrary JSON; use File > Open for native models. No sign-in or optional library required.'}>
                  Import JSON format…
                </button>
                <button role="menuitem" onClick={() => executeCommand("file.importTm7")}>
                  Threat Modeling Tool (.tm7)…
                </button>
                <button
                  role="menuitem"
                  disabled={doc.scenarios.length === 0}
                  onClick={() => executeCommand("file.importPrivacyManager")}
                  title={doc.scenarios.length === 0
                    ? "Create or open a diagram with at least one scenario first."
                    : "Merge a local PMEXP inventory file (.pmexp) into the current diagram. No sign-in or service lookup."}
                >
                  PMEXP import…
                </button>
                <button
                  role="menuitem"
                  disabled={!activeScenarioId}
                  onClick={() => executeCommand("file.importEndpoints")}
                >
                  Endpoints text…
                </button>
                <div className="ps-command-menu-separator" />
                <button role="menuitem" onClick={() => executeCommand("file.compare")}>
                  {diffFileName
                    ? "Compare to previous… (replace)"
                    : "Compare to previous…"}
                </button>
              </div>
            )}
          </div>

          <div className="ps-command-menu-wrap ps-command-domain-secondary">
            <button
              type="button"
              className="ps-command-domain"
              aria-haspopup="menu"
              aria-expanded={commandMenu === "model"}
              aria-controls="ps-command-menu-model"
              onClick={(event) =>
                openCommandMenu("model", event.currentTarget)
              }
              onKeyDown={(event) => onCommandTriggerKeyDown(event, "model")}
            >
              Model
            </button>
            {commandMenu === "model" && (
              <div
                id="ps-command-menu-model"
                className="ps-command-menu"
                role="menu"
                data-ps-temporary-surface="true"
                onKeyDown={onCommandMenuKeyDown}
              >
                <button role="menuitem" onClick={() => executeCommand("model.catalog")}>
                  <span>Node Type Catalog</span>
                  <small>{nodeTypeCatalog.length} types</small>
                </button>
                <button role="menuitem" onClick={() => executeCommand("model.annotation")}>
                  <span>New text annotation</span>
                </button>
                <button role="menuitem" aria-label="Customize authentication" aria-describedby="ps-auth-command-hint" onClick={() => executeCommand("model.authentication")}>
                  <span>Customize authentication</span>
                  <small id="ps-auth-command-hint">Authentication Library for this browser profile</small>
                </button>
                <button role="menuitem" aria-label="Customize classifications" onClick={() => executeCommand("model.classifications")}>
                  <span>Customize classifications</span>
                  <small>Classification Library for this browser profile</small>
                </button>
                <button role="menuitem" onClick={() => executeCommand("model.customLibraries")}>
                  Custom Libraries
                </button>
                <button role="menuitem" onClick={() => executeCommand("model.data")}>
                  <span>Data Elements</span>
                  <small>{doc.data.length} reusable items</small>
                </button>
                <button role="menuitem" onClick={() => executeCommand("model.work")}>
                  <span>Work Items</span>
                  <small>{doc.workItems.length} actions</small>
                </button>
                <div className="ps-command-menu-label">Scenario</div>
                <button role="menuitem" onClick={() => executeCommand("scenario.new")}>
                  New scenario…
                </button>
                <button
                  role="menuitem"
                  disabled={!activeScenario}
                  onClick={() => executeCommand("scenario.duplicate")}
                >
                  Duplicate current scenario
                </button>
                <button
                  role="menuitem"
                  disabled={!activeScenario}
                  onClick={() => executeCommand("scenario.settings")}
                >
                  Scenario settings
                </button>
                <button
                  role="menuitem"
                  className="ps-command-destructive"
                  disabled={!activeScenario}
                  onClick={() => executeCommand("scenario.delete")}
                >
                  Delete current scenario…
                </button>
                <div className="ps-command-menu-separator" />
                <button
                  role="menuitem"
                  disabled={!activeScenarioId}
                  onClick={() => executeCommand("file.importEndpoints")}
                >
                  <span>Endpoint matching</span>
                  <small>File import remains under File</small>
                </button>
              </div>
            )}
          </div>

          <div className="ps-command-menu-wrap ps-command-domain-secondary">
            <button
              type="button"
              className="ps-command-domain"
              aria-haspopup="menu"
              aria-expanded={commandMenu === "review"}
              aria-controls="ps-command-menu-review"
              onClick={(event) =>
                openCommandMenu("review", event.currentTarget)
              }
              onKeyDown={(event) => onCommandTriggerKeyDown(event, "review")}
            >
              Review
            </button>
            {commandMenu === "review" && (
              <div
                id="ps-command-menu-review"
                className="ps-command-menu"
                role="menu"
                data-ps-temporary-surface="true"
                onKeyDown={onCommandMenuKeyDown}
              >
                <button role="menuitem" onClick={() => executeCommand("review.analyze")}>
                  Analyze
                </button>
                <button role="menuitem" onClick={() => executeCommand("assistant.open")}>
                  Design Assistant
                </button>
                <div className="ps-command-menu-separator" />
                <button role="menuitem" onClick={() => executeCommand("review.issues")}>
                  <span>Issues</span><span className="ps-command-count">{doc.issues.length}</span>
                </button>
                <button role="menuitem" onClick={() => executeCommand("review.comments")}>
                  <span>Comments</span><span className="ps-command-count">{doc.comments.length}</span>
                </button>
                {doc.deviations.length > 0 && (
                  <button role="menuitem" onClick={() => executeCommand("review.deviations")}>
                    <span>Deviations</span><span className="ps-command-count">{doc.deviations.length}</span>
                  </button>
                )}
                <button
                  role="menuitem"
                  disabled={!diffFileName}
                  onClick={() => executeCommand("review.changes")}
                >
                  <span>Changes</span><span className="ps-command-count">{diffChanges.length}</span>
                </button>
                <button role="menuitem" onClick={() => executeCommand("file.compare")}>
                  Compare to previous…
                </button>
              </div>
            )}
          </div>

          <div className="ps-command-menu-wrap ps-command-domain-secondary">
            <button
              type="button"
              className="ps-command-domain"
              aria-haspopup="menu"
              aria-expanded={commandMenu === "view"}
              aria-controls="ps-command-menu-view"
              onClick={(event) => openCommandMenu("view", event.currentTarget)}
              onKeyDown={(event) => onCommandTriggerKeyDown(event, "view")}
            >
              View
            </button>
            {commandMenu === "view" && (
              <div
                id="ps-command-menu-view"
                className="ps-command-menu"
                role="menu"
                data-ps-temporary-surface="true"
                onKeyDown={onCommandMenuKeyDown}
              >
                <button
                  role="menuitemradio"
                  aria-checked={viewMode === "graph"}
                  onClick={() => executeCommand("view.graph")}
                >
                  {viewMode === "graph" ? "✓ " : ""}Diagram
                </button>
                <button
                  role="menuitemradio"
                  aria-checked={viewMode === "sequence"}
                  onClick={() => executeCommand("view.sequence")}
                >
                  {viewMode === "sequence" ? "✓ " : ""}Sequence
                </button>
                <div className="ps-command-menu-separator" />
                <button
                  role="menuitemcheckbox"
                  aria-checked={inspectorVisible}
                  onClick={() => executeCommand("view.inspector")}
                >
                  {inspectorVisible ? "✓ " : ""}Inspector
                </button>
                <div className="ps-command-menu-label">Open panel</div>
                <button role="menuitem" onClick={() => executeCommand("view.properties")}>
                  Properties
                </button>
                <button role="menuitem" onClick={() => executeCommand("view.edges")}>
                  Edge list
                </button>
                <button role="menuitem" onClick={() => executeCommand("review.issues")}>
                  Issues
                </button>
                <button role="menuitem" onClick={() => executeCommand("review.comments")}>
                  Comments
                </button>
                {doc.deviations.length > 0 && (
                  <button role="menuitem" onClick={() => executeCommand("review.deviations")}>
                    Deviations
                  </button>
                )}
                {diffFileName && (
                  <button role="menuitem" onClick={() => executeCommand("review.changes")}>
                    Changes
                  </button>
                )}
                <div className="ps-command-menu-separator" />
                <button role="menuitem" onClick={() => executeCommand("canvas.fitView")}>
                  Fit model to view
                </button>
                <div className="ps-command-menu-label">Auto-save interval</div>
                {AUTOSAVE_INTERVAL_OPTIONS.map((intervalMs) => (
                  <button
                    key={intervalMs}
                    role="menuitemradio"
                    aria-checked={autosaveIntervalMs === intervalMs}
                    onClick={() =>
                      executeCommand(`preferences.autosave.${intervalMs}` as CommandId)
                    }
                  >
                    {autosaveIntervalMs === intervalMs ? "✓ " : ""}
                    {intervalMs === 500 ? "0.5 seconds" : `${intervalMs / 1000} seconds`}
                  </button>
                ))}
                <div className="ps-command-menu-separator" />
                <button role="menuitem" onClick={() => executeCommand("preferences.reset")}>
                  Reset all preferences
                </button>
              </div>
            )}
          </div>

          <div className="ps-command-menu-wrap ps-command-domain-secondary ps-command-filter-domain">
            <button
              type="button"
              className={`ps-command-domain ${activeFilterCount > 0 ? "is-active" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={commandMenu === "filter"}
              aria-controls="ps-command-menu-filter"
              aria-label={
                activeFilterCount > 0
                  ? `Filter, ${activeFilterCount} active`
                  : "Filter, none active"
              }
              onClick={(event) =>
                openCommandMenu("filter", event.currentTarget)
              }
              onKeyDown={(event) => onCommandTriggerKeyDown(event, "filter")}
            >
              Filter
              {activeFilterCount > 0 && (
                <span className="ps-command-count">{activeFilterCount}</span>
              )}
            </button>
            {commandMenu === "filter" && (
              <div
                id="ps-command-menu-filter"
                className="ps-command-menu ps-filter-popover"
                role="dialog"
                aria-modal="false"
                aria-labelledby="ps-filter-title"
                data-ps-temporary-surface="true"
              >
                <div className="ps-filter-header">
                  <div>
                    <h2 id="ps-filter-title">Filter model</h2>
                    <p>Changes are staged until Apply.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close filters"
                    onClick={() => {
                      closeCommandMenu();
                      restoreCommandFocus("ps-command-menu-filter");
                    }}
                  >
                    ×
                  </button>
                </div>
                <label>
                  Search
                  <input
                    type="search"
                    value={filterDraft.text}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        text: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyFilters();
                      }
                    }}
                    autoFocus
                  />
                </label>
                <label>
                  Node type
                  <select
                    value={filterDraft.nodeType}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        nodeType: event.target.value,
                      }))
                    }
                  >
                    <option value="">Any node type</option>
                    {nodeTypeFilterGroups.map(([category, types]) => (
                      <optgroup key={category} label={category}>
                        {[...types]
                          .sort((a, b) => a.label.localeCompare(b.label))
                          .map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  Authentication type
                  <select
                    value={filterDraft.authType}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        authType: event.target.value as FilterState["authType"],
                      }))
                    }
                  >
                    <option value="">Any authentication</option>
                    {[...filterOptions.authTypes]
                      .sort((a, b) => a.label.localeCompare(b.label))
                      .map((auth) => (
                        <option key={auth.id} value={auth.id}>{auth.label}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Data classification
                  <select
                    value={filterDraft.dataClassification}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        dataClassification:
                          event.target.value as FilterState["dataClassification"],
                      }))
                    }
                  >
                    <option value="">Any classification</option>
                    {filterDraft.dataClassification && !filterOptions.dataClassifications.some((c) => c.id === filterDraft.dataClassification) && (
                      <option value={filterDraft.dataClassification}>{dataClassificationLabel(filterDraft.dataClassification, doc.catalogDefinitions, classificationDefinitions)}</option>
                    )}
                    {[...filterOptions.dataClassifications]
                      .sort((a, b) => a.label.localeCompare(b.label))
                      .map((classification) => (
                        <option key={classification.id} value={classification.id}>
                          {classification.label}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="ps-filter-summary">
                  {[
                    filterDraft.text,
                    filterDraft.nodeType,
                    filterDraft.authType,
                    filterDraft.dataClassification,
                  ].filter(Boolean).length}{" "}
                  staged · {activeFilterCount} active
                </div>
                <div className="ps-filter-actions">
                  <button type="button" onClick={clearFilters}>Clear all</button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterDraft(filter);
                      closeCommandMenu();
                      restoreCommandFocus("ps-command-menu-filter");
                    }}
                  >
                    Cancel
                  </button>
                  <button type="button" className="ps-command-primary" onClick={applyFilters}>
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="ps-command-domain ps-command-domain-secondary"
            onClick={(event) => {
              commandTriggerRef.current = event.currentTarget;
              executeCommand("app.about");
            }}
          >
            About
          </button>

          <span className="ps-command-section-separator" aria-hidden="true" />

        <div className="ps-command-scenario">
          <label htmlFor="ps-command-scenario-select">Scenario</label>
          <select
            id="ps-command-scenario-select"
            aria-label="Scenario"
            value={activeScenarioId ?? ""}
            onChange={(event) =>
              setActiveScenarioId(event.target.value || null)
            }
          >
            <option value="">(Show all)</option>
            {[...doc.scenarios]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
          </select>
        </div>

        <div className="ps-command-view-switch" role="group" aria-label="Model view">
          <button
            type="button"
            className={viewMode === "graph" ? "is-active" : ""}
            aria-pressed={viewMode === "graph"}
            onClick={() => executeCommand("view.graph")}
            title="Show the data-flow diagram"
          >
            Diagram
          </button>
          <button
            type="button"
            className={viewMode === "sequence" ? "is-active" : ""}
            aria-pressed={viewMode === "sequence"}
            onClick={() => executeCommand("view.sequence")}
            title="Show the scenario as a sequence diagram"
          >
            Sequence
          </button>
        </div>

        <div className="ps-command-history" aria-label="History">
          <button
            type="button"
            className="ps-command-icon"
            disabled={!canUndo}
            onClick={() => executeCommand("history.undo")}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="ps-command-icon"
            disabled={!canRedo}
            onClick={() => executeCommand("history.redo")}
            aria-label="Redo"
            title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
          >
            ↷
          </button>
        </div>

        <div className="ps-command-quick-actions" aria-label="Quick actions">
          <button
            type="button"
            className={
              inspectorVisible && inspectorActiveTab === "issues"
                ? "is-active"
                : undefined
            }
            onClick={(event) => {
              commandTriggerRef.current = event.currentTarget;
              executeCommand("review.analyze");
            }}
            title="Analyze the current model for security and privacy issues"
          >
            <span className="ps-analyze-mark" aria-hidden="true">
              <span />
            </span>
            Analyze
          </button>
          <button
            type="button"
            onClick={(event) => {
              commandTriggerRef.current = event.currentTarget;
              executeCommand("review.issues");
            }}
            title="Open analyzer and manually reported issues"
          >
            Issues <span className="ps-command-quick-count">{doc.issues.length}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              commandTriggerRef.current = event.currentTarget;
              executeCommand("review.comments");
            }}
            title="Open reviewer comments"
          >
            Comments <span className="ps-command-quick-count">{doc.comments.length}</span>
          </button>
          {doc.deviations.length > 0 && (
            <button
              type="button"
              onClick={(event) => {
                commandTriggerRef.current = event.currentTarget;
                executeCommand("review.deviations");
              }}
              title="Open evidence-backed model deviations"
            >
              Deviations <span className="ps-command-quick-count">{doc.deviations.length}</span>
            </button>
          )}
          <button
            type="button"
            className={
              inspectorVisible && inspectorActiveTab === "assistant"
                ? "is-active"
                : undefined
            }
            onClick={(event) => {
              commandTriggerRef.current = event.currentTarget;
              executeCommand("assistant.open");
            }}
            title="Open Design Assistant"
          >
            <span className="ps-assistant-mark" aria-hidden="true">
              <span>✦</span>
              <span>✦</span>
            </span>
            Design Assistant
          </button>
        </div>

        <div className="ps-command-menu-wrap ps-command-export-wrap">
          <button
            type="button"
            className="ps-command-export"
            aria-haspopup="menu"
            aria-expanded={commandMenu === "export"}
            aria-controls="ps-command-menu-export"
            onClick={(event) => openCommandMenu("export", event.currentTarget)}
            onKeyDown={(event) => onCommandTriggerKeyDown(event, "export")}
          >
            <span className="ps-export-mark" aria-hidden="true">
              <span />
            </span>
            Export
          </button>
          {commandMenu === "export" && (
            <div
              id="ps-command-menu-export"
              className="ps-command-menu ps-command-menu-right"
              role="menu"
              data-ps-temporary-surface="true"
              onKeyDown={onCommandMenuKeyDown}
            >
              <button
                role="menuitem"
                disabled={!activeScenario || viewMode !== "graph"}
                onClick={() => executeCommand("file.exportImage")}
              >
                Diagram image (.png)…
              </button>
              <button
                role="menuitem"
                disabled={!activeScenario}
                onClick={() => executeCommand("file.exportReport")}
              >
                Review report (.html)…
              </button>
            </div>
          )}
        </div>

        {(authenticationWarnings.length > 0 || authenticationStorageError) && (
          <button
            type="button"
            className="ps-command-domain ps-auth-warning-trigger"
            aria-haspopup="dialog"
            title="Review authentication definitions and library storage warnings"
            onClick={() => executeCommand("model.authentication")}
          >
            Authentication warnings ({authenticationWarnings.length + (authenticationStorageError ? 1 : 0)})
          </button>
        )}

        {!__PS_LOCAL_ONLY__ && (
        <div className="ps-command-menu-wrap ps-command-status-wrap">
          <button
            type="button"
            className="ps-command-status"
            title={SERVICES.collaboration.enabled
              ? `Collaboration token service: ${SERVICES.collaboration.endpoint}`
              : SERVICES.collaboration.message}
            aria-haspopup="menu"
            aria-expanded={commandMenu === "collaboration"}
            aria-controls="ps-command-menu-collaboration"
            onClick={(event) =>
              openCommandMenu("collaboration", event.currentTarget)
            }
            onKeyDown={(event) =>
              onCommandTriggerKeyDown(event, "collaboration")
            }
          >
            <span
              className={`ps-command-status-dot ps-command-status-${__PS_LOCAL_ONLY__ ? "local" : collab.status}`}
              aria-hidden="true"
            />
            <span>
              {__PS_LOCAL_ONLY__ ? "Local" : collabLabel ?? "Offline"}
            </span>
          </button>
          {commandMenu === "collaboration" && (
            <div
              id="ps-command-menu-collaboration"
              className="ps-command-menu ps-command-menu-right"
              role="menu"
              data-ps-temporary-surface="true"
              onKeyDown={onCommandMenuKeyDown}
            >
              {!SERVICES.collaboration.enabled ? (
                <div className="ps-command-menu-message">
                  {SERVICES.collaboration.message} This model remains in your browser.
                </div>
              ) : (
                <>
                  {collab.errorDetail && <div className="ps-command-menu-message" role="alert">{collab.errorDetail}</div>}
                  <button
                    role="menuitem"
                    onClick={() => executeCommand("collaboration.share")}
                  >
                    {collab.room
                      ? "Copy collaboration link"
                      : "Start collaboration"}
                  </button>
                  {collab.room && (
                    <button
                      role="menuitem"
                      className="ps-command-destructive"
                      onClick={() => executeCommand("collaboration.leave")}
                    >
                      Leave session
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        )}

        <div className="ps-command-menu-wrap ps-command-settings-wrap">
          <button
            type="button"
            className="ps-command-settings"
            title="Settings"
            aria-haspopup="menu"
            aria-expanded={commandMenu === "settings"}
            aria-controls="ps-command-menu-settings"
            onClick={(event) => openCommandMenu("settings", event.currentTarget)}
            onKeyDown={(event) => onCommandTriggerKeyDown(event, "settings")}
          >
            <span className="ps-command-settings-mark" aria-hidden="true">⚙</span>
            <span>Settings</span>
          </button>
          {commandMenu === "settings" && (
            <div
              id="ps-command-menu-settings"
              className="ps-command-menu ps-command-menu-right"
              role="menu"
              data-ps-temporary-surface="true"
              onKeyDown={onCommandMenuKeyDown}
            >
              <button
                role="menuitemcheckbox"
                aria-checked={darkTheme}
                onClick={() => setDarkTheme(!darkTheme)}
              >
                {darkTheme ? "✓ " : ""}Dark Theme
              </button>
              <div className="ps-command-menu-separator" />
              <div className="ps-command-menu-label">Auto-save interval</div>
              {AUTOSAVE_INTERVAL_OPTIONS.map((intervalMs) => (
                <button
                  key={intervalMs}
                  role="menuitemradio"
                  aria-checked={autosaveIntervalMs === intervalMs}
                  onClick={() =>
                    executeCommand(`preferences.autosave.${intervalMs}` as CommandId)
                  }
                >
                  {autosaveIntervalMs === intervalMs ? "✓ " : ""}
                  {intervalMs === 500 ? "0.5 seconds" : `${intervalMs / 1000} seconds`}
                </button>
              ))}
              <div className="ps-command-menu-separator" />
              <button role="menuitem" onClick={() => executeCommand("preferences.reset")}>
                Reset all preferences
              </button>
            </div>
          )}
        </div>
        </nav>
      </div>

     <div className="ps-toolbar-row ps-toolbar-legacy" aria-hidden="true">
      <span className="ps-toolbar-brand">SecureDesignStudio</span>

      <div
      className="ps-toolbar-row ps-toolbar-command-row"
      role="toolbar"
      aria-label="Diagram commands"
      >
      <div className="ps-dropdown">
        <button
          ref={fileTriggerRef}
          className="ps-file-menu-trigger"
          onClick={() => toggleMenu("file")}
          title="Create, open, save, import, or export a diagram"
          aria-haspopup="menu"
          aria-expanded={fileOpsOpen}
          aria-keyshortcuts="Alt+F"
        >
          File
        </button>
        {fileOpsOpen && (
          <div
            ref={fileOpsMenuRef}
            className="ps-dropdown-menu ps-file-menu"
            role="menu"
            aria-label="File"
            onKeyDown={onMenuKeyDown}
          >
            <button
              role="menuitem"
              onClick={onNew}
              aria-keyshortcuts="Control+N Meta+N"
            >
              <span>New</span>
              <span className="ps-menu-shortcut">Ctrl+N</span>
            </button>
            <button
              role="menuitem"
              onClick={onUploadClick}
              aria-keyshortcuts="Control+O Meta+O"
            >
              <span>Open…</span>
              <span className="ps-menu-shortcut">Ctrl+O</span>
            </button>
            <button
              role="menuitem"
              onClick={onDownload}
              aria-keyshortcuts="Control+S Meta+S"
            >
              <span>Save</span>
              <span className="ps-menu-shortcut">Ctrl+S</span>
            </button>
            <button
              role="menuitem"
              onClick={onSaveAs}
              aria-keyshortcuts="Control+Shift+S Meta+Shift+S"
            >
              <span>Save as…</span>
              <span className="ps-menu-shortcut">Ctrl+Shift+S</span>
            </button>

            <div className="ps-menu-separator" role="separator" />

            <button role="menuitem" onClick={onLoadCompareClick}>
              <span>
                {diffChanges.length > 0
                  ? "Compare to previous… (replace)"
                  : "Compare to previous…"}
              </span>
            </button>

            <div className="ps-menu-separator" role="separator" />
            <div className="ps-menu-section-label" role="presentation">
              Import
            </div>
            <button role="menuitem" onClick={onImportTmcClick}
              title={'Import a local scenario/DFD JSON file with the supported "scenarios" and "dfds" structure. Not arbitrary JSON; use File > Open for native models. No sign-in or optional library required.'}>
              <span>Import JSON format…</span>
            </button>
            <button role="menuitem" onClick={onImportTm7Click}>
              <span>From TM7…</span>
            </button>
            <button
              role="menuitem"
              onClick={onImportPrivacyManagerClick}
              disabled={doc.scenarios.length === 0}
              title={
                doc.scenarios.length === 0
                  ? "Create or open a diagram with at least one scenario first."
                  : "Merge a local PMEXP inventory file (.pmexp) into the current diagram. No sign-in or service lookup."
              }
            >
              <span>PMEXP import…</span>
            </button>
            <button
              role="menuitem"
              onClick={onImportEndpointsClick}
              disabled={!activeScenarioId}
              title={
                activeScenarioId
                  ? "Import nodes by matching an endpoint list against known node types."
                  : "Create or select a scenario first."
              }
            >
              <span>Nodes from endpoints…</span>
            </button>

            <div className="ps-menu-separator" role="separator" />
            <div className="ps-menu-section-label" role="presentation">
              Export
            </div>
            <button role="menuitem" onClick={onExportTm7}>
              <span>Microsoft Threat Modeling Tool (.tm7)</span>
            </button>
            <button role="menuitem" onClick={onExportVsdx}>
              <span>Microsoft Visio (.vsdx)</span>
            </button>
            {!import.meta.env.DEV && __PS_SINGLE_FILE__ && (
              <button role="menuitem" onClick={onExportStandaloneHtml}>
                <span>Standalone HTML</span>
              </button>
            )}
          </div>
        )}
      </div>

      <span className="ps-toolbar-sep" aria-hidden="true" />

      <button
        className="ps-toolbar-icon"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        className="ps-toolbar-icon"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        ↷
      </button>

      <span className="ps-toolbar-sep" aria-hidden="true" />

      <label className="ps-inline">
        <span className="ps-toolbar-hint">Scenario</span>
        <select
          value={activeScenarioId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new__") {
              e.currentTarget.value = activeScenarioId ?? "";
              onNewScenario();
              return;
            }
            setActiveScenarioId(v === "" ? null : v);
          }}
          aria-label="Active scenario"
        >
          <option value="">Show all</option>
          {[...doc.scenarios]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          <option value="__new__">Add new scenario…</option>
        </select>
      </label>

      <button
        onClick={onAnalyze}
        title="Propagate edge data to nodes and refresh analyzer findings"
      >
        Analyze
      </button>

      <button
        onClick={() => setNodeTypeCatalogOpen(true)}
        title="Create, edit, import, or export document node types"
      >
        Manage Node Types ({doc.nodeTypes.length})
      </button>
      <button
        onClick={() => setDataModalOpen(true)}
        title="Manage data items"
      >
        Manage Data Elements ({doc.data.length})
      </button>
      <button
        onClick={() => setWorkItemsModalOpen(true)}
        title="Manage security work items"
      >
        Manage Work Items ({doc.workItems.length})
      </button>
      <div className="ps-dropdown">
        <button
          ref={modelTriggerRef}
          onClick={() => toggleMenu("model")}
          aria-haspopup="menu"
          aria-expanded={modelOpen}
        >
          Model
        </button>
        {modelOpen && (
          <div
            ref={modelMenuRef}
            className="ps-dropdown-menu"
            role="menu"
            aria-label="Model"
            onKeyDown={onMenuKeyDown}
          >
            <button role="menuitem" onClick={() => {
              setOpenMenu(null);
              commandTriggerRef.current = modelTriggerRef.current;
              executeCommand("model.classifications");
            }}>Customize classifications</button>
            <button role="menuitem" onClick={() => {
              setOpenMenu(null);
              commandTriggerRef.current = modelTriggerRef.current;
              executeCommand("model.customLibraries");
            }}>Custom Libraries</button>
            <button
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                setDataModalOpen(true);
              }}
            >
              <span>Data elements</span>
              <span className="ps-menu-count">{doc.data.length}</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                setWorkItemsModalOpen(true);
              }}
            >
              <span>Work items</span>
              <span className="ps-menu-count">{doc.workItems.length}</span>
            </button>
          </div>
        )}
      </div>

      <div className="ps-dropdown">
        <button
          ref={reviewTriggerRef}
          onClick={() => toggleMenu("review")}
          aria-haspopup="menu"
          aria-expanded={reviewOpen}
          className={
            allCommentsViewOpen || allIssuesViewOpen || diffViewOpen
              ? "ps-toolbar-active"
              : ""
          }
        >
          Review
        </button>
        {reviewOpen && (
          <div
            ref={reviewMenuRef}
            className="ps-dropdown-menu"
            role="menu"
            aria-label="Review"
            onKeyDown={onMenuKeyDown}
          >
            <button
              role="menuitemcheckbox"
              aria-checked={allCommentsViewOpen}
              onClick={() => {
                setAllCommentsViewOpen(!allCommentsViewOpen);
                setOpenMenu(null);
              }}
            >
              <span>{allCommentsViewOpen ? "✓ " : ""}Comments</span>
              <span className="ps-menu-count">{doc.comments.length}</span>
            </button>
            <button
              role="menuitemcheckbox"
              aria-checked={allIssuesViewOpen}
              onClick={() => {
                setAllIssuesViewOpen(!allIssuesViewOpen);
                setOpenMenu(null);
              }}
            >
              <span>{allIssuesViewOpen ? "✓ " : ""}Issues</span>
              <span className="ps-menu-count">{doc.issues.length}</span>
            </button>
            {diffChanges.length > 0 && (
              <button
                role="menuitemcheckbox"
                aria-checked={diffViewOpen}
                onClick={() => {
                  onCompareClick();
                  setOpenMenu(null);
                }}
              >
                <span>{diffViewOpen ? "✓ " : ""}Changes vs previous</span>
                <span className="ps-menu-count">{diffChanges.length}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="ps-dropdown">
        <button
          ref={viewTriggerRef}
          onClick={() => toggleMenu("view")}
          aria-haspopup="menu"
          aria-expanded={viewOptionsOpen}
        >
          View
        </button>
        {viewOptionsOpen && (
          <div
            ref={viewOptionsMenuRef}
            className="ps-dropdown-menu"
            role="menu"
            aria-label="View"
            onKeyDown={onMenuKeyDown}
          >
            <button
              role="menuitemradio"
              aria-checked={viewMode === "graph"}
              onClick={() => {
                setViewMode("graph");
                setOpenMenu(null);
              }}
            >
              <span>{viewMode === "graph" ? "✓ " : ""}Graph</span>
            </button>
            <button
              role="menuitemradio"
              aria-checked={viewMode === "sequence"}
              onClick={() => {
                setViewMode("sequence");
                setOpenMenu(null);
              }}
            >
              <span>
                {viewMode === "sequence" ? "✓ " : ""}Sequence diagram
              </span>
            </button>
          </div>
        )}
      </div>

      <span className="ps-toolbar-spacer" />

      <span className="ps-toolbar-status" aria-live="polite">
        {doc.nodes.length} nodes · {doc.edges.length} flows
      </span>
      </div>
      </div>

      <input
        id="ps-file-open-input"
        type="file"
        accept=".tma"
        ref={fileRef}
        onChange={onFileChosen}
        style={{ display: "none" }}
      />
      <input
        id="ps-file-compare-input"
        type="file"
        accept=".tma"
        ref={compareFileRef}
        onChange={onCompareFileChosen}
        style={{ display: "none" }}
      />
      <input
        id="ps-endpoints-import-input"
        type="file"
        accept=".txt,text/plain"
        ref={endpointsFileRef}
        onChange={onEndpointsFileChosen}
        style={{ display: "none" }}
      />
      <input
        id="ps-tmc-import-input"
        type="file"
        aria-label="Choose a supported scenario/DFD JSON file"
        accept="application/json,.json"
        ref={tmcFileRef}
        onChange={onTmcFileChosen}
        style={{ display: "none" }}
      />
      <input
        id="ps-tm7-import-input"
        type="file"
        accept=".tm7,application/xml,text/xml"
        ref={tm7FileRef}
        onChange={onTm7FileChosen}
        style={{ display: "none" }}
      />
      <input
        id="ps-privacy-manager-import-input"
        type="file"
        aria-label="Choose a PMEXP file"
        accept=".pmexp"
        ref={pmFileRef}
        onChange={onPmFileChosen}
        style={{ display: "none" }}
      />

     <div
       className="ps-toolbar-row ps-toolbar-row-filters ps-toolbar-legacy"
       aria-hidden="true"
     >
      <div className="ps-toolbar-filter">
        <span className="ps-toolbar-hint">Filters</span>
        <input
          type="search"
          placeholder="Filter…"
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
        />
        <select
          value={filter.nodeType}
          onChange={(e) => setFilter({ nodeType: e.target.value })}
          title="Filter by node type"
        >
          <option value="">Node Type</option>
          {nodeTypeFilterGroups.map(([category, types]) => (
            <optgroup key={category} label={category}>
              {[...types]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <select
          value={filter.authType}
          onChange={(e) =>
            setFilter({ authType: e.target.value as typeof filter.authType })
          }
          title="Filter by authentication type"
        >
          <option value="">Auth Type</option>
          {[...filterOptions.authTypes]
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
        </select>
        <select
          value={filter.dataClassification}
          onChange={(e) =>
            setFilter({
              dataClassification:
                e.target.value as typeof filter.dataClassification,
            })
          }
          title="Filter by data classification"
        >
          <option value="">Data Classification</option>
          {filter.dataClassification && !filterOptions.dataClassifications.some((c) => c.id === filter.dataClassification) && (
            <option value={filter.dataClassification}>{dataClassificationLabel(filter.dataClassification, doc.catalogDefinitions, classificationDefinitions)}</option>
          )}
          {[...filterOptions.dataClassifications]
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </select>
        <button
          className="ps-toolbar-icon"
          onClick={clearFilter}
          title="Clear filters"
          aria-label="Clear filters"
        >
          ✕
        </button>
      </div>
     </div>
    </header>
    <CatalogDefinitionsNotice />
    {classificationStorageError && (
      <p className="ps-catalog-error ps-classification-library-status" role="alert">{classificationStorageError}</p>
    )}
    {saveAsOpen && (
      <SaveAsDialog
        initialFileName={documentFileName}
        onCancel={() => {
          setSaveAsOpen(false);
          restoreCommandFocus();
        }}
        onSave={(fileName) => {
          const normalized = normalizeTmaFileName(fileName);
          if (!downloadTma(normalized)) return;
          setDocumentFileName(normalized);
          setSaveAsOpen(false);
          restoreCommandFocus();
        }}
      />
    )}
    {aboutOpen && (
      <AboutDialog
        onClose={() => {
          setAboutOpen(false);
          const trigger = commandTriggerRef.current;
          requestAnimationFrame(() => trigger?.focus());
        }}
      />
    )}
    {customLibrariesOpen && <AboutDialog showLibraries onClose={() => {
      setCustomLibrariesOpen(false);
      restoreCommandFocus("ps-command-menu-model");
    }} />}
    {nodeTypeCatalogOpen && (
      <NodeTypeCatalogModal
        onClose={() => {
          setNodeTypeCatalogOpen(false);
          restoreCommandFocus();
        }}
      />
    )}
    {authenticationLibraryOpen && (
      <AuthenticationLibraryModal
        onClose={() => {
          setAuthenticationLibraryOpen(false);
          restoreCommandFocus("ps-command-menu-model");
        }}
      />
    )}
    {classificationLibraryOpen && (
      <ClassificationLibraryModal onClose={() => {
        setClassificationLibraryOpen(false);
        restoreCommandFocus("ps-command-menu-model");
      }} />
    )}
    {dataModalOpen && <DataModal onClose={() => setDataModalOpen(false)} />}
    {workItemsModalOpen && (
      <WorkItemsModal onClose={() => setWorkItemsModalOpen(false)} />
    )}
    {!authenticationLibraryOpen && !classificationLibraryOpen && !customLibrariesOpen && (newScenarioOpen || doc.scenarios.length === 0) && (
      <NewScenarioDialog
        defaultName={`Scenario ${doc.scenarios.length + 1}`}
        sourceOptions={doc.scenarios.map((s) => ({ id: s.id, name: s.name }))}
        required={doc.scenarios.length === 0}
        onCancel={() => {
          setNewScenarioOpen(false);
          restoreCommandFocus();
        }}
        onSubmit={onCreateScenarioFromDialog}
      />
    )}
    {pmImportState && (
      <PrivacyManagerImportDialog
        parsed={pmImportState.parsed}
        autoMappedNodeByService={pmImportState.autoMappedNodeByService}
        candidateNodes={doc.nodes}
        onCancel={() => {
          setPmImportState(null);
          restoreCommandFocus();
        }}
        onConfirm={(decisions) => {
          const { parsed } = pmImportState;
          setPmImportState(null);
          const summary = importPrivacyManagerData(parsed, decisions);
          showPmImportSummary(parsed, summary);
          restoreCommandFocus();
        }}
      />
    )}
    {vsdxNoticeOpen && (
      <VsdxExportNoticeDialog
        onClose={() => {
          setVsdxNoticeOpen(false);
          restoreCommandFocus();
        }}
      />
    )}
    {endpointsDialogOpen && (
      <ImportEndpointsDialog
        onCancel={() => {
          setEndpointsDialogOpen(false);
          restoreCommandFocus();
        }}
        onChooseFile={() => {
          setEndpointsDialogOpen(false);
          endpointsFileRef.current?.click();
        }}
      />
    )}
    {scenarioToDelete && (
      <DeleteScenarioDialog
        scenarioId={scenarioToDelete}
        onCancel={cancelDeleteScenario}
        onConfirm={confirmDeleteScenario}
      />
    )}
    </>
  );
}
