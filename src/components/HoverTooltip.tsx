import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useUiShell } from "../uiShell";

// HoverTooltip wraps a trigger element and shows a portal-rendered tooltip
// just below it on mouse hover or keyboard focus. Designed for hyperlink-rich
// content (the user may want to click links inside the tooltip), so:
//   - The tooltip is positioned directly under the trigger with no visible
//     gap, eliminating the hover dead-zone.
//   - Mouse-leave is debounced ~180ms, and entering the tooltip itself
//     cancels the close timer — so the user can move from trigger → tooltip
//     → click a link without it disappearing.
//   - Scroll/resize while open recomputes the position so the tooltip
//     stays glued to the trigger.
//   - Escape closes; closing also fires on focus/pointer leaving both
//     trigger and tooltip.
//
// The trigger must accept onMouseEnter/Leave/onFocus/onBlur/onKeyDown props.
// For non-interactive triggers (span/div), tabIndex={0} + role="button" are
// added automatically so keyboard users can still discover the description.

const SHOW_DELAY_MS = 200;
const HIDE_DELAY_MS = 180;

interface Props {
  content: ReactNode;
  children: ReactElement;
  // When true (default), if the wrapped child is a non-interactive element,
  // tabIndex=0 and role="button" are merged onto it so keyboard users can
  // focus it and reveal the tooltip.
  makeKeyboardFocusable?: boolean;
}

interface PortalPos {
  top: number;
  left: number;
  maxWidth: number;
}

export function HoverTooltip({
  content,
  children,
  makeKeyboardFocusable = true,
}: Props) {
  const { inspectorPresentation } = useUiShell();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PortalPos>({
    top: 0,
    left: 0,
    maxWidth: 320,
  });
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const ownerDocument = triggerRef.current?.ownerDocument ?? document;
  const ownerWindow = ownerDocument.defaultView ?? window;

  const clearTimers = useCallback(() => {
    if (showTimer.current !== undefined) {
      window.clearTimeout(showTimer.current);
      showTimer.current = undefined;
    }
    if (hideTimer.current !== undefined) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    }
  }, []);

  const scheduleShow = useCallback(() => {
    clearTimers();
    showTimer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }, [clearTimers]);

  const scheduleHide = useCallback(() => {
    clearTimers();
    hideTimer.current = window.setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  }, [clearTimers]);

  // Recompute the tooltip position relative to the trigger. Called on open,
  // on scroll (capture phase, so nested scrollers also trigger), and on
  // resize.
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = el.ownerDocument.defaultView?.innerWidth ?? window.innerWidth;
    const desiredMax = Math.min(360, vw - 16);
    // Clamp left so the tooltip doesn't run off the right edge of the
    // viewport. We can't yet measure the tooltip width here (first frame),
    // so we use the desired max as a worst case.
    const left = Math.max(8, Math.min(r.left, vw - desiredMax - 8));
    setPos({
      top: Math.round(r.bottom), // touching, no dead zone
      left: Math.round(left),
      maxWidth: desiredMax,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const handleScroll = () => reposition();
    const handleResize = () => reposition();
    ownerWindow.addEventListener("scroll", handleScroll, true);
    ownerWindow.addEventListener("resize", handleResize);
    return () => {
      ownerWindow.removeEventListener("scroll", handleScroll, true);
      ownerWindow.removeEventListener("resize", handleResize);
    };
  }, [open, reposition, ownerWindow, inspectorPresentation]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    ownerWindow.addEventListener("keydown", onKey);
    return () => ownerWindow.removeEventListener("keydown", onKey);
  }, [open, ownerWindow]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  if (!isValidElement(children)) return children;

  const childProps = (children as ReactElement).props as Record<string, unknown>;
  const childRef = (children as unknown as { ref?: React.Ref<HTMLElement> })
    .ref;

  // Compose the trigger's existing handlers with the tooltip ones. We never
  // swallow the original — call it first, then ours.
  const setRef = (node: HTMLElement | null) => {
    triggerRef.current = node;
    if (typeof childRef === "function") childRef(node);
    else if (childRef && typeof childRef === "object")
      (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
  };

  const compose =
    <E,>(
      orig: ((e: E) => void) | undefined,
      next: (e: E) => void
    ): ((e: E) => void) =>
    (e) => {
      orig?.(e);
      next(e);
    };

  const extraProps: Record<string, unknown> = {
    ref: setRef,
    onMouseEnter: compose(
      childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined,
      () => scheduleShow()
    ),
    onMouseLeave: compose(
      childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined,
      () => scheduleHide()
    ),
    onFocus: compose(
      childProps.onFocus as ((e: React.FocusEvent) => void) | undefined,
      () => scheduleShow()
    ),
    onBlur: compose(
      childProps.onBlur as ((e: React.FocusEvent) => void) | undefined,
      () => scheduleHide()
    ),
  };

  if (makeKeyboardFocusable && childProps.tabIndex === undefined) {
    extraProps.tabIndex = 0;
  }

  const trigger = cloneElement(children, extraProps);

  const portal =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={tooltipRef}
            className="ps-tooltip"
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
              maxWidth: pos.maxWidth,
            }}
            onMouseEnter={() => clearTimers()}
            onMouseLeave={() => scheduleHide()}
          >
            {content}
          </div>,
          ownerDocument.body
        )
      : null;

  return (
    <>
      {trigger}
      {portal}
    </>
  );
}
