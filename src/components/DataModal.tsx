import { useEffect } from "react";
import { useStore } from "../store";
import { dataClassificationLabel, type DataClassification } from "../types";
import { classificationOptions } from "../classificationLibrary";
import { safeNavigationHref } from "../urlSafety";

export function DataModal({
  onClose,
  embedded = false,
}: {
  onClose?: () => void;
  embedded?: boolean;
}) {
  const {
    doc, createData, updateData, deleteData, classificationLibrary,
    classificationDefinitions, classificationLibrarySource,
  } = useStore();
  const guidanceHref = safeNavigationHref(classificationLibrary.guidanceUrl);
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
        aria-label="Data items"
      >
        <header className="ps-modal-header">
          <h2>Data items</h2>
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
          Items here are referenced by edges. The classification on each item
          drives the edge-classification filter.
        </p>
        <p className="ps-classification-library-status">
          Classification Library: <strong>{classificationLibrary.name}</strong> ({classificationLibrarySource}).
          {" "}Default for new data: {dataClassificationLabel(classificationLibrary.defaultId, doc.catalogDefinitions, classificationDefinitions)}.
          {" "}New choices use the active enabled list; saved out-of-list selections are retained.
        </p>

        <div className="ps-data-table-wrap">
          {doc.data.length === 0 ? (
            <p className="ps-empty">No data items yet.</p>
          ) : (
            <table className="ps-data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>
                    {guidanceHref ? <a
                      href={guidanceHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ps-data-classification-link"
                      title="Open guidance for the active Classification Library (opens in a new tab)"
                    >
                      Classification
                    </a> : "Classification"}
                  </th>
                  <th>Sample</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {doc.data.map((d) => {
                  let usedBy = 0;
                  for (const s of doc.scenarios) {
                    for (const ids of Object.values(s.edgeRequestData)) {
                      if (ids.includes(d.id)) usedBy += 1;
                    }
                    for (const ids of Object.values(s.edgeResponseData)) {
                      if (ids.includes(d.id)) usedBy += 1;
                    }
                    for (const m of Object.values(s.nodeData)) {
                      if (d.id in m) usedBy += 1;
                    }
                  }
                  return (
                    <tr key={d.id}>
                      <td>
                        <input
                          type="text"
                          value={d.name}
                          onChange={(e) =>
                            updateData(d.id, { name: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Classification for ${d.name || d.id}`}
                          value={d.classification}
                          onChange={(e) =>
                            updateData(d.id, {
                              classification: e.target
                                .value as DataClassification,
                            })
                          }
                        >
                          {classificationOptions(classificationLibrary, doc.catalogDefinitions, d.classification)
                            .sort((a, b) => a.label.localeCompare(b.label))
                            .map((c) => (
                              <option key={c.id} value={c.id} disabled={c.disabled}
                                title={c.disabled ? `${c.id}: unavailable for new choices` : c.id}>
                                {c.label}{c.saved ? " (saved)" : ""}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={d.sample}
                          onChange={(e) =>
                            updateData(d.id, { sample: e.target.value })
                          }
                          placeholder="example value"
                        />
                      </td>
                      <td className="ps-data-actions">
                        <span
                          className="ps-data-usage"
                          title={`Attached to ${usedBy} edge${
                            usedBy === 1 ? "" : "s"
                          }`}
                        >
                          {usedBy > 0 ? `${usedBy} ↦` : ""}
                        </span>
                        <button
                          className="ps-danger"
                          onClick={event => {
                            if (
                              usedBy === 0 ||
                              (event.currentTarget.ownerDocument.defaultView ?? window).confirm(
                                `This data item is attached to ${usedBy} edge${
                                  usedBy === 1 ? "" : "s"
                                }. Delete anyway?`
                              )
                            ) {
                              deleteData(d.id);
                            }
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="ps-modal-footer">
          <button onClick={() => createData()}>+ Add data item</button>
          {!embedded && <button onClick={close}>Close</button>}
        </footer>
      </div>
    </div>
  );
}
