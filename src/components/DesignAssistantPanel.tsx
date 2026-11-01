import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SERVICES } from "../services";
import { useStore } from "../store";
import { referencedCatalogDefinitions } from "../catalogDefinitions";
import { buildDfdReviewContext } from "../dfdReviewContext";
import { formatGuidanceReferences } from "../aiDesignGuidance";
import { assertAiRequestBudget } from "../../shared/aiDesignGuidance";
import {
  askDesignAssistant,
  type AssistantFinding,
  type AssistantMode,
  type AssistantReference,
  type AssistantResponse,
} from "../designAssistant";
import { useUiShell } from "../uiShell";
import { useAiProvider } from "../aiProvider";
import { AiProviderSelector } from "./AiProviderSelector";
import {
  useBreachSimulation,
  type BreachSimulationPlan,
} from "../breachSimulation";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  references?: AssistantReference[];
};

const SUGGESTED_PROMPT_GROUPS = [
  {
    label: "Risk analysis",
    prompts: [
      "Identify the highest-risk trust boundary crossings and missing controls",
      "Map model evidence to relevant OWASP Top 10 risk categories",
      "Review privacy risks, data exposure, retention, and geographic transfers",
    ],
  },
  {
    label: "Attack patterns",
    prompts: [
      "Trace plausible attack paths from external entry points to sensitive data",
      "Identify spoofing, tampering, authentication bypass, and data exfiltration patterns",
      "Describe abuse cases and mitigations for the most exposed flows",
    ],
  },
  {
    label: "CVE readiness",
    prompts: [
      "Assess whether this model contains enough product and version evidence for CVE analysis",
      "List the components and exact version details needed for an external CVE lookup",
    ],
  },
] as const;

