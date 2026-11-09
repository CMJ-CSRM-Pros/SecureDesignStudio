import { useEffect, useRef, useState } from "react";

export interface ScenarioSourceOption {
  id: string;
  name: string;
}

// First-run entry points for existing work. The splash blocks the menu bar,
// so without these a user must create a throwaway scenario before opening.
export interface ExistingWorkActions {
  open: () => void;
  importTm7: () => void;
  importJson: () => void;
}

export function NewScenarioDialog({
  defaultName = "Scenario 1",
  sourceOptions = [],
  required = false,
  onCancel,
  onSubmit,
  onDesign,
  existingWork,
}: {
  defaultName?: string;
  sourceOptions?: ScenarioSourceOption[];
  required?: boolean;
  onCancel: () => void;
  onDesign?: () => void;
  existingWork?: ExistingWorkActions;
  onSubmit: (data: {
    name: string;
    description: string;
    sourceId: string | null;
  }) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    if (required) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, required]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      name: trimmed,
      description,
      sourceId: sourceId || null,
    });
  };

  return (
    <div
      className={`ps-modal-overlay${required ? " ps-scenario-splash-overlay" : ""}`}
      onMouseDown={required ? undefined : onCancel}
      role="presentation"
    >
      <div
        className={`ps-modal ps-modal-sm${required ? " ps-scenario-splash" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ps-new-scenario-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
          )).filter((element) => element.offsetParent !== null);
          const first = controls[0];
          const last = controls[controls.length - 1];
          const boundary = event.shiftKey ? first : last;
          const destination = event.shiftKey ? last : first;
          if (destination && document.activeElement === boundary) {
            event.preventDefault();
            destination.focus();
          }
        }}
      >
        <header className="ps-modal-header">
          <div>
            {required && <span className="ps-scenario-splash-eyebrow">SecureDesignStudio</span>}
            <h2 id="ps-new-scenario-title">
              {required ? "Create your first scenario" : "New scenario"}
            </h2>
          </div>
          {!required && (
            <button
              className="ps-modal-close"
              aria-label="Close"
              onClick={onCancel}
            >
              ×
            </button>
          )}
        </header>
        <div className="ps-modal-body">
          {required && (
            <p className="ps-scenario-splash-intro">
              Scenarios organize the nodes, data flows, and boundaries in your
              model. Create one to begin designing{existingWork ? ", or open existing work" : ""}.
            </p>
          )}
          {required && existingWork && (
            <section
              className="ps-scenario-splash-existing"
              aria-labelledby="ps-scenario-existing-title"
            >
              <h3 id="ps-scenario-existing-title">Already have a model?</h3>
              <div className="ps-scenario-splash-existing-actions">
                <button type="button" onClick={existingWork.open}>
                  Open model (.tma)…
                </button>
                <button type="button" onClick={existingWork.importTm7}>
                  Import TM7…
                </button>
                <button
                  type="button"
                  onClick={existingWork.importJson}
                  title={'Import a scenario/DFD JSON file with the supported "scenarios" and "dfds" structure.'}
                >
                  Import JSON…
                </button>
              </div>
            </section>
          )}
          {required && existingWork && (
            <h3 className="ps-scenario-splash-new-title">Or start a new scenario</h3>
          )}
          <label>
            Title
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          {sourceOptions.length > 0 && (
            <label>
              Start from
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">Empty scenario</option>
                {[...sourceOptions]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      Copy of: {o.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="What does this scenario cover?"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
        </div>
        <footer className={`ps-modal-footer${required ? " ps-scenario-splash-footer" : ""}`}>
          {onDesign && <button id="ps-scenario-design" type="button" onClick={onDesign}>Design with AI</button>}
          {!required && <button onClick={onCancel}>Cancel</button>}
          <button
            className="ps-modal-primary"
            onClick={submit}
            disabled={!name.trim()}
          >
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
