import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useUiShell, type InspectorPresentation } from "../uiShell";
import { FindingsExportButton } from "./FindingsExportButton";

type Frame = { left: number; top: number; width: number; height: number };
type ScrollPlace = { element: HTMLElement; top: number; left: number; finding?: string; offset?: number };
type ReviewPlace = {
  scroll: ScrollPlace[];
  focus: HTMLElement | null;
  caret?: { start: number; end: number; direction: "forward" | "backward" | "none" };
};

function textControl(element: HTMLElement | null): element is HTMLInputElement | HTMLTextAreaElement {
  return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA";
}

export function clampAssistantFrame(frame: Frame, viewport: { width: number; height: number }): Frame {
  const maxWidth = Math.max(1, viewport.width - 16);
  const maxHeight = Math.max(1, viewport.height - 88);
  const width = Math.min(maxWidth, Math.max(Math.min(320, maxWidth), frame.width));
  const height = Math.min(maxHeight, Math.max(Math.min(260, maxHeight), frame.height));
  return {
    width, height,
    left: Math.max(8, Math.min(viewport.width - width - 8, frame.left)),
    top: Math.max(8, Math.min(viewport.height - height - 80, frame.top)),
  };
}

export function InspectorSurface({ children, className = "", dockWidth }: {
  children: ReactNode; className?: string; dockWidth: number;
}) {
  const {
    inspectorVisible, inspectorActiveTab, openInspector, inspectorHostRef,
    inspectorPresentation: mode, setInspectorPresentation: setMode,
  } = useUiShell();
  const modeRef = useRef<InspectorPresentation>(mode);
  modeRef.current = mode;
  const [error, setError] = useState("");
  const [frame, setFrame] = useState<Frame>(() => clampAssistantFrame({
    left: window.innerWidth - 924, top: 24, width: 900, height: 700,
  }, { width: window.innerWidth, height: window.innerHeight }));
  // Move one portal container so every tab keeps its editors and reading position.
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "ps-assistant-surface-slot";
    return element;
  });
  const parking = useRef<HTMLDivElement>(null);
  const floatingLayer = useRef<HTMLDivElement>(null);
  const popup = useRef<Window | null>(null);
  const popupCleanup = useRef<(() => void) | null>(null);
  const gestureCleanup = useRef<(() => void) | null>(null);
  const currentTab = useRef(inspectorActiveTab);
  currentTab.current = inspectorActiveTab;
  const savedPlace = useRef<ReviewPlace>({ scroll: [], focus: null });
  const restoreTicket = useRef(0);
  const popupSize = useRef({ width: 1000, height: 760 });

  const capturePlace = (): ReviewPlace => {
    const scrollers = [...host.querySelectorAll<HTMLElement>("*")]
      .filter(element => element.clientHeight > 0 && (
        element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
        || element.hasAttribute("data-assistant-scroll")
      ));
    if (!scrollers.length) return savedPlace.current;
    const active = host.ownerDocument.activeElement;
    const focus = active && host.contains(active) && "focus" in active && typeof active.focus === "function"
      ? active as HTMLElement : null;
    const scroll = new Map(savedPlace.current.scroll
      .filter(saved => host.contains(saved.element)).map(saved => [saved.element, saved]));
    for (const element of scrollers) {
      const bounds = element.getBoundingClientRect();
      const anchor = [...element.querySelectorAll<HTMLElement>("[data-finding-id]")]
        .find(row => row.getBoundingClientRect().bottom > bounds.top && row.getBoundingClientRect().top < bounds.bottom);
      scroll.set(element, {
        element, top: element.scrollTop, left: element.scrollLeft,
        ...(anchor ? { finding: anchor.dataset.findingId, offset: anchor.getBoundingClientRect().top - bounds.top } : {}),
      });
    }
    const place: ReviewPlace = { focus, scroll: [...scroll.values()] };
    if (textControl(focus) && typeof focus.selectionStart === "number" && typeof focus.selectionEnd === "number") {
      place.caret = { start: focus.selectionStart, end: focus.selectionEnd, direction: focus.selectionDirection ?? "none" };
    }
    savedPlace.current = place;
    return place;
  };

  const restorePlace = (place: ReviewPlace, restoreFocus = true) => {
    for (const saved of place.scroll) {
      const element = saved.element;
      if (!host.contains(element) || !element.clientHeight) continue;
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
      const anchor = saved.finding
        ? [...element.querySelectorAll<HTMLElement>("[data-finding-id]")].find(row => row.dataset.findingId === saved.finding)
        : undefined;
      if (anchor) element.scrollTop += anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - (saved.offset ?? 0);
    }
    if (restoreFocus && place.focus?.isConnected && host.contains(place.focus)) {
      const focus = place.focus.matches(":disabled")
        ? host.querySelector<HTMLElement>(".ps-assistant-window-actions button:not(:disabled)") : place.focus;
      focus?.focus({ preventScroll: true });
      if (focus === place.focus && place.caret && textControl(place.focus)) {
        place.focus.setSelectionRange(place.caret.start, place.caret.end, place.caret.direction);
      }
    }
    savedPlace.current = place;
  };

  const moveHost = (target: HTMLElement, place = capturePlace()) => {
    if (host.parentElement === target) return;
    const ticket = ++restoreTicket.current;
    target.appendChild(host);
    const view = target.ownerDocument.defaultView;
    view?.requestAnimationFrame(() => view.requestAnimationFrame(() => {
      if (ticket === restoreTicket.current) restorePlace(place);
    }));
  };

  const releasePopup = () => {
    const previous = popup.current;
    popup.current = null;
    popupCleanup.current?.();
    popupCleanup.current = null;
    if (previous && !previous.closed) previous.close();
  };

  const dock = () => {
    const target = parking.current;
    if (target) moveHost(target);
    releasePopup();
    gestureCleanup.current?.();
    openInspector(currentTab.current);
    setMode("docked");
    setError("");
  };

  const float = () => {
    if (!floatingLayer.current) return;
    gestureCleanup.current?.();
    setFrame(current => clampAssistantFrame(current, { width: window.innerWidth, height: window.innerHeight }));
    moveHost(floatingLayer.current);
    releasePopup();
    setMode("floating");
    setError("");
    window.focus();
  };

  const openWindow = () => {
    gestureCleanup.current?.();
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    if (popup.current) dock();
    const place = capturePlace();
    let opened: Window | null;
    try {
      opened = window.open("", "_blank",
        `popup=yes,resizable=yes,width=${popupSize.current.width},height=${popupSize.current.height}`);
    } catch (cause) {
      setError(`The separate window could not open. Choose Float in this page instead. ${cause instanceof Error ? cause.message : ""}`);
      return;
    }
    if (!opened) {
      setError("The browser blocked the separate window. Allow pop-ups for SecureDesignStudio or choose Float in this page.");
      return;
    }
    try {
      opened.opener = null;
      const child = opened.document;
      child.title = "SecureDesignStudio - Inspector";
      const base = child.createElement("base");
      base.href = new URL(".", document.baseURI).href;
      child.head.appendChild(base);
      const shell = child.createElement("div");
      child.body.appendChild(shell);
      const sourceShell = document.querySelector<HTMLElement>(".ps-shell");
      const syncTheme = () => {
        shell.className = `${sourceShell?.className ?? "ps-shell"} ps-assistant-popup-shell`;
        shell.style.cssText = sourceShell?.style.cssText ?? "";
      };
      syncTheme();
      const ticket = restoreTicket.current + 1;
      const syncStyles = () => {
        child.head.querySelectorAll("[data-assistant-style]").forEach(node => node.remove());
        document.head.querySelectorAll("style, link[rel='stylesheet']").forEach(node => {
          const clone = node.cloneNode(true) as HTMLElement;
          clone.setAttribute("data-assistant-style", "");
          clone.nonce = (node as HTMLElement).nonce;
          if (node instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) {
            clone.href = node.href;
            clone.addEventListener("load", () => {
              if (!opened.closed && ticket === restoreTicket.current) restorePlace(place, false);
            }, { once: true });
          }
          child.head.appendChild(clone);
        });
      };
      syncStyles();
      const styles = new MutationObserver(syncStyles);
      const theme = new MutationObserver(syncTheme);
      let closedCheck: number | undefined;
      const closing = () => {
        if (popup.current !== opened) return;
        const target = parking.current;
        if (target) moveHost(target);
        popup.current = null;
        popupCleanup.current?.();
        popupCleanup.current = null;
        openInspector(currentTab.current);
        setMode("docked");
      };
      const resized = () => {
        const place = savedPlace.current;
        popupSize.current = { width: opened.innerWidth, height: opened.innerHeight };
        opened.requestAnimationFrame(() => { if (!opened.closed) restorePlace(place, false); });
      };
      popupCleanup.current = () => {
        styles.disconnect();
        theme.disconnect();
        if (closedCheck !== undefined) window.clearInterval(closedCheck);
        opened.removeEventListener("beforeunload", closing);
        opened.removeEventListener("pagehide", closing);
        opened.removeEventListener("resize", resized);
      };
      styles.observe(document.head, { subtree: true, childList: true, characterData: true });
      if (sourceShell) theme.observe(sourceShell, { attributes: true, attributeFilter: ["class", "style"] });
      opened.addEventListener("beforeunload", closing);
      opened.addEventListener("pagehide", closing);
      opened.addEventListener("resize", resized);
      closedCheck = window.setInterval(() => { if (opened.closed) closing(); }, 500);
      popup.current = opened;
      moveHost(shell, place);
      setMode("window");
      setError("");
    } catch (cause) {
      if (parking.current && host.ownerDocument !== document) moveHost(parking.current, place);
      releasePopup();
      if (!opened.closed) opened.close();
      openInspector(currentTab.current);
      setMode("docked");
      setError(cause instanceof Error ? cause.message : "The separate inspector window could not be opened.");
    }
  };

  useLayoutEffect(() => {
    inspectorHostRef.current = host;
    if (mode === "docked") {
      const target = parking.current;
      if (target) moveHost(target);
      if (inspectorVisible) restorePlace(savedPlace.current, false);
    }
    if (!inspectorVisible && mode !== "docked") {
      if (parking.current) moveHost(parking.current);
      releasePopup();
      gestureCleanup.current?.();
      setMode("docked");
    }
  }, [inspectorVisible, mode]);

  useLayoutEffect(() => {
    if (inspectorVisible) restorePlace(savedPlace.current, false);
  }, [inspectorActiveTab]);

  useEffect(() => {
    const save = () => { capturePlace(); };
    const interacting = () => { restoreTicket.current++; capturePlace(); };
    host.addEventListener("scroll", save, true);
    host.addEventListener("pointerdown", interacting, true);
    host.addEventListener("keydown", interacting, true);
    host.addEventListener("wheel", interacting, { passive: true });
    const pageClosing = (event: PageTransitionEvent) => {
      if (!event.isTrusted || !popup.current) return;
      const target = parking.current;
      if (target) moveHost(target);
      releasePopup();
      setMode("docked");
    };
    window.addEventListener("pagehide", pageClosing);
    return () => {
      host.removeEventListener("scroll", save, true);
      host.removeEventListener("pointerdown", interacting, true);
      host.removeEventListener("keydown", interacting, true);
      host.removeEventListener("wheel", interacting);
      window.removeEventListener("pagehide", pageClosing);
      gestureCleanup.current?.();
      if (popup.current) {
        if (parking.current) parking.current.appendChild(host);
        releasePopup();
      }
    };
  }, [host]);

  useEffect(() => {
    const resize = () => {
      const place = savedPlace.current;
      if (modeRef.current === "floating") {
        setFrame(current => clampAssistantFrame(current, { width: window.innerWidth, height: window.innerHeight }));
      }
      if (host.ownerDocument === document) requestAnimationFrame(() => restorePlace(place, false));
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const startGesture = (kind: "move" | "resize", event: ReactPointerEvent<HTMLElement>) => {
    if (mode !== "floating" || event.button !== 0) return;
    if (kind === "move" && (event.target as Element).closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    event.stopPropagation();
    gestureCleanup.current?.();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    const start = { x: event.clientX, y: event.clientY, frame };
    const place = capturePlace();
    const move = (pointer: PointerEvent) => setFrame(clampAssistantFrame({
      left: start.frame.left + (kind === "move" ? pointer.clientX - start.x : 0),
      top: start.frame.top + (kind === "move" ? pointer.clientY - start.y : 0),
      width: start.frame.width + (kind === "resize" ? pointer.clientX - start.x : 0),
      height: start.frame.height + (kind === "resize" ? pointer.clientY - start.y : 0),
    }, { width: window.innerWidth, height: window.innerHeight }));
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      gestureCleanup.current = null;
      requestAnimationFrame(() => restorePlace(place, false));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    gestureCleanup.current = finish;
  };

  return <>
    <div className="ps-inspector-dock" hidden={!inspectorVisible || mode !== "docked"} ref={parking} />
    <div ref={floatingLayer} className="ps-assistant-floating-layer" />
    {createPortal(
      <section className={`ps-side${inspectorVisible ? " ps-inspector" : ""} ps-assistant-surface ps-inspector-surface is-${mode} ${className}`}
        role={mode === "docked" ? "region" : "dialog"}
        aria-label="Inspector"
        data-ps-temporary-surface={mode === "floating" ? "true" : undefined}
        style={{
          "--ps-inspector-width": `${dockWidth}px`,
          "--ps-assistant-left": `${frame.left}px`, "--ps-assistant-top": `${frame.top}px`,
          "--ps-assistant-width": `${frame.width}px`, "--ps-assistant-height": `${frame.height}px`,
        } as CSSProperties}
        onKeyDown={event => {
          if (mode !== "docked" && (event.key === "Delete" || event.key === "Backspace")
              && !(event.target as Element).closest("input, textarea, select, [contenteditable='true']")) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (mode !== "docked" && event.key === "Escape" && !event.defaultPrevented
              && (event.target as Element).tagName !== "SELECT") {
            event.preventDefault();
            event.stopPropagation();
            dock();
          }
        }}>
        <header className="ps-assistant-surface-bar" onPointerDown={event => startGesture("move", event)}
          tabIndex={mode === "floating" ? 0 : undefined}
          role={mode === "floating" ? "group" : undefined}
          aria-label={mode === "floating" ? "Move inspector; use arrow keys" : undefined}
          onKeyDown={event => {
            if (mode !== "floating" || event.target !== event.currentTarget || !event.key.startsWith("Arrow")) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 40 : 10;
            setFrame(current => clampAssistantFrame({
              ...current, left: current.left + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
              top: current.top + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
            }, { width: window.innerWidth, height: window.innerHeight }));
          }}>
          {mode !== "docked" && <strong className="ps-assistant-surface-title">Inspector</strong>}
          <div className="ps-assistant-window-actions" role="group" aria-label="Inspector window">
            <select aria-label="Inspector display" value={mode} onChange={event => {
              if (event.target.value === "docked") dock();
              else if (event.target.value === "floating") float();
              else if (event.target.value === "window") openWindow();
            }}>
              <option value="docked">Dock in inspector</option>
              <option value="floating">Float in this page</option>
              <option value="window">Open separate window</option>
            </select>
            <FindingsExportButton compact />
          </div>
        </header>
        {error && <p className="ps-assistant-error" role="alert">{error}</p>}
        <div className="ps-inspector-surface-body">{children}</div>
        {mode === "floating" && <button type="button" className="ps-assistant-resize"
          aria-label="Resize inspector; use arrow keys"
          title="Drag to resize; arrow keys change width and height"
          onPointerDown={event => startGesture("resize", event)}
          onKeyDown={event => {
            if (!event.key.startsWith("Arrow")) return;
            event.preventDefault();
            const place = capturePlace();
            const step = event.shiftKey ? 40 : 10;
            setFrame(current => clampAssistantFrame({
              ...current, width: current.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
              height: current.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
            }, { width: window.innerWidth, height: window.innerHeight }));
            requestAnimationFrame(() => restorePlace(place, false));
          }}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor">
            <path d="M4 13l9-9M8 13l5-5M12 13l1-1" />
          </svg></button>}
      </section>, host, "assistant-panel",
    )}
  </>;
}
