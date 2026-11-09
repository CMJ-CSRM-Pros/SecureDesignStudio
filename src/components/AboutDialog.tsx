import { useEffect, useRef } from "react";
import secureDesignStudioLogo from "../assets/secure-design-studio-logo.svg?inline";
import { LibraryDetails, LibrarySummary } from "./LibraryDetails";
import { SERVICES } from "../services";
import templateNotice from "../data/vsdxTemplateNotice.json";
import dependencyNotices from "../data/runtimeDependencyNotices.json";

export function AboutDialog({ onClose, showLibraries = false }: { onClose: () => void; showLibraries?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), summary, [href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ps-modal-overlay ps-fluent-dialog-overlay">
      <div
        ref={dialogRef}
        className={`ps-modal ${showLibraries ? "ps-custom-libraries-dialog" : "ps-modal-sm ps-about-dialog"} ps-fluent-dialog`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ps-about-title"
        onKeyDown={onDialogKeyDown}
      >
        <header className="ps-modal-header">
          <h2 id="ps-about-title">{showLibraries ? "Custom Libraries" : "About SecureDesignStudio"}</h2>
          <button
            ref={closeRef}
            type="button"
            className="ps-modal-close"
            aria-label={showLibraries ? "Close Custom Libraries" : "Close About"}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="ps-modal-body">
          {showLibraries ? <LibraryDetails /> : <>
          <img
            className="ps-about-brand"
            src={secureDesignStudioLogo}
            alt=""
            aria-hidden="true"
          />
          <p className="ps-about-summary">
            A browser-based workspace for privacy and security data-flow
            modeling.
          </p>
          <dl className="ps-about-details">
            <div>
              <dt>Product</dt>
              <dd>SecureDesignStudio</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{__PS_VERSION__}</dd>
            </div>
            <div><dt>Custom Libraries</dt><dd><LibrarySummary /></dd></div>
            <div><dt>Service configuration</dt><dd className="ps-service-notice">{SERVICES.source}</dd></div>
            <div><dt>Collaboration service</dt><dd className="ps-service-notice" role={SERVICES.collaboration.state === "invalid" ? "alert" : undefined}>
              {SERVICES.collaboration.message}
              {SERVICES.collaboration.enabled && <>
                <p>Token endpoint: <code>{SERVICES.collaboration.endpoint}</code></p>
                <p>Share destination: {SERVICES.shareAppUrl
                  ? <code>{SERVICES.shareAppUrl}</code> : "the current hosted page"}</p>
              </>}
            </dd></div>
            <div><dt>Design Assistant service</dt><dd className="ps-service-notice" role={SERVICES.assistant.state === "invalid" ? "alert" : undefined}>
              {SERVICES.assistant.message}
              {SERVICES.assistant.enabled && <p>Endpoint: <code>{SERVICES.assistant.endpoint}</code>
                {SERVICES.assistant.endpoint.startsWith("/") && " (same origin)"}</p>}
            </dd></div>
          </dl>
          <details className="ps-third-party-notice">
            <summary>Visio template notice</summary>
            <p>{templateNotice.component} is licensed under {templateNotice.license}.
              {" "}<a href={templateNotice.sourceUrl} target="_blank" rel="noopener noreferrer">Pinned upstream source</a>.
              This notice covers that component, not the whole application.</p>
            <pre>{templateNotice.notice}</pre>
          </details>
          <details className="ps-third-party-notice">
            <summary>Dependency notices ({dependencyNotices.packages.length})</summary>
            <p>{dependencyNotices.scope}</p>
            {dependencyNotices.packages.map(pkg => <details key={`${pkg.name}@${pkg.version}`}>
              <summary>{pkg.name} {pkg.version} ({pkg.license})</summary>
              <p>{pkg.scopes.join(", ")}. <a href={pkg.sourceUrl} target="_blank" rel="noopener noreferrer">Published package source</a></p>
              {pkg.notices.map(notice => <section key={notice.file}>
                <h3>{notice.file}</h3><pre>{notice.text}</pre>
              </section>)}
            </details>)}
          </details>
          </>}
        </div>
        <footer className="ps-modal-footer ps-dialog-actions">
          <button type="button" className="ps-modal-primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
