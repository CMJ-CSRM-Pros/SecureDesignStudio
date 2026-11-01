import { useEffect, useState } from "react";
import { useStore } from "../store";
import { createFindingsWorkbook, FINDINGS_WORKBOOK_MIME } from "../findingsExport";
import { downloadBlob } from "../reportExport";

export function FindingsExportButton({ compact = false }: { compact?: boolean }) {
  const { doc, documentSessionId, assistantFindings, acceptedFindingIds, assistantAnalysis, diffChanges, diffFileName } = useStore();
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [documentSessionId]);
  return <div className="ps-findings-export">
    <button type="button" aria-label="Export all inspector data (.xlsx)"
      title="Export every inspector tab across all scenarios, including filtered-out and resolved records, comparison changes and retained AI findings."
      onClick={event => {
        try {
          if (assistantAnalysis && assistantAnalysis.documentSessionId !== documentSessionId) {
            throw new Error("The AI results belong to a different model. Run AI Analysis again before exporting.");
          }
          const bytes = createFindingsWorkbook(doc, assistantFindings, acceptedFindingIds, assistantAnalysis, new Date(),
            { fileName: diffFileName, changes: diffChanges });
          downloadBlob(new Blob([Uint8Array.from(bytes).buffer], { type: FINDINGS_WORKBOOK_MIME }),
            "secure-design-studio-inspector.xlsx", event.currentTarget.ownerDocument);
          setError("");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The inspector workbook could not be exported.");
        }
      }}>{compact ? "Excel (.xlsx)" : "Export all inspector data (.xlsx)"}</button>
    {error && <p className="ps-assistant-error" role="alert">{error}</p>}
  </div>;
}
