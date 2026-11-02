import { useEffect, useRef, useState } from "react";

export function SaveAsDialog({
  initialFileName,
  onCancel,
  onSave,
}: {
  initialFileName: string;
  onCancel: () => void;
  onSave: (fileName: string) => void;
}) {
  const [fileName, setFileName] = useState(initialFileName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    const trimmed = fileName.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <div
      className="ps-modal-overlay"
      onMouseDown={onCancel}
      role="presentation"
    >
      <div
        className="ps-modal ps-modal-sm"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ps-save-as-title"
      >
        <header className="ps-modal-header">
          <h2 id="ps-save-as-title">Save as</h2>
          <button
            className="ps-modal-close"
            aria-label="Close"
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <div className="ps-modal-body">
          <label>
            File name
            <input
              ref={inputRef}
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          <p className="ps-field-help">
            SecureDesignStudio model files use the <code>.tma</code>{" "}
            extension.
          </p>
        </div>
        <footer className="ps-modal-footer">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="ps-modal-primary"
            onClick={submit}
            disabled={!fileName.trim()}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
