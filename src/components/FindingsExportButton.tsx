import { useEffect, useState } from "react";
import { useStore } from "../store";
import { createFindingsWorkbook, FINDINGS_WORKBOOK_MIME } from "../findingsExport";
import { downloadBlob } from "../reportExport";

export function FindingsExportButton({ compact = false }: { compact?: boolean }) {
  const { doc, documentSessionId, assistantFindings, acceptedFindingIds, assistantAnalysis } = useStore();
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [documentSessionId]);
  return <div className="ps-findings-export">
    <button type="button" aria-label="Export all findings and issues (.xlsx)"
      disabled={!doc.issues.length && !assistantFindings.length && !assistantAnalysis}
      title="Export all retained AI findings and every saved issue, including resolved and filtered-out issues across all scenarios."
      onClick={event => {
        try {
          if (assistantAnalysis && assistantAnalysis.documentSessionId !== documentSessionId) {
            throw new Error("The AI results belong to a different model. Run AI Analysis again before exporting.");
          }
          const bytes = createFindingsWorkbook(doc, assistantFindings, acceptedFindingIds, assistantAnalysis);
          downloadBlob(new Blob([Uint8Array.from(bytes).buffer], { type: FINDINGS_WORKBOOK_MIME }),
            "secure-design-studio-findings.xlsx", event.currentTarget.ownerDocument);
          setError("");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The findings workbook could not be exported.");
        }
      }}>{compact ? "Excel (.xlsx)" : "Export all findings and issues (.xlsx)"}</button>
    {error && <p className="ps-assistant-error" role="alert">{error}</p>}
  </div>;
}