function messageId(): string {
  return `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const SEVERITY_SCORE = { critical: 92, high: 76, medium: 54, low: 28 } as const;
const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 } as const;

function buildConnectedPath(
  finding: AssistantFinding,
  nodes: Array<{ id: string; title: string }>,
  edges: Array<{ id: string; source: string; target: string; title: string }>,
): AssistantReference[] {
  if (edges.length === 0) return finding.references.filter((reference) => reference.kind === "node");
  const referencedIds = new Set(finding.references.map((reference) => reference.id));
  const seed = edges.find((edge) => referencedIds.has(edge.id))
    ?? edges.find((edge) => referencedIds.has(edge.source) || referencedIds.has(edge.target))
    ?? edges[0];
  const pathEdges = [seed];
  const used = new Set([seed.id]);
  let head = seed.source;
  let tail = seed.target;
  while (pathEdges.length < 4) {
    const previous = edges.find((edge) => edge.target === head && !used.has(edge.id));
    if (!previous) break;
    pathEdges.unshift(previous);
    used.add(previous.id);
    head = previous.source;
  }
  while (pathEdges.length < 5) {
    const next = edges.find((edge) => edge.source === tail && !used.has(edge.id));
    if (!next) break;
    pathEdges.push(next);
    used.add(next.id);
    tail = next.target;
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const steps: AssistantReference[] = [];
  const firstNode = nodeById.get(pathEdges[0].source);
  if (firstNode) steps.push({ kind: "node", id: firstNode.id, label: firstNode.title });
  for (const edge of pathEdges) {
    steps.push({ kind: "edge", id: edge.id, label: edge.title || "Data flow" });
    const target = nodeById.get(edge.target);
    if (target) steps.push({ kind: "node", id: target.id, label: target.title });
  }
  return steps;
}

export function DesignAssistantPanel({
  visible = true, inspectorClosed = false,
}: { visible?: boolean; inspectorClosed?: boolean } = {}) {
  const aiProvider = useAiProvider();
  const providerRef = useRef(aiProvider.provider);
  const {
    doc,
    documentSessionId,
    collab,
    activeScenario,
    setActiveScenarioId,
    authenticationCatalog,
    protocolLibrary,
    classificationDefinitions,
    nodeTypeCatalog,
    selection,
    setSelection,
    setFocusTarget,
    addIssue,
    createWorkItem,
    updateWorkItem,
    assistantFindings: findings,
    setAssistantFindings: setFindings,
    acceptedFindingIds,
    setAcceptedFindingIds,
    assistantAnalysis,
    setAssistantAnalysis,
  } = useStore();
  const { openInspector } = useUiShell();
  const simulation = useBreachSimulation();
  const [mode, setMode] = useState<AssistantMode>("analyze");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reviewSession = `${documentSessionId}:${collab.room ?? ""}`;
  const sessionRef = useRef(reviewSession);
  const analysisRoot = useRef<HTMLDivElement>(null);
  const conversationRoot = useRef<HTMLDivElement>(null);
  const conversationScroll = useRef(0);
  const modeScroll = useRef({ analyze: 0, chat: 0 });
  useLayoutEffect(() => {
    if (sessionRef.current === reviewSession) return;
    sessionRef.current = reviewSession;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages([]);
    setQuestion("");
    setFindings([]);
    setAssistantAnalysis(null);
    setAcceptedFindingIds(new Set());
    setSelectedFindingId(null);
    modeScroll.current = { analyze: 0, chat: 0 };
    conversationScroll.current = 0;
    simulation.reset();
    setError(null);
  }, [reviewSession]);
  useLayoutEffect(() => {
    if (analysisRoot.current) analysisRoot.current.scrollTop = modeScroll.current[mode];
    if (conversationRoot.current) conversationRoot.current.scrollTop = conversationScroll.current;
  }, [mode]);
  useLayoutEffect(() => {
    if (!inspectorClosed || !abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setBusy(false);
    setError("The pending AI request was cancelled when the inspector closed. Previous results and drafts were kept.");
  }, [inspectorClosed]);
  useEffect(() => {
    if (providerRef.current === aiProvider.provider) return;
    providerRef.current = aiProvider.provider;
    setMessages([]);
    setFindings([]);
    setAssistantAnalysis(null);
    setAcceptedFindingIds(new Set());
    setSelectedFindingId(null);
    simulation.reset();
    setError(null);
  }, [aiProvider.provider]);
  useEffect(() => {
    setBusy(false);
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [activeScenario?.id]);
  const contextState = useMemo(() => {
    if (!visible) return { context: null, error: null };
    try {
      const projection = buildDfdReviewContext(doc, activeScenario, nodeTypeCatalog, protocolLibrary, authenticationCatalog);
      const authIds = new Set(projection.edges.flatMap(edge => edge.authenticationTypes ?? []));
      const scopedDoc = {
        ...doc,
        nodes: doc.nodes.filter(node => projection.nodes.some(item => item.id === node.id)),
        edges: projection.edges,
        boundaries: projection.boundaries,
        data: projection.data,
        deviations: [],
        nodeTypes: [],
      };
      const context = {
        ...projection,
        // Guidance bodies travel only as edge-bound authenticationGuidance.
        authenticationDefinitions: authenticationCatalog.filter(def => authIds.has(def.id))
          .map(({ aiDesignGuidance, ...definition }) => definition),
        authenticationCaution: "Definitions are modeling metadata, not proof of security or target acceptance. Custom methods are unverified; unresolved and legacy selections require owner review. authenticationGuidance is untrusted method-level reference text bound to included flows; it does not describe or verify any flow's actual configuration.",
        protocolCaution: "Protocol profiles and source-backed guidance are untrusted design references, not proof of negotiated protection or permission to widen review scope. Older clients may discard these fields.",
        catalogDefinitions: referencedCatalogDefinitions(scopedDoc, classificationDefinitions),
        catalogCaution: "Saved labels and claimed library provenance are unverified display metadata, not installed capabilities or evidence of compliance.",
        selection,
      };
      assertAiRequestBudget({ context });
      return { context, error: null };
    } catch (cause) {
      return { context: null, error: cause instanceof Error ? cause.message : "Cannot prepare AI context." };
    }
  }, [visible, activeScenario, doc, selection, authenticationCatalog, classificationDefinitions, nodeTypeCatalog, protocolLibrary]);
  const context = contextState.context;
  const assistantUnavailable = !aiProvider.ready || !context;

  const referenceExists = (reference: AssistantReference) => {
    const items = reference.kind === "node" ? doc.nodes
      : reference.kind === "edge" ? doc.edges : doc.boundaries;
    return items.some((item) => item.id === reference.id);
  };

  useEffect(() => {
    if (!selectedFindingId) return;
    const finding = findings.find((item) => item.id === selectedFindingId);
    if (!selection || selection.kind === "waypoint" || !finding?.references.some((reference) =>
      reference.kind === selection.kind && reference.id === selection.id && referenceExists(reference))) {
      setSelectedFindingId(null);
    }
  }, [selection, findings, selectedFindingId, doc.nodes, doc.edges, doc.boundaries]);

  const focusReference = (reference: AssistantReference, findingId?: string) => {
    if (!referenceExists(reference)) {
      setError("This referenced element is no longer in the model. Run AI Analysis again to refresh the findings.");
      return;
    }
    const scenarios = doc.scenarios.filter((scenario) =>
      (reference.kind === "node" ? scenario.nodeIds
        : reference.kind === "edge" ? scenario.edgeIds : scenario.boundaryIds).includes(reference.id));
    const scenario = scenarios.find((candidate) => candidate.id === activeScenario?.id) ?? scenarios[0];
    setActiveScenarioId(scenario?.id ?? null);
    setSelection({ kind: reference.kind, id: reference.id });
    setFocusTarget({ kind: reference.kind, id: reference.id });
    setSelectedFindingId(findingId ?? null);
  };

  const acceptAsIssue = (finding: AssistantFinding) => {
    const target = finding.references.find(
      (reference) => (reference.kind === "node" || reference.kind === "edge") && referenceExists(reference),
    );
    if (!target || (target.kind !== "node" && target.kind !== "edge")) return;
    if (assistantAnalysis && !doc.scenarios.some(scenario => scenario.id === assistantAnalysis.scenarioId)) {
      setError("The analyzed scenario no longer exists. Run AI Analysis again before creating an issue.");
      return;
    }
    addIssue(
      target.kind,
      target.id,
      assistantAnalysis ? [assistantAnalysis.scenarioId] : activeScenario ? [activeScenario.id] : [],
      finding.title,
      `${finding.rationale}\n\nRecommended action: ${finding.recommendation}${formatGuidanceReferences(finding.guidanceReferences)}`,
      undefined,
      finding.guidanceReferences,
    );
    setAcceptedFindingIds((current) => new Set(current).add(finding.id));
    openInspector("issues");
  };

  const acceptAsWorkItem = (finding: AssistantFinding) => {
    const item = createWorkItem();
    updateWorkItem(item.id, {
      description: `${finding.title}\n\n${finding.recommendation}${formatGuidanceReferences(finding.guidanceReferences)}`,
    });
    setAcceptedFindingIds((current) => new Set(current).add(finding.id));
    openInspector("work");
  };

  const runRequest = async (requestMode: AssistantMode, prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || busy || !activeScenario || !context || !aiProvider.ready) return null;
    const finishRequest = aiProvider.beginRequest();
    const requestSession = sessionRef.current;
    const requestedScenario = { id: activeScenario.id, name: activeScenario.name };

    if (requestMode === "chat") {
      setMessages((current) => [
        ...current,
        { id: messageId(), role: "user", text: trimmed },
      ]);
      setQuestion("");
    }

    setBusy(true);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 100_000);
    try {
      const response: AssistantResponse = await askDesignAssistant(
        { mode: requestMode, question: trimmed, context, ...(__PS_LOCAL_AI__ ? { provider: aiProvider.provider } : {}) },
        controller.signal,
      );
      if (controller.signal.aborted || abortRef.current !== controller || sessionRef.current !== requestSession) return null;
      if (requestMode === "chat") {
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            text: response.answer,
            references: response.references,
          },
        ]);
      } else {
        setFindings(response.findings);
        setAssistantAnalysis({
          documentSessionId, scenarioId: requestedScenario.id, scenarioName: requestedScenario.name,
          createdAt: Date.now(), answer: response.answer,
        });
        setAcceptedFindingIds(new Set());
        setSelectedFindingId(null);
      }
      return response;
    } catch (requestError) {
      if (controller.signal.aborted && abortRef.current === controller) {
        setError("The AI request timed out. No pending response was applied; try a smaller prompt.");
      } else if (abortRef.current === controller) {
        setError(requestError instanceof Error ? requestError.message : "The AI request failed.");
      }
      return null;
    } finally {
      window.clearTimeout(timer);
      finishRequest();
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const simulateBreach = async () => {
    if (!context) return;
    let availableFindings = findings;
    if (availableFindings.length === 0 || (assistantAnalysis && assistantAnalysis.scenarioId !== activeScenario?.id)) {
      const response = await runRequest(
        "analyze",
        "Find the most plausible attack path from an entry point to sensitive data. Return references to every involved node and edge, plus concrete mitigations.",
      );
      availableFindings = response?.findings ?? [];
    }
    const finding = [...availableFindings].sort(
      (left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity],
    )[0];
    if (!finding) return;
    const steps = buildConnectedPath(finding, context.nodes, context.edges);
    if (steps.length === 0) {
      setError("Add at least one connected flow to simulate a breach.");
      return;
    }
    const plan: BreachSimulationPlan = {
      title: finding.title,
      severity: finding.severity,
      steps,
      mitigations: [...new Set(
        [...availableFindings]
          .sort((left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity])
          .map((candidate) => candidate.recommendation.trim() + formatGuidanceReferences(candidate.guidanceReferences))
          .filter(Boolean),
      )].slice(0, 4),
    };
    simulation.start(plan);
  };

  const createMitigationWorkItems = () => {
    if (!simulation.plan) return;
    for (const mitigation of simulation.plan.mitigations) {
      const item = createWorkItem();
      updateWorkItem(item.id, { description: mitigation });
    }
    simulation.reset();
    openInspector("work");
  };

  const contextSummary = activeScenario
    ? `${activeScenario.name} · ${context?.nodes.length ?? 0} nodes · ${context?.edges.length ?? 0} flows`
    : "No active scenario";

  return (
    <div ref={analysisRoot} className={`ps-assistant${mode === "analyze" ? " is-analysis" : ""}`}
      data-assistant-scroll="panel" tabIndex={0}
      onScroll={event => { modeScroll.current[mode] = event.currentTarget.scrollTop; }}>
      {mode === "analyze" && findings.length > 0 && <button type="button" className="ps-assistant-jump" onClick={() => {
        const root = analysisRoot.current;
        const results = root?.querySelector<HTMLElement>(".ps-assistant-findings");
        if (root && results) root.scrollTop += results.getBoundingClientRect().top - root.getBoundingClientRect().top;
      }}>Go to AI findings ({findings.length})</button>}
      <AiProviderSelector />
      <div className="ps-assistant-mode" role="tablist" aria-label="Design Assistant modes">
        {(["analyze", "chat"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={mode === candidate}
            onClick={() => {
              if (analysisRoot.current) modeScroll.current[mode] = analysisRoot.current.scrollTop;
              setMode(candidate);
            }}
          >
            {candidate === "chat" ? "Chat" : "AI Analysis"}
          </button>
        ))}
      </div>

      <div className="ps-assistant-context" aria-label="Included model context">
        <span>Current context</span>
        <strong>{contextSummary}</strong>
      </div>
      {contextState.error && <div className="ps-assistant-notice" role="alert">{contextState.error}</div>}

      <div className="ps-assistant-notice ps-service-notice" role={SERVICES.assistant.state === "invalid" ? "alert" : "status"}>
        {SERVICES.assistant.message}
        {SERVICES.assistant.enabled && <> <code>{SERVICES.assistant.endpoint}</code>
          {SERVICES.assistant.endpoint.startsWith("/") && " (same origin)"}</>}
      </div>

      {!activeScenario && (
        <div id="ps-assistant-scenario-notice" className="ps-assistant-notice" role="status">
          {doc.scenarios.length > 0
            ? 'AI Analysis and Chat are disabled because no scenario is selected. Choose a scenario from the Scenario selector in the command bar instead of "(Show all)".'
            : "AI Analysis and Chat require a scenario. This model has no scenarios. Create one with Model > New scenario, then add the nodes and flows you want to review."}
        </div>
      )}

      {mode === "chat" ? (
        <>
          <div ref={conversationRoot} className="ps-assistant-conversation" data-assistant-scroll="conversation"
            onScroll={event => { conversationScroll.current = event.currentTarget.scrollTop; }} aria-live="polite">
            {messages.length === 0 && (
              <div className="ps-assistant-welcome">
                <span className="ps-assistant-mark" aria-hidden="true">
                  <span>✦</span>
                  <span>✦</span>
                </span>
                <div>
                  <strong>Design Assistant</strong>
                  <p>
                    Ask about threats, privacy risks, data flows, or the current
                    scenario.
                  </p>
                </div>
              </div>
            )}
            {messages.length === 0 && (
              <div className="ps-assistant-suggestions" aria-label="Suggested prompts">
                {SUGGESTED_PROMPT_GROUPS.map((group) => (
                  <section key={group.label} className="ps-assistant-suggestion-group">
                    <h3>{group.label}</h3>
                    {group.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={assistantUnavailable || !activeScenario || busy}
                        onClick={() => void runRequest("chat", prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`ps-assistant-message is-${message.role}`}
              >
                <strong>
                  {message.role === "assistant" && (
                    <span className="ps-assistant-mark" aria-hidden="true">
                      <span>✦</span>
                      <span>✦</span>
                    </span>
                  )}
                  {message.role === "user" ? "You" : "Design Assistant"}
                </strong>
                <p>{message.text}</p>
                {message.references && message.references.length > 0 && (
                  <div className="ps-assistant-actions">
                    {message.references.slice(0, 4).map((reference) => (
                      <button
                        key={`${reference.kind}:${reference.id}`}
                        type="button"
                        disabled={!referenceExists(reference)}
                        title={!referenceExists(reference) ? "Referenced element is no longer in the model" : undefined}
                        onClick={() => focusReference(reference)}
                      >
                        Focus {reference.label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {busy && (
              <div className="ps-assistant-progress" role="status">
                <span>Reviewing the model…</span>
                <div aria-hidden="true" />
              </div>
            )}
          </div>
          <form
            className="ps-assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void runRequest("chat", question);
            }}
          >
            <label htmlFor="ps-assistant-question">Ask about this model</label>
            <div>
              <textarea
                id="ps-assistant-question"
                value={question}
                disabled={assistantUnavailable || busy || !activeScenario}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void runRequest("chat", question);
                  }
                }}
                placeholder="Ask about threats, privacy, or data flows"
                rows={3}
              />
              <button
                type="submit"
                aria-label="Send question"
                title="Send question"
                disabled={
                  assistantUnavailable || busy || !activeScenario || !question.trim()
                }
              >
                Send
              </button>
            </div>
            <small>Current scenario and selection are included.</small>
          </form>
        </>
      ) : (
        <div className="ps-assistant-analysis">
          <div className="ps-assistant-analysis-intro">
            <h3>Analyze with Design Assistant</h3>
            <p>
              Review the current scenario for STRIDE threats, privacy risks,
              boundary crossings, authentication gaps, and missing controls.
            </p>
            <button
              type="button"
              className="ps-assistant-primary"
              disabled={assistantUnavailable || busy || !activeScenario}
              onClick={() =>
                void runRequest(
                  "analyze",
                  "Analyze this scenario for STRIDE threats, privacy risks, and missing controls.",
                )
              }
            >
              {busy ? "Analyzing…" : "Analyze model"}
            </button>
            <button
              type="button"
              className="ps-assistant-simulate"
              disabled={assistantUnavailable || busy || !activeScenario}
              onClick={() => void simulateBreach()}
            >
              {busy ? "Finding attack path…" : "Simulate breach"}
            </button>
          </div>
          {assistantAnalysis && <details className="ps-assistant-analysis-summary">
            <summary>Analysis snapshot: {assistantAnalysis.scenarioName}</summary>
            <p>{assistantAnalysis.answer}</p>
            <p className="ps-field-help">Results describe the analyzed snapshot. Re-analyze to reflect later model edits.</p>
          </details>}
          {simulation.plan && (
            <section className="ps-breach-simulation" aria-live="polite">
              <div className="ps-breach-heading">
                <div>
                  <span>Live attack path</span>
                  <h3>{simulation.plan.title}</h3>
                </div>
                <strong className={`is-${simulation.plan.severity}`}>
                  {SEVERITY_SCORE[simulation.plan.severity]}/100
                </strong>
              </div>
              <div
                className="ps-breach-progress"
                role="progressbar"
                aria-label="Breach simulation progress"
                aria-valuemin={0}
                aria-valuemax={simulation.plan.steps.length}
                aria-valuenow={Math.max(0, simulation.currentStepIndex + 1)}
              >
                <span style={{ width: `${Math.max(0, ((simulation.currentStepIndex + 1) / simulation.plan.steps.length) * 100)}%` }} />
              </div>
              <ol className="ps-breach-steps">
                {simulation.plan.steps.map((step, index) => (
                  <li
                    key={`${step.kind}:${step.id}`}
                    className={index === simulation.currentStepIndex ? "is-current" : index < simulation.currentStepIndex ? "is-complete" : ""}
                  >
                    <span>{index + 1}</span>
                    <button
                      type="button"
                      disabled={!referenceExists(step)}
                      title={!referenceExists(step) ? "Referenced element is no longer in the model" : undefined}
                      onClick={() => focusReference(step)}
                    >
                      {step.label || step.kind}
                    </button>
                  </li>
                ))}
              </ol>
              {simulation.status === "complete" && (
                <div className="ps-breach-impact">
                  <strong>Target reached</strong>
                  <span>{simulation.plan.steps.at(-1)?.label}</span>
                </div>
              )}
              <div className="ps-assistant-actions">
                {simulation.status === "playing" && <button type="button" onClick={simulation.pause}>Pause</button>}
                {simulation.status === "paused" && <button type="button" onClick={simulation.resume}>Resume</button>}
                <button type="button" onClick={() => simulation.start(simulation.plan!)}>Restart</button>
                <button type="button" onClick={simulation.reset}>Close</button>
              </div>
              {simulation.status === "complete" && simulation.plan.mitigations.length > 0 && (
                <div className="ps-breach-mitigations">
                  <strong>Recommended protections</strong>
                  <ul>{simulation.plan.mitigations.map((mitigation) => <li key={mitigation}>{mitigation}</li>)}</ul>
                  <button type="button" className="ps-assistant-primary" onClick={createMitigationWorkItems}>
                    Create {simulation.plan.mitigations.length} work items
                  </button>
                </div>
              )}
            </section>
          )}
          {findings.length > 0 && (
            <div className="ps-assistant-findings" aria-live="polite">
              <h3>AI findings <span>{findings.length}</span></h3>
              {findings.map((finding) => {
                const target = finding.references.find(referenceExists);
                const selected = finding.id === selectedFindingId;
                return (
                  <article key={finding.id} data-finding-id={finding.id} className={`ps-assistant-finding${selected ? " ps-assistant-finding-selected" : ""}`}>
                    <button
                      type="button"
                      className="ps-assistant-finding-target"
                      aria-label={`Select finding: ${finding.title}`}
                      aria-pressed={selected}
                      disabled={!target}
                      onClick={() => target && focusReference(target, finding.id)}
                      title={target ? `Focus ${target.label}` : "No available diagram reference"}
                    >
                      <span className="ps-assistant-finding-heading">
                        <span className={`is-${finding.severity}`}>{finding.severity}</span>
                        <span>{finding.category}</span>
                      </span>
                      <span className="ps-assistant-finding-title">{finding.title}</span>
                    </button>
                    <p>{finding.rationale}</p>
                    <strong>Recommended action</strong>
                    <p>{finding.recommendation}</p>
                    {!target && <p className="ps-assistant-reference-unavailable">No available diagram reference for this finding.</p>}
                    <div className="ps-assistant-actions">
                      {target && (
                        <button
                          type="button"
                          onClick={() => focusReference(target, finding.id)}
                        >
                          Focus
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={
                          acceptedFindingIds.has(finding.id) ||
                          !finding.references.some(
                            (reference) =>
                              (reference.kind === "node" || reference.kind === "edge") && referenceExists(reference),
                          )
                        }
                        onClick={() => acceptAsIssue(finding)}
                      >
                        Create issue
                      </button>
                      <button
                        type="button"
                        disabled={acceptedFindingIds.has(finding.id)}
                        onClick={() => acceptAsWorkItem(finding)}
                      >
                        Create work item
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <div className="ps-assistant-error" role="alert">{error}</div>}
    </div>
  );
}
