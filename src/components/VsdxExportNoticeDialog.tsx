import { useEffect } from "react";

// Shown after a successful VSDX export. The Dynamic-Connector glue we
// emit only takes effect once Visio runs its layout engine — until the
// user kicks that off via "Position → Auto Align & Space", connectors
// often render as straight lines through other shapes. The dialog
// surfaces that one-time post-import step so the user isn't surprised.
export function VsdxExportNoticeDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ps-modal-overlay"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="ps-modal ps-modal-sm"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ps-vsdx-notice-title"
      >
        <header className="ps-modal-header">
          <h2 id="ps-vsdx-notice-title">VSDX export complete</h2>
          <button
            className="ps-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="ps-modal-body">
          <p>
            Your Visio file <code>secure-design-studio-diagram.vsdx</code> has been
            downloaded.
          </p>
          <p>
            After opening the file in Visio, click{" "}
            <strong>Position</strong> and then{" "}
            <strong>Auto Align &amp; Space</strong> for the visualization
            to show up correctly.
          </p>
        </div>
        <footer className="ps-modal-footer">
          <button className="ps-modal-primary" onClick={onClose} autoFocus>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
