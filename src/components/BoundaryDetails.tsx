import { useId, useState } from "react";
import { useStore } from "../store";
import type { PsBoundary } from "../types";
import {
  privacyBoundaryTypeDescription,
  privacyBoundaryTypeLabel,
  securityBoundaryTypeDescription,
  securityBoundaryTypeLabel,
  catalogDefinitionChoices,
  BOUNDARY_NETWORK_FIELDS,
  formatBoundaryNetworkText,
} from "../types";
import { RichText } from "./RichText";

export function BoundaryDetails({ boundary }: { boundary: PsBoundary }) {
  const networkHelpId = useId();
  const [networkError, setNetworkError] = useState<{ boundaryId: string; message: string } | null>(null);
  const {
    doc,
    availableCatalogDefinitions,
    updateBoundary,
    deleteBoundary,
    activeScenarioId,
    activeScenario,
    addBoundaryToScenario,
    removeBoundaryFromScenario,
  } = useStore();
  const privacyTypes = catalogDefinitionChoices("privacyBoundary", doc.catalogDefinitions, availableCatalogDefinitions);
  const securityTypes = catalogDefinitionChoices("securityBoundary", doc.catalogDefinitions, availableCatalogDefinitions);

  const inScenario =
    activeScenario != null && activeScenario.boundaryIds.includes(boundary.id);

  return (
    <div className="ps-details">
      <h3>Boundary</h3>
      <label>
        Title
        <input
          type="text"
          value={boundary.title}
          onChange={(e) =>
            updateBoundary(boundary.id, { title: e.target.value })
          }
        />
      </label>
      <label>
        Type
        <select
          value={boundary.type}
          onChange={(e) =>
            updateBoundary(boundary.id, {
              type: e.target.value as "security" | "privacy",
            })
          }
        >
          <option value="security">Security</option>
          <option value="privacy">Privacy</option>
        </select>
      </label>
      {boundary.type === "privacy" && (
        <label>
          Privacy subtype
          <select
            aria-label="Privacy subtype"
            value={boundary.privacySubtype ?? ""}
            onChange={(e) =>
              updateBoundary(boundary.id, {
                privacySubtype: e.target.value || undefined,
              })
            }
          >
            <option value="">(unspecified)</option>
            {boundary.privacySubtype && !privacyTypes.some((p) => p.id === boundary.privacySubtype) && (
              <option value={boundary.privacySubtype} disabled>{privacyBoundaryTypeLabel(boundary.privacySubtype, doc.catalogDefinitions)}</option>
            )}
            {[...privacyTypes]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </select>
          {boundary.privacySubtype && !privacyTypes.some(def => def.id === boundary.privacySubtype) && (
            <p className="ps-description-below">Retained privacy subtype: its library is unavailable for new selections.</p>
          )}
          {boundary.privacySubtype &&
            privacyBoundaryTypeDescription(boundary.privacySubtype, doc.catalogDefinitions, availableCatalogDefinitions) && (
              <div className="ps-description-below">
                <RichText
                  text={
                    privacyBoundaryTypeDescription(boundary.privacySubtype, doc.catalogDefinitions, availableCatalogDefinitions)!
                  }
                />
              </div>
            )}
        </label>
      )}
      {boundary.type === "security" && (
        <label>
          Security subtype
          <select
            aria-label="Security subtype"
            value={boundary.securitySubtype ?? ""}
            onChange={(e) =>
              updateBoundary(boundary.id, {
                securitySubtype: e.target.value || undefined,
              })
            }
          >
            <option value="">(unspecified)</option>
            {boundary.securitySubtype && !securityTypes.some((s) => s.id === boundary.securitySubtype) && (
              <option value={boundary.securitySubtype} disabled>{securityBoundaryTypeLabel(boundary.securitySubtype, doc.catalogDefinitions)}</option>
            )}
            {[...securityTypes]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
          {boundary.securitySubtype && !securityTypes.some(def => def.id === boundary.securitySubtype) && (
            <p className="ps-description-below">Retained security subtype: its library is unavailable for new selections.</p>
          )}
          {boundary.securitySubtype &&
            securityBoundaryTypeDescription(boundary.securitySubtype, doc.catalogDefinitions, availableCatalogDefinitions) && (
              <div className="ps-description-below">
                <RichText
                  text={
                    securityBoundaryTypeDescription(boundary.securitySubtype, doc.catalogDefinitions, availableCatalogDefinitions)!
                  }
                />
              </div>
            )}
        </label>
      )}
      {boundary.type === "security" ? (
        <div>
          <p id={networkHelpId} className="ps-description-below">
            Optional network notes, shared across scenarios using this boundary.
            Blank means undocumented. This is declared intent, not verified enforcement
            or compliance. Switching to Privacy retains these notes as inactive.
          </p>
          {(["Inbound", "Outbound"] as const).map(direction => (
            <div key={direction}>
              <h4>{direction}</h4>
              {BOUNDARY_NETWORK_FIELDS.filter(field => field.label.startsWith(direction)).map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <textarea
                    rows={3}
                    aria-describedby={networkHelpId}
                    value={boundary[key] ?? ""}
                    onChange={event => {
                      try {
                        updateBoundary(boundary.id, { [key]: event.target.value });
                        setNetworkError(null);
                      } catch (error) {
                        setNetworkError({
                          boundaryId: boundary.id,
                          message: error instanceof Error ? error.message : String(error),
                        });
                      }
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
          {networkError?.boundaryId === boundary.id && (
            <p role="alert" className="ps-auth-selection-warning">{networkError.message}</p>
          )}
        </div>
      ) : BOUNDARY_NETWORK_FIELDS.some(({ key }) => formatBoundaryNetworkText(boundary[key])) ? (
        <p className="ps-description-below">
          Security network notes are retained but inactive while this boundary is Privacy.
          Switch to Security to view or edit them.
        </p>
      ) : null}
      <div className="ps-boundary-geom">
        <span>
          @ ({Math.round(boundary.position.x)}, {Math.round(boundary.position.y)})
          {" "}
          {Math.round(boundary.size.width)}×{Math.round(boundary.size.height)}
        </span>
      </div>

      {activeScenarioId && (
        <div className="ps-scenario-membership">
          {inScenario ? (
            <button
              onClick={() =>
                removeBoundaryFromScenario(activeScenarioId, boundary.id)
              }
            >
              Remove from scenario
            </button>
          ) : (
            <button
              onClick={() =>
                addBoundaryToScenario(activeScenarioId, boundary.id)
              }
            >
              Add to scenario
            </button>
          )}
        </div>
      )}

      <button className="ps-danger" onClick={() => deleteBoundary(boundary.id)}>
        Delete boundary
      </button>
    </div>
  );
}
