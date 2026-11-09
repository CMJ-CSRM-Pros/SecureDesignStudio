import { useEffect, useMemo, useRef, useState } from "react";
import type { PsNode } from "../types";
import type { ParsedPrivExp, ServiceGroup } from "../privacyManagerImport";
import type { ServiceImportDecision } from "../store";

type DecisionKind = "use-existing" | "create-new" | "ignore";

interface RowState {
  kind: DecisionKind;
  // Only used when kind === "use-existing". Empty string means "no
  // selection yet" so the Import button stays disabled.
  nodeId: string;
}

export function PrivacyManagerImportDialog({
  parsed,
  autoMappedNodeByService,
  candidateNodes,
  onCancel,
  onConfirm,
}: {
  parsed: ParsedPrivExp;
  // serviceId (canonical) -> node id that already matches by service tree
  // id. These services are not editable; the table just shows them so the
  // user understands what's happening.
  autoMappedNodeByService: Record<string, string>;
  candidateNodes: PsNode[];
  onCancel: () => void;
  onConfirm: (decisions: Record<string, ServiceImportDecision>) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const autoMappedSet = useMemo(
    () => new Set(Object.keys(autoMappedNodeByService)),
    [autoMappedNodeByService],
  );

  const unmappedGroups = useMemo<ServiceGroup[]>(
    () =>
      parsed.groups.filter((g) => !autoMappedSet.has(g.key)),
    [parsed.groups, autoMappedSet],
  );

  const autoMappedGroups = useMemo<ServiceGroup[]>(
    () =>
      parsed.groups.filter((g) => autoMappedSet.has(g.key)),
    [parsed.groups, autoMappedSet],
  );

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const g of unmappedGroups) {
      init[g.key] = { kind: "create-new", nodeId: "" };
    }
    return init;
  });

  useEffect(() => {
    cancelRef.current?.focus();
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
      "button:not(:disabled), select:not(:disabled), summary, a[href], [tabindex]:not([tabindex='-1'])",
    ) ?? []);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  };

  const sortedCandidates = useMemo(
    () =>
      [...candidateNodes].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      ),
    [candidateNodes],
  );

  const setRow = (sid: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [sid]: { ...prev[sid], ...patch } }));

  const setAllKind = (kind: DecisionKind) => {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const [sid, row] of Object.entries(prev)) {
        next[sid] = { ...row, kind };
      }
      return next;
    });
  };

  const incomplete = unmappedGroups.some((g) => {
    const r = rows[g.key];
    if (!r) return true;
    if (r.kind === "use-existing" && !r.nodeId) return true;
    return false;
  });

  const onImport = () => {
    if (incomplete) return;
    const out: Record<string, ServiceImportDecision> = {};
    for (const [sid, nodeId] of Object.entries(autoMappedNodeByService)) {
      out[sid] = { kind: "use-existing", nodeId };
    }
    for (const g of unmappedGroups) {
      const r = rows[g.key];
      if (r.kind === "use-existing") {
        out[g.key] = { kind: "use-existing", nodeId: r.nodeId };
      } else if (r.kind === "create-new") {
        out[g.key] = { kind: "create-new" };
      } else {
        out[g.key] = { kind: "ignore" };
      }
    }
    onConfirm(out);
  };

  const totalItems = parsed.groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div
      className="ps-modal-overlay ps-fluent-dialog-overlay"
      onMouseDown={onCancel}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="ps-modal ps-fluent-dialog ps-pmexp-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ps-pmexp-import-title"
      >
        <header className="ps-modal-header">
          <h2 id="ps-pmexp-import-title">PMEXP import</h2>
          <button
            className="ps-modal-close"
            aria-label="Close"
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <div className="ps-modal-body">
          <p>
            Import data inventory from a local <code>.pmexp</code> file containing
            a JSON array or an object with a top-level <code>data</code> array.
            Matching compares the file's <code>serviceId</code> with saved node
            inventory IDs (<code>serviceTreeId</code> in the model).
            No sign-in, service lookup, or optional library is required.
          </p>
          <p style={{ marginTop: 0 }}>
            Found <strong>{parsed.groups.length}</strong>{" "}
            service{parsed.groups.length === 1 ? "" : "s"} and{" "}
            <strong>{totalItems}</strong>{" "}
            data item{totalItems === 1 ? "" : "s"} in this PMEXP file.{" "}
            <strong>{autoMappedGroups.length}</strong>{" "}
            already match nodes in your diagram and will be merged
            automatically.
            {parsed.unknownClassificationCount > 0 && (
              <>
                {" "}
                <em>
                  ({parsed.unknownClassificationCount} record
                  {parsed.unknownClassificationCount === 1 ? "" : "s"} had an
                  unrecognized classification and will use "Other".)
                </em>
              </>
            )}
          </p>

          {autoMappedGroups.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary>
                Automatically mapped ({autoMappedGroups.length})
              </summary>
              <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                {autoMappedGroups.map((g) => {
                  const nodeId =
                    autoMappedNodeByService[g.key];
                  const node = candidateNodes.find((n) => n.id === nodeId);
                  return (
                    <li key={g.key}>
                      <strong>{g.serviceName}</strong> →{" "}
                      {node?.title ?? "(unknown node)"}
                      <span
                        style={{
                          marginLeft: 8,
                          color: "var(--ps-muted, #888)",
                        }}
                      >
                        ({g.items.length} item{g.items.length === 1 ? "" : "s"})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          {unmappedGroups.length > 0 ? (
            <>
              <div
                className="ps-pmexp-bulk-actions"
              >
                <strong>
                  Unmapped services ({unmappedGroups.length})
                </strong>
                <div>
                  <button type="button" onClick={() => setAllKind("create-new")}>
                    Create all
                  </button>
                  <button type="button" onClick={() => setAllKind("ignore")}>
                    Ignore all
                  </button>
                </div>
              </div>
              <div
                className="ps-pmexp-table-wrap"
              >
                <table
                  aria-label="PMEXP service mapping"
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--ps-border, #ccc)",
                        }}
                      >
                        Service
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--ps-border, #ccc)",
                        }}
                      >
                        Items
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--ps-border, #ccc)",
                        }}
                      >
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmappedGroups.map((g) => {
                      const row = rows[g.key];
                      return (
                        <tr key={g.key}>
                          <td
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid var(--ps-border, #eee)",
                              verticalAlign: "top",
                            }}
                          >
                            <div>{g.serviceName}</div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--ps-muted, #888)",
                                wordBreak: "break-all",
                              }}
                            >
                              {g.serviceId}
                            </div>
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid var(--ps-border, #eee)",
                              verticalAlign: "top",
                            }}
                          >
                            {g.items.length}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid var(--ps-border, #eee)",
                              verticalAlign: "top",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              <select
                                aria-label={`Action for ${g.serviceName}`}
                                value={row.kind}
                                onChange={(e) =>
                                  setRow(g.key, {
                                    kind: e.target.value as DecisionKind,
                                  })
                                }
                              >
                                <option value="create-new">
                                  Create new node
                                </option>
                                <option value="use-existing">
                                  Map to existing node…
                                </option>
                                <option value="ignore">Ignore</option>
                              </select>
                              {row.kind === "use-existing" && (
                                <select
                                  aria-label={`Existing node for ${g.serviceName}`}
                                  value={row.nodeId}
                                  onChange={(e) =>
                                    setRow(g.key, {
                                      nodeId: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">— Choose node —</option>
                                  {sortedCandidates.map((n) => (
                                    <option key={n.id} value={n.id}>
                                      {n.title || "(untitled)"}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p>
              <em>
                Every service in the PMEXP file already matches a node in your
                diagram. Click <strong>Import</strong> to merge the data.
              </em>
            </p>
          )}
        </div>
        <footer className="ps-modal-footer">
          <button ref={cancelRef} onClick={onCancel}>Cancel</button>
          <button
            className="ps-modal-primary"
            onClick={onImport}
            disabled={incomplete}
            title={incomplete ? "Choose a node for every 'Map to existing' row" : ""}
          >
            Import
          </button>
        </footer>
      </div>
    </div>
  );
}
