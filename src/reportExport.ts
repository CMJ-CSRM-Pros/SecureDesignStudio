import type { CatalogDefinitionSnapshot, PsDocument, Scenario } from "./types";
import { DFD_ROLE_LABELS, nodeDfdSummary, flowDfdSummary, resolveNodeReviewScope, formatDfdValue } from "./dfdSemantics";
import {
  RETENTION_LABELS,
  ISSUE_NOT_EVALUATED_LABELS,
  deviationKindLabel,
  privacyBoundaryTypeLabel,
  securityBoundaryTypeLabel,
  BOUNDARY_NETWORK_FIELDS,
  formatBoundaryNetworkText,
  authTypeLabel,
  authenticationCatalogFor,
  formatRequiredAccessRights,
  dataClassificationLabel,
  formatProductionIdentity,
  nodeTypeLabel,
} from "./types";
import { resolveProtocolReference } from "./protocols";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeFileStem(value: string): string {
  return (
    value
      .replace(/\.tma$/i, "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/[. ]+$/g, "") || "secure-design-studio-diagram"
  );
}

export function downloadBlob(blob: Blob, fileName: string, ownerDocument: Document = document): void {
  if (!ownerDocument.body) throw new Error("The download window is no longer available.");
  const url = URL.createObjectURL(blob);
  const anchor = ownerDocument.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  try {
    ownerDocument.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function captureDiagramPng(
  doc: PsDocument,
  scenario: Scenario,
): Promise<string> {
  const nodes = doc.nodes.filter((node) => scenario.nodeIds.includes(node.id));
  const annotations = (doc.textAnnotations ?? []).filter(annotation => scenario.textAnnotationIds?.includes(annotation.id));
  const edges = doc.edges.filter((edge) => scenario.edgeIds.includes(edge.id));
  const boundaries = doc.boundaries.filter((boundary) =>
    scenario.boundaryIds.includes(boundary.id),
  );
  if (nodes.length === 0 && boundaries.length === 0 && annotations.length === 0) {
    throw new Error("The current scenario has no diagram elements to export.");
  }

  const nodeWidth = 180;
  const nodeHeight = 72;
  const padding = 48;
  const xs = [
    ...annotations.flatMap(annotation => [annotation.position.x, annotation.position.x + Math.max(annotation.size.width, ...annotation.text.split("\n").map(line => line.length * 8 + 16))]),
    ...nodes.flatMap((node) => [node.position.x, node.position.x + nodeWidth]),
    ...boundaries.flatMap((boundary) => [
      boundary.position.x,
      boundary.position.x + boundary.size.width,
    ]),
  ];
  const ys = [
    ...annotations.flatMap(annotation => [annotation.position.y, annotation.position.y + Math.max(annotation.size.height, annotation.text.split("\n").length * 20 + 16)]),
    ...nodes.flatMap((node) => [node.position.y, node.position.y + nodeHeight]),
    ...boundaries.flatMap((boundary) => [
      boundary.position.y,
      boundary.position.y + boundary.size.height,
    ]),
  ];
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const width = Math.max(640, Math.max(...xs) - minX + padding);
  const height = Math.max(360, Math.max(...ys) - minY + padding);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const offset = (value: number, minimum: number) => value - minimum;

  const boundarySvg = boundaries
    .map((boundary) => {
      const color = boundary.type === "privacy" ? "#7c3aed" : "#0f6cbd";
      return `<g><rect x="${offset(boundary.position.x, minX)}" y="${offset(boundary.position.y, minY)}" width="${boundary.size.width}" height="${boundary.size.height}" rx="6" fill="${color}" fill-opacity="0.055" stroke="${color}" stroke-width="2" stroke-dasharray="9 6"/><text x="${offset(boundary.position.x, minX) + 12}" y="${offset(boundary.position.y, minY) + 22}" font-size="13" font-weight="600" fill="${color}">${escapeHtml(boundary.title)}</text></g>`;
    })
    .join("");
  const edgeSvg = edges
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return "";
      const points = [
        { x: source.position.x + nodeWidth / 2, y: source.position.y + nodeHeight / 2 },
        ...(edge.waypoints ?? []),
        { x: target.position.x + nodeWidth / 2, y: target.position.y + nodeHeight / 2 },
      ];
      const path = points
        .map((point, index) =>
          `${index === 0 ? "M" : "L"} ${offset(point.x, minX)} ${offset(point.y, minY)}`,
        )
        .join(" ");
      const middle = points[Math.floor(points.length / 2)];
      const labelX = offset(middle.x, minX);
      const labelY = offset(middle.y, minY) - 9;
      const number = scenario.edgeNumbers[edge.id] ?? "";
      return `<g><path d="${path}" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/><rect x="${labelX - 68}" y="${labelY - 14}" width="136" height="21" rx="4" fill="#ffffff" stroke="#cbd5e1"/><text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="11" fill="#1e293b">${escapeHtml(number ? `${number}. ${edge.title}` : edge.title)}</text></g>`;
    })
    .join("");
  const nodeSvg = nodes
    .map((node) => {
      const x = offset(node.position.x, minX);
      const y = offset(node.position.y, minY);
      const scope = resolveNodeReviewScope(node, scenario, doc.nodeTypes);
      return `<g><title>${escapeHtml(nodeDfdSummary(node, doc, scenario))}</title><rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="${scope.role.role === "Process" ? 18 : scope.role.role === "DataStore" ? 12 : 0}" fill="${node.color ?? "#ffffff"}" stroke="#334155" stroke-width="2"${scope.disposition === "outOfScope" ? ' stroke-dasharray="5 3"' : ""}/><text x="${x + 12}" y="${y + 22}" font-size="14" font-weight="600" fill="#0f172a">${escapeHtml(node.title)}</text><text x="${x + 12}" y="${y + 39}" font-size="11" fill="#64748b">${escapeHtml(nodeTypeLabel(node.type, doc.nodeTypes))}</text><text x="${x + 12}" y="${y + 53}" font-size="10" fill="#334155">${escapeHtml(DFD_ROLE_LABELS[scope.role.role])} / ${escapeHtml(scope.disposition)}</text></g>`;
    })
    .join("");
  const annotationSvg = annotations.map(annotation => `<g><title>${escapeHtml(annotation.text)}</title><text xml:space="preserve" font-size="14" fill="#242424">${annotation.text.split("\n").map((line, index) =>
    `<tspan x="${offset(annotation.position.x, minX) + 8}" y="${offset(annotation.position.y, minY) + 20 + index * 20}">${escapeHtml(line)}</tspan>`).join("")}</text></g>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#475569"/></marker><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dbe3ec"/></pattern></defs><rect width="100%" height="100%" fill="#f8fafc"/><rect width="100%" height="100%" fill="url(#grid)"/>${boundarySvg}${edgeSvg}${nodeSvg}${annotationSvg}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * 2);
    canvas.height = Math.ceil(height * 2);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas export is unavailable in this browser.");
    context.scale(2, 2);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadDiagramPng(dataUrl: string, documentFileName: string): void {
  const binary = atob(dataUrl.split(",")[1] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  downloadBlob(
    new Blob([bytes], { type: "image/png" }),
    `${safeFileStem(documentFileName)}-diagram.png`,
  );
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '<p class="empty">None.</p>';
  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
}

export function buildReviewReportHtml(options: {
  inventoryLabel?: string;
  inventoryRequired?: boolean;
  classificationDefinitions?: readonly CatalogDefinitionSnapshot[];
  doc: PsDocument;
  scenario: Scenario;
  diagramDataUrl?: string;
  documentFileName: string;
  appVersion: string;
}): string {
  const { doc, scenario, diagramDataUrl, documentFileName, appVersion } = options;
  const nodeIds = new Set(scenario.nodeIds);
  const edgeIds = new Set(scenario.edgeIds);
  const boundaryIds = new Set(scenario.boundaryIds);
  const nodes = doc.nodes.filter((node) => nodeIds.has(node.id));
  const edges = doc.edges.filter((edge) => edgeIds.has(edge.id));
  const boundaries = doc.boundaries.filter((boundary) => boundaryIds.has(boundary.id));
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
  const dataById = new Map(doc.data.map((item) => [item.id, item]));
  const relevantDataIds = new Set<string>();
  Object.values(scenario.nodeData).forEach((items) =>
    Object.keys(items).forEach((id) => relevantDataIds.add(id)),
  );
  for (const edge of edges) {
    for (const id of scenario.edgeRequestData[edge.id] ?? []) relevantDataIds.add(id);
    for (const id of scenario.edgeResponseData[edge.id] ?? []) relevantDataIds.add(id);
  }
  const data = doc.data.filter((item) => relevantDataIds.has(item.id));
  const issues = doc.issues.filter(
    (issue) =>
      (issue.scenarioIds.length === 0 || issue.scenarioIds.includes(scenario.id)) &&
      ((issue.targetKind === "node" && nodeIds.has(issue.targetId)) ||
        (issue.targetKind === "edge" && edgeIds.has(issue.targetId))),
  );
  const comments = doc.comments.filter((comment) => comment.scenarioId === scenario.id);
  const deviations = doc.deviations.filter(
    (deviation) =>
      deviation.scenarioIds.length === 0 ||
      deviation.scenarioIds.includes(scenario.id),
  );

  const dataNames = (ids: string[] | undefined) =>
    (ids ?? [])
      .map((id) => dataById.get(id)?.name ?? id)
      .map(escapeHtml)
      .join(", ") || "None";

  const nodeRows = nodes.map((node) => [
    escapeHtml(node.title),
    escapeHtml(nodeTypeLabel(node.type, doc.nodeTypes)),
    escapeHtml(nodeDfdSummary(node, doc, scenario)),
    escapeHtml(formatDfdValue(scenario.nodeScopeReasons?.[node.id]) || "Not specified"),
    escapeHtml(resolveNodeReviewScope(node, scenario, doc.nodeTypes).diagnostics.join(" ") || "None"),
    escapeHtml(node.description || "—"),
    escapeHtml(node.serviceTreeId || (options.inventoryRequired ? "Missing" : "Not specified")),
    escapeHtml(node.endpointRegex || "—"),
  ]);
  const edgeRows = edges
    .slice()
    .sort(
      (left, right) =>
        (scenario.edgeNumbers[left.id] ?? 0) -
        (scenario.edgeNumbers[right.id] ?? 0),
    )
    .map((edge) => {
      const protocol = resolveProtocolReference(edge.protocolId, doc.protocolDefinitions);
      const protocolLabel = protocol.status === "resolved"
        ? `${protocol.definition.label}${protocol.conflict ? " (saved conflict)" : ""}`
        : protocol.status === "unresolved" ? `${edge.protocolId} (unresolved)` : "Not specified";
      return [
      escapeHtml(scenario.edgeNumbers[edge.id] ?? "—"),
      escapeHtml(edge.title),
      escapeHtml(nodeById.get(edge.source)?.title ?? edge.source),
      escapeHtml(nodeById.get(edge.target)?.title ?? edge.target),
      escapeHtml(flowDfdSummary(edge, doc, scenario)),
      escapeHtml(protocolLabel),
      escapeHtml((edge.authenticationTypes ?? []).map(id => authTypeLabel(id, authenticationCatalogFor(doc))).join(", ") || "Not specified"),
      escapeHtml(edge.applicationId || "Not specified"),
      escapeHtml(edge.audience || "—"),
      escapeHtml(edge.productionIdentity ? formatProductionIdentity(edge.productionIdentity, doc.catalogDefinitions) : "None retained"),
      `<span class="flow-rights">${escapeHtml(formatRequiredAccessRights(edge.requiredAccessRights) || "Unspecified")}</span>`,
      dataNames(scenario.edgeRequestData[edge.id]),
      dataNames(scenario.edgeResponseData[edge.id]),
    ];
    });
  const dataRows = data.map((item) => {
    const storedAt = nodes
      .filter((node) => scenario.nodeData[node.id]?.[item.id] !== undefined)
      .map((node) => {
        const retention = scenario.nodeData[node.id][item.id];
        return `${escapeHtml(node.title)} (${escapeHtml(RETENTION_LABELS[retention] || "Unspecified")})`;
      })
      .join(", ") || "Not stored";
    return [
      escapeHtml(item.name),
      escapeHtml(dataClassificationLabel(item.classification, doc.catalogDefinitions, options.classificationDefinitions)),
      escapeHtml(item.sample || "—"),
      storedAt,
    ];
  });
  const issueRows = issues.map((issue) => [
    escapeHtml(issue.status),
    escapeHtml(issue.origin === "authored-threat" && !issue.kind ? "Authored threat note" : issue.kind ? "Analyze" : "Manual / accepted AI"),
    escapeHtml(issue.kind
      ? issue.notEvaluatedReason ? ISSUE_NOT_EVALUATED_LABELS[issue.notEvaluatedReason] : "No evaluation limitation recorded"
      : "Not applicable"),
    escapeHtml(issue.title),
    escapeHtml(
      issue.targetKind === "node"
        ? nodeById.get(issue.targetId)?.title ?? issue.targetId
        : doc.edges.find((edge) => edge.id === issue.targetId)?.title ?? issue.targetId,
    ),
    `<span class="flow-rights">${escapeHtml(issue.description)}${issue.origin === "authored-threat" && !issue.kind
      ? `\n\nJustification: ${escapeHtml(issue.justification || "(not supplied)")}` : ""}</span>`,
  ]);
  const metadataRows = [
    ...nodes.map(entity => ({ entity, kind: "Node" })),
    ...edges.map(entity => ({ entity, kind: "Flow" })),
  ].flatMap(({ entity, kind }) => Object.entries(entity.metadata ?? {}).map(([id, value]) => [
    escapeHtml(kind), escapeHtml(entity.title || entity.id),
    escapeHtml(entity.metadataFields?.find(field => field.id === id)?.label ?? `${id} (unresolved)`),
    escapeHtml(value),
  ]));
  const commentRows = comments.map((comment) => [
    escapeHtml(comment.status),
    escapeHtml(
      comment.targetKind === "node"
        ? nodeById.get(comment.targetId)?.title ?? comment.targetId
        : doc.edges.find((edge) => edge.id === comment.targetId)?.title ?? comment.targetId,
    ),
    escapeHtml(comment.text),
    escapeHtml(comment.replies.length),
  ]);
  const deviationRows = deviations.map((deviation) => {
    const target =
      deviation.targetKind === "node" && deviation.targetId
        ? nodeById.get(deviation.targetId)?.title ?? deviation.targetId
        : deviation.targetKind === "edge" && deviation.targetId
          ? doc.edges.find((edge) => edge.id === deviation.targetId)?.title ??
            deviation.targetId
          : "Document-wide";
    return [
      escapeHtml(deviation.status),
      escapeHtml(deviationKindLabel(deviation.kind, doc.catalogDefinitions)),
      escapeHtml(deviation.title),
      escapeHtml(target),
      escapeHtml(deviation.explanation),
      escapeHtml(deviation.evidenceIds.join(", ") || "—"),
      escapeHtml(
        deviation.sampleCalls
          ?.map(
            (call) =>
              `${call.source} → ${call.destination} (${call.count})`,
          )
          .join(" | ") || "—",
      ),
    ];
  });
  const workRows = doc.workItems.map((item) => [
    escapeHtml(item.description),
    item.link
      ? `<a href="${escapeHtml(item.link)}" rel="noreferrer">${escapeHtml(item.link)}</a>`
      : "—",
  ]);
  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(scenario.name)} review report</title>
<style>
.flow-rights{white-space:pre-wrap;overflow-wrap:anywhere}
:root{font-family:Segoe UI,Arial,sans-serif;color:#242424;background:#fff}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:0 auto;padding:32px}header{border-bottom:3px solid #0f6cbd;padding-bottom:18px;margin-bottom:24px}h1{font-size:26px;margin:0 0 6px}h2{font-size:18px;margin:28px 0 10px;color:#0f548c}p{line-height:1.5}.meta{display:flex;gap:18px;flex-wrap:wrap;color:#616161;font-size:13px}.summary{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:10px}.metric{border:1px solid #d1d1d1;padding:12px}.metric strong{display:block;font-size:22px;color:#0f6cbd}.diagram{width:100%;max-height:650px;object-fit:contain;border:1px solid #d1d1d1;background:#fafafa}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #d1d1d1;padding:7px;text-align:left;vertical-align:top}th{background:#f3f3f3}.empty{color:#616161}footer{margin-top:32px;padding-top:12px;border-top:1px solid #d1d1d1;color:#616161;font-size:11px}@media print{main{max-width:none;padding:12mm}.no-print{display:none}h2{break-after:avoid}tr,img{break-inside:avoid}.table-wrap{overflow:visible}}
</style></head><body><main>
<header><h1>SecureDesignStudio Review Report</h1><div class="meta"><span>Document: ${escapeHtml(documentFileName)}</span><span>Scenario: ${escapeHtml(scenario.name)}</span><span>Generated: ${escapeHtml(generatedAt)}</span></div></header>
<section><h2>Executive summary</h2><p>${escapeHtml(scenario.description || "No scenario description provided.")}</p><div class="summary"><div class="metric"><strong>${nodes.length}</strong>Nodes</div><div class="metric"><strong>${edges.length}</strong>Flows</div><div class="metric"><strong>${boundaries.length}</strong>Boundaries</div><div class="metric"><strong>${issues.length}</strong>Issues</div><div class="metric"><strong>${deviations.length}</strong>Deviations</div><div class="metric"><strong>${data.length}</strong>Data items</div></div></section>
${diagramDataUrl ? `<section><h2>Scenario diagram</h2><img class="diagram" src="${diagramDataUrl}" alt="${escapeHtml(scenario.name)} diagram"></section>` : ""}
<section><h2>Boundaries</h2><p>Network notes are declared intent, not verified enforcement or compliance. Blank means undocumented. Notes retained on privacy boundaries are inactive and are not shown here.</p>${table(["Title", "Type", "Subtype", ...BOUNDARY_NETWORK_FIELDS.map(field => field.label)], boundaries.map((boundary) => [
  escapeHtml(boundary.title), escapeHtml(boundary.type),
  escapeHtml(boundary.type === "privacy"
    ? boundary.privacySubtype ? privacyBoundaryTypeLabel(boundary.privacySubtype, doc.catalogDefinitions) : "Unspecified"
    : boundary.securitySubtype ? securityBoundaryTypeLabel(boundary.securitySubtype, doc.catalogDefinitions) : "Unspecified"),
  ...BOUNDARY_NETWORK_FIELDS.map(({ key }) => boundary.type === "security"
    ? `<span style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(formatBoundaryNetworkText(boundary[key]) || "Undocumented")}</span>`
    : "Inactive (security only)"),
]))}</section>
<section><h2>Node inventory</h2><p>DFD role is independent of service type. Scope excludes interiors only from LLM review, never fixed checks. Stored reasons on External Interactors are inactive.</p>${table(["Node", "Type", "DFD role / scope", "Stored scope reason", "Diagnostics", "Description", options.inventoryLabel ?? "Inventory ID", "Endpoint pattern"], nodeRows)}</section>
<section><h2>Canvas text annotations</h2><p>Nonsemantic, untrusted authored context. Not assets or review findings.</p>${table(["Text", "Position (x, y)", "Size (width, height)"],
  (doc.textAnnotations ?? []).filter(annotation => scenario.textAnnotationIds?.includes(annotation.id)).map(annotation => [
    `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(annotation.text)}</pre>`,
    escapeHtml(`${annotation.position.x}, ${annotation.position.y}`),
    escapeHtml(`${annotation.size.width}, ${annotation.size.height}`),
  ]))}</section>
<section><h2>Data flow inventory</h2><p>Communication profiles and authentication are declared design intent, not verified negotiated transport protection or deployed grants. Not specified is not proof of plaintext or encryption. Required access rights are not verified grants or compliance. Retained identity evidence is historical compatibility data.</p>${table(["#", "Flow", "Source", "Target", "Scope context", "Protocol", "Authentication", "Caller Application ID", "Audience", "Retained identity evidence", "Required access rights", "Request data", "Response data"], edgeRows)}</section>
<section><h2>Data inventory and retention</h2>${table(["Data element", "Classification", "Sample", "Stored / processed at"], dataRows)}</section>
${metadataRows.length ? `<section><h2>Custom metadata</h2>${table(["Type", "Element", "Field", "Value"], metadataRows)}</section>` : ""}
<section><h2>Security and privacy findings</h2><p>Active/Resolved is the review status, not an analysis result. Not re-evaluated findings may contain retained or partial evidence. No recorded limitation does not certify freshness or complete model coverage.</p>${table(["Status", "Source", "Evaluation", "Finding", "Affected element", "Details"], issueRows)}</section>
<section><h2>Comments and discussions</h2>${table(["Status", "Affected element", "Comment", "Replies"], commentRows)}</section>
<section><h2>Deviations</h2>${table(["Status", "Kind", "Deviation", "Affected element", "Explanation", "Evidence IDs", "Sample calls"], deviationRows)}</section>
<section><h2>Work items</h2>${table(["Description", "Tracking link"], workRows)}</section>
<footer>Generated by SecureDesignStudio v${escapeHtml(appVersion)}. Analyze findings are deterministic policy checks. AI-assisted findings appear only after a user accepts them into Issues or Work Items. Review all generated content before relying on it.</footer>
</main></body></html>`;
}

export function downloadReviewReport(html: string, documentFileName: string): void {
  downloadBlob(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    `${safeFileStem(documentFileName)}-review-report.html`,
  );
}
