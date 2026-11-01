import { useEffect } from "react";
import { useStore } from "../store";
import { safeNavigationHref } from "../urlSafety";

export function WorkItemsModal({
  onClose,
  embedded = false,
}: {
  onClose?: () => void;
  embedded?: boolean;
}) {
  const { doc, createWorkItem, updateWorkItem, deleteWorkItem } = useStore();
  const close = onClose ?? (() => undefined);

  // Close on Escape.
  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, embedded]);

  return (
    <div
      className={embedded ? "ps-inspector-asset-panel" : "ps-modal-overlay"}
      onMouseDown={embedded ? undefined : close}
    >
      <div
        className={embedded ? "ps-inspector-asset-content" : "ps-modal"}
        onMouseDown={(e) => e.stopPropagation()}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-label="Security work items"
      >
        <header className="ps-modal-header">
          <h2>Security work items</h2>
          {!embedded && (
            <button
              className="ps-modal-close"
              aria-label="Close"
              onClick={close}
            >
              ×
            </button>
          )}
        </header>

        <p className="ps-modal-help">
          Track security-review action items here. Each entry has a short
          description and an optional link to the tracker (ADO, Jira, GitHub
          issue, etc.).
        </p>

        <div className="ps-data-table-wrap">
          {doc.workItems.length === 0 ? (
            <p className="ps-empty">No work items yet.</p>
          ) : (
            <table className="ps-data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Link</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {doc.workItems.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <input
                        type="text"
                        value={w.description}
                        onChange={(e) =>
                          updateWorkItem(w.id, { description: e.target.value })
                        }
                        placeholder="What needs to be done"
                      />
                    </td>
                    <td>
                      <div className="ps-workitem-link-cell">
                        <input
                          type="url"
                          value={w.link}
                          onChange={(e) =>
                            updateWorkItem(w.id, { link: e.target.value })
                          }
                          placeholder="https://…"
                        />
                        {w.link.trim() && (() => {
                          // Only render the launcher when the scheme is in
                          // the allow-list (http/https/mailto). Blocks
                          // `javascript:` and `data:` XSS via imported
                          // .tma / TMC files or pasted input.
                          const safe = safeNavigationHref(w.link);
                          return safe ? (
                            <a
                              href={safe}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in a new tab"
                              className="ps-workitem-link-open"
                            >
                              ↗
                            </a>
                          ) : (
                            <span
                              className="ps-workitem-link-open ps-workitem-link-blocked"
                              title="Link is not a valid http(s) or mailto URL — open blocked"
                              aria-label="Blocked link"
                            >
                              ⚠
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="ps-data-actions">
                      <button
                        className="ps-danger"
                        onClick={event => {
                          if (
                            (w.description.trim() === "" &&
                              w.link.trim() === "") ||
                            (event.currentTarget.ownerDocument.defaultView ?? window).confirm("Delete this work item?")
                          ) {
                            deleteWorkItem(w.id);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="ps-modal-footer">
          <button onClick={() => createWorkItem()}>+ Add work item</button>
          {!embedded && <button onClick={close}>Close</button>}
        </footer>
      </div>
    </div>
  );
}
