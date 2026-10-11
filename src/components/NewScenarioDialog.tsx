import { useEffect, useRef, useState } from "react";

export interface ScenarioSourceOption {
  id: string;
  name: string;
}

export function NewScenarioDialog({
  defaultName = "Scenario 1",
  sourceOptions = [],
  required = false,
  onCancel,
  onSubmit,
  onDesign,
}: {
  defaultName?: string;
  sourceOptions?: ScenarioSourceOption[];
  required?: boolean;
  onCancel: () => void;
  onDesign?: () => void;
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
              model. Create one to begin designing.
            </p>
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
