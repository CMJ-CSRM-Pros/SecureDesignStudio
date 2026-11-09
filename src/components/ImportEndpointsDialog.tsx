import { useEffect, useRef, useState } from "react";
import { useLibraries } from "../libraries/LibraryProvider";
import { endpointImportHelp } from "../libraries/endpointHelp";
import { safeNavigationHref } from "../urlSafety";

export function ImportEndpointsDialog({
  onCancel,
  onChooseFile,
}: {
  onCancel: () => void;
  onChooseFile: () => void;
}) {
  const libraries = useLibraries();
  const { instructions, example } = endpointImportHelp(libraries);
  const [copyStatus, setCopyStatus] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const exampleRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    closeRef.current?.focus();
    return () => { mountedRef.current = false; };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), textarea, a[href], [tabindex]:not([tabindex='-1'])",
    ) ?? []);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  };

  const onCopy = async () => {
    if (!example) return;
    try {
      await navigator.clipboard.writeText(example.text);
      if (mountedRef.current) setCopyStatus("Copied to clipboard.");
    } catch {
      if (!mountedRef.current) return;
      exampleRef.current?.focus();
      exampleRef.current?.select();
      setCopyStatus("Clipboard access was unavailable. The example is selected; press Ctrl+C or Command+C to copy it.");
    }
  };

  return (
    <div className="ps-modal-overlay ps-fluent-dialog-overlay" onMouseDown={onCancel} role="presentation">
      <div
        ref={dialogRef}
        className="ps-modal ps-fluent-dialog ps-endpoints-dialog"
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ps-endpoints-dialog-title"
      >
        <header className="ps-modal-header">
          <h2 id="ps-endpoints-dialog-title">Import nodes from Endpoints</h2>
          <button ref={closeRef} type="button" className="ps-modal-close" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </header>
        <div className="ps-modal-body">
          <p>
            Match each nonblank line in a plain-text file against the endpoint
            expressions in the node catalog. Use one endpoint URL per line,
            for example <code>https://example.invalid/service</code>.
          </p>
          <p>
            The importer reads only the file you choose. It does not query
            telemetry, scan services or contact those URLs. Matching node
            types missing from the diagram are added to the active scenario;
            unmatched lines are downloaded separately.
          </p>
          {!instructions && !example && <p>
            No optional endpoint guidance is configured. You can still choose
            a file and import endpoints.
          </p>}
          {instructions && <section>
            <h3>{instructions.title}</h3>
            <p className="ps-endpoints-library-source">{instructions.source}</p>
            <p className="ps-library-help">{instructions.text}</p>
            {instructions.url && safeNavigationHref(instructions.url) && <a
              href={instructions.url} target="_blank" rel="noopener noreferrer"
            >Open library guidance</a>}
          </section>}
          {example && <section>
            <div className="ps-endpoints-query-header">
              <h3>{example.title}</h3>
              <button type="button" onClick={onCopy}>Copy to clipboard</button>
            </div>
            <p className="ps-endpoints-library-source">{example.source}</p>
            <textarea
              ref={exampleRef}
              id="ps-endpoints-query-text"
              className="ps-endpoints-query-text"
              aria-label="Endpoint import example"
              readOnly
              value={example.text}
              rows={14}
              onClick={event => event.currentTarget.select()}
            />
            {example.url && safeNavigationHref(example.url) && <a
              href={example.url} target="_blank" rel="noopener noreferrer"
            >Open example guidance</a>}
            <p role="status">{copyStatus}</p>
          </section>}
        </div>
        <footer className="ps-modal-footer ps-dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="ps-modal-primary" onClick={onChooseFile}>Choose file…</button>
        </footer>
      </div>
    </div>
  );
}
