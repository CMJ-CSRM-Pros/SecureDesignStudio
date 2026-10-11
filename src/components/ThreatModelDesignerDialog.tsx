import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DesignTurn } from "../../shared/designContract";
import { askThreatModelDesigner } from "../designAssistant";
import { SERVICES } from "../services";
import { useStore } from "../store";
import { useUiShell } from "../uiShell";
import { useAiProvider } from "../aiProvider";
import { AiProviderSelector } from "./AiProviderSelector";

type Message = DesignTurn & { assumptions?: string[] };

export function ThreatModelDesignerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const aiProvider = useAiProvider();
  const {
    doc, activeScenario, prepareThreatModelDesign, applyThreatModelDesign,
    undo, redo, canUndo, canRedo, setViewMode, filter, clearFilter,
  } = useStore();
  const { requestFitView } = useUiShell();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scenarioRef = useRef(activeScenario?.id ?? null);
  const enabled = aiProvider.ready && (Boolean(activeScenario) || doc.scenarios.length === 0);
  const providerRef = useRef(aiProvider.provider);
  useEffect(() => {
    if (providerRef.current === aiProvider.provider) return;
    providerRef.current = aiProvider.provider;
    setMessages([]);
    setError(null);
    setStatus("AI provider changed. A new design conversation has started.");
  }, [aiProvider.provider]);
  const filtered = Object.values(filter).some(Boolean);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      return;
    }
    if (!expanded || inputRef.current?.disabled) closeRef.current?.focus();
    else inputRef.current?.focus();
    return () => { abortRef.current?.abort(); abortRef.current = null; };
  }, [open]);

  const clampPosition = (next: { x: number; y: number }) => {
    const dialog = dialogRef.current;
    if (!dialog) return next;
    const box = dialog.getBoundingClientRect();
    const headerHeight = Number.parseFloat(getComputedStyle(dialog).getPropertyValue("--ps-command-bar-height")) || 78;
    const minY = headerHeight + 12;
    return {
      x: Math.max(12, Math.min(next.x, window.innerWidth - box.width - 12)),
      y: Math.max(minY, Math.min(next.y, window.innerHeight - box.height - 64)),
    };
  };

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return;
    const keepVisible = () => setPosition(current => {
      if (!current) return current;
      const next = clampPosition(current);
      return current.x === next.x && current.y === next.y ? current : next;
    });
    const observer = new ResizeObserver(keepVisible);
    observer.observe(dialogRef.current);
    const shell = dialogRef.current.closest(".ps-shell");
    const toolbar = shell?.querySelector(".ps-command-bar");
    if (toolbar) observer.observe(toolbar);
    window.addEventListener("resize", keepVisible);
    keepVisible();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepVisible);
      dragRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    const id = activeScenario?.id ?? null;
    if (id === scenarioRef.current) return;
    scenarioRef.current = id;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages([]);
    setQuestion("");
    setError(null);
    setStatus("Scenario changed. A new design conversation has started.");
  }, [activeScenario?.id]);

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, busy, open]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus("Stopped. No pending AI changes were applied.");
    inputRef.current?.focus();
  };
  const close = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    dragRef.current = null;
    onClose();
  };

  const send = async () => {
    const prompt = question.trim();
    if (!open || !prompt || !enabled || abortRef.current) return;
    const finishRequest = aiProvider.beginRequest();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setStatus("");
    const timer = window.setTimeout(() => controller.abort(), 100_000);
    try {
      const expected = prepareThreatModelDesign();
      const response = await askThreatModelDesigner({
        mode: "design", question: prompt, context: expected.context,
        history: messages.slice(-12).map(({ role, text }) => ({ role, text })),
        ...(__PS_LOCAL_AI__ ? { provider: aiProvider.provider } : {}),
      }, controller.signal);
      if (controller.signal.aborted || abortRef.current !== controller) return;
      const outcome = applyThreatModelDesign(response, expected);
      scenarioRef.current = outcome.scenarioId;
      setMessages(current => [
        ...current, { role: "user", text: prompt },
        { role: "assistant", text: response.answer, assumptions: response.assumptions },
      ]);
      setQuestion("");
      setStatus(outcome.changed ? `Design applied to the diagram. ${outcome.summary} Undo reverses this entire response.`
        : response.design ? "The requested design already matches the model. No changes were applied."
        : "No model changes were applied. The diagram has not changed.");
      if (outcome.changed) {
        const edit = response.design;
        const orderOnly = edit?.edgeOrder != null && !edit.nodes.length && !edit.edges.length &&
          !edit.boundaries.length && !edit.data.length &&
          !edit.remove?.nodeIds.length && !edit.remove?.edgeIds.length && !edit.remove?.boundaryIds.length;
        if (!orderOnly) {
          setViewMode("graph");
          requestFitView();
        }
      }
    } catch (cause) {
      if (abortRef.current === controller) {
        setError(controller.signal.aborted ? "The design request timed out. No changes were applied; try a smaller prompt."
          : cause instanceof Error ? cause.message : "The AI design could not be applied. No changes were applied.");
      }
    } finally {
      finishRequest();
      window.clearTimeout(timer);
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  if (!open) return null;

  const positionStyle = position ? {
    "--ps-designer-left": `${position.x}px`, "--ps-designer-top": `${position.y}px`,
  } as CSSProperties : undefined;

  return (
    <section ref={dialogRef} className={`ps-designer-dialog${position ? " is-positioned" : ""}`} style={positionStyle}
      role="dialog" aria-modal="false"
      aria-labelledby="ps-designer-title" data-ps-temporary-surface="true"
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
      }}>
      <header className="ps-designer-header" tabIndex={0} role="group"
        aria-label="Threat Model Designer title bar"
        aria-description="Drag to move, or use arrow keys while this title bar is focused. Shift moves farther."
        title="Drag to move; focus this title bar and use arrow keys for keyboard movement"
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          const offset = event.key === "ArrowLeft" ? [-1, 0] : event.key === "ArrowRight" ? [1, 0]
            : event.key === "ArrowUp" ? [0, -1] : event.key === "ArrowDown" ? [0, 1] : null;
          const box = dialogRef.current?.getBoundingClientRect();
          if (!offset || !box) return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 40 : 10;
          setPosition(clampPosition({ x: box.x + offset[0] * step, y: box.y + offset[1] * step }));
        }}
        onPointerDown={event => {
          if (event.button !== 0 || !(event.target instanceof Element) ||
              event.target.closest("button, a, input, select, textarea")) return;
          const box = dialogRef.current?.getBoundingClientRect();
          if (!box) return;
          event.preventDefault();
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          setPosition(clampPosition({ x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y }));
        }}
        onPointerUp={event => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragRef.current = null; }}
        onLostPointerCapture={() => { dragRef.current = null; }}>
        <div>
          <span className="ps-designer-eyebrow">PROMPT TO DIAGRAM</span>
          <h2 id="ps-designer-title">Threat Model Designer</h2>
          <p>{activeScenario?.name ?? (doc.scenarios.length ? "Choose a scenario to begin" : "Start a new threat model")}</p>
        </div>
        <div className="ps-designer-tools">
          <button type="button" aria-expanded={expanded} aria-controls="ps-designer-content"
            onClick={() => setExpanded(value => !value)}>{expanded ? "Collapse" : "Expand"}</button>
          <button ref={closeRef} type="button" onClick={close} aria-label="Close Threat Model Designer">Close</button>
        </div>
      </header>
      <div id="ps-designer-content" hidden={!expanded}>
        <AiProviderSelector />
        <div className="ps-designer-conversation" ref={conversationRef} role="log" aria-label="Design conversation" tabIndex={0}>
          {messages.length === 0 && <>
            <p>Describe what you need. AI selects components and builds nodes, flows, data and trust boundaries directly on the canvas.</p>
            <button type="button" className="ps-designer-example" disabled={!enabled || busy}
              onClick={() => { setQuestion("I need a web server to securely host documents for authenticated users."); inputRef.current?.focus(); }}>
              I need a web server to securely host documents...
            </button>
          </>}
          {messages.map((message, index) => (
            <article key={index} className={`ps-assistant-message is-${message.role}`}>
              <strong>{message.role === "user" ? "You" : "Threat Model Designer"}</strong>
              <p>{message.text}</p>
              {!!message.assumptions?.length && <details><summary>Design assumptions</summary>
                <ul>{message.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
              </details>}
            </article>
          ))}
        </div>
        <form className="ps-designer-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          <label htmlFor="ps-designer-prompt">What would you like to design or change?</label>
          <p>AI output is proposed, unverified design intent—not deployment evidence or a complete security review.</p>
          <p>AI can delete and reroute shared items everywhere they are used. Undo reverses the whole response.</p>
          <textarea ref={inputRef} id="ps-designer-prompt" value={question} maxLength={4000} rows={3}
            disabled={!enabled || busy} placeholder="Describe your system, users, data and constraints"
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault(); void send();
              }
            }} />
          <div className="ps-designer-actions">
            <div>
              <button type="button" disabled={busy || !canUndo} onClick={() => { undo(); setStatus("Undid the last model change."); }}>Undo model change</button>
              <button type="button" disabled={busy || !canRedo} onClick={() => { redo(); setStatus("Redid the last model change."); }}>Redo</button>
            </div>
            {busy ? <button key="stop" type="button" onClick={event => { event.preventDefault(); stop(); }}>Stop generating</button>
              : <button key="send" type="submit" className="ps-modal-primary" disabled={!enabled || !question.trim()}>Build design</button>}
          </div>
          {busy && <p role="status">Designing your model...</p>}
          {status && <p role="status">{status}</p>}
          {error && <p role="alert" className="ps-designer-error">{error}</p>}
          {filtered && <div role="status">
            <p>Active filters may hide your design.</p>
            <button type="button" onClick={() => { clearFilter(); setViewMode("graph"); requestFitView(); }}>
              Clear filters and show design
            </button>
          </div>}
          <details className="ps-designer-disclosure">
            <summary>Live edits, AI connection and limitations</summary>
            <p>Each response is one undoable model change. AI can add, edit, delete or reroute elements and replace data attachments or boundary members.
              Deletion and rerouting affect every scenario using an item. Deleting a component also removes its remaining connections, comments and issues.
              Data attachments change only in the selected scenario; reusable data and unrelated evidence remain.
              Existing filters still apply. Proposed controls are unverified design intent; review the model before relying on it.</p>
            <p>Your prompts, recent conversation, active scenario and available catalog choices are sent to the configured AI service.
              Closing keeps the conversation and draft for this scenario while the app stays open. Switching scenarios, opening or creating a model, or reloading
              clears them; they are not saved in model files or shared with collaborators. Model changes are saved normally.</p>
            <p>{SERVICES.assistant.message} {SERVICES.assistant.enabled && <code>{SERVICES.assistant.endpoint}</code>}</p>
          </details>
          {!SERVICES.assistant.enabled && <p role="status">{SERVICES.assistant.message}</p>}
          {doc.scenarios.length > 0 && !activeScenario && <p role="status">Select a scenario instead of Show all to build with AI.</p>}
        </form>
      </div>
    </section>
  );
}
