export const autosaveKey = "secure-design-studio:autosave:v1";

export const publicPowerPlatformPrompt = "i want a powerpages application that is backed by a copilot ai to summerize data i have in a dataverse instance";

export function publicPowerPlatformDesignFixture() {
  return {
    answer: "Synthetic proposed Power Pages site, Copilot Studio agent and Dataverse data path; verify integration and permissions.",
    assumptions: ["Copilot means a Copilot Studio agent; confirm the supported site integration and effective caller permissions."],
    design: {
      scenario: { name: "Dataverse summarization", description: "Synthetic design intent, not deployment evidence." },
      nodes: [
        { id: "visitor", type: "", title: "Visitor", description: "Intended summary recipient.", dfdRole: "ExternalInteractor" },
        { id: "site", type: "PowerPages", title: "Power Pages site", description: "Proposed hosted visitor experience; verify authentication and table permissions.", dfdRole: "Process" },
        { id: "agent", type: "CopilotStudio", title: "Copilot Studio agent", description: "Proposed summarization agent; verify channel integration, grounding scope and permissions.", dfdRole: "Process" },
        { id: "data", type: "Dataverse", title: "Dataverse instance", description: "Proposed business-data source; verify row/column authorization for the connection.", dfdRole: "DataStore" },
      ],
      edges: [
        { id: "visit", source: "visitor", target: "site", title: "Request summary", description: "Verify visitor identity and the intended result audience.",
          authenticationType: null, requestDataIds: ["query"], responseDataIds: ["summary"], dataMode: "replace" },
        { id: "ask", source: "site", target: "agent", title: "Ask agent", description: "Select and verify the supported site-to-agent integration; no authentication claim yet.",
          authenticationType: null, requestDataIds: ["query"], responseDataIds: ["summary"], dataMode: "replace" },
        { id: "retrieve", source: "agent", target: "data", title: "Retrieve permitted records", description: "Verify caller versus connection identity and least-privilege grounding query.",
          authenticationType: null, requestDataIds: ["query"], responseDataIds: ["records"], dataMode: "replace" },
      ],
      boundaries: [{ id: "service", type: "security", title: "Proposed solution boundary", nodeIds: ["site", "agent", "data"], membershipMode: "replace" }],
      data: [
        { id: "query", name: "Synthetic summary query", classification: "EUPI" },
        { id: "records", name: "Synthetic permitted business records", classification: "Customer Content" },
        { id: "summary", name: "Synthetic business summary", classification: "Customer Content" },
      ],
    },
  };
}

export function scenarioDfdJsonFixture() {
  return {
    scenarios: { threatModel: { scenarios: [
      { id: "json-primary", name: "JSON primary", description: "Synthetic primary scenario" },
      { id: "json-archive", name: "JSON archive", description: "Synthetic archive scenario" },
      { id: "json-empty", name: "JSON empty" },
    ] } },
    dfds: { items: [
      { diagram: {
        id: "json-archive",
        nodes: [
          { id: "json-api", type: "process", label: "API", position: { x: 320, y: 150 } },
          { id: "json-store", type: "datastore", label: "Archive", position: { x: 800, y: 150 } },
        ],
        edges: [{ id: "json-archive-edge", source: "json-api", target: "json-store", label: "3. Archive" }],
      } },
      { diagram: {
        id: "json-primary",
        nodes: [
          { id: "json-outer", type: "boundary", label: "Outer", position: { x: 100, y: 80 },
            size: { width: 550, height: 300 }, nodes: [
              { id: "json-client", type: "externalinteractor", label: "Client", position: { x: 30, y: 40 } },
              { id: "json-inner", type: "boundary", label: "Inner", position: { x: 200, y: 40 },
                size: { width: 250, height: 160 }, nodes: [
                  { id: "json-api", type: "process", label: "API", position: { x: 20, y: 30 } },
                ] },
              { id: "json-note", type: "freetext", label: "Synthetic annotation", position: { x: 0, y: 0 } },
            ] },
          { id: "json-api-twin", type: "process", label: "API", position: { x: 700, y: 450 } },
        ],
        edges: [
          { id: "json-multi", source: "json-client", target: "json-api", label: "2. Send\nOpaque detail\n4a. Follow-up" },
          { id: "json-reply", source: "json-api", target: "json-client", label: "1. Reply" },
          { id: "json-to-note", source: "json-client", target: "json-note", label: "8. Annotation link" },
          { id: "json-to-boundary", source: "json-outer", target: "json-client", label: "9. Boundary link" },
        ],
      } },
      { diagram: { id: "json-unmatched", nodes: [], edges: [] } },
    ] },
  };
}

export function modelFixture() {
  const node = (id, title, x) => ({
    id, title, description: "Synthetic browser-test process", type: "nt_browser",
    serviceTreeId: "", endpointRegex: "", position: { x, y: 120 },
  });
  const edge = (id, source, target, title) => ({
    id, source, target, title, description: "", authenticationTypes: [],
    waypoints: [],
  });
  const scenario = (id, name, nodeIds, edgeIds, edgeNumbers) => ({
    id, name, description: "Synthetic browser-test scenario", nodeIds, edgeIds,
    edgeNumbers, boundaryIds: [], nodeData: {},
    edgeRequestData: {}, edgeResponseData: {},
  });
  const primary = scenario("s_primary", "Primary", ["n_client", "n_api"],
    ["e_request", "e_parallel"], { e_request: 7, e_parallel: 9 });
  primary.edgeRequestData = { e_request: ["d_request"] };
  primary.edgeResponseData = { e_request: ["d_response"] };
  return {
    format: "secure-design-studio-diagram",
    version: 2,
    doc: {
      version: 1,
      nodeTypes: [{
        id: "nt_browser", label: "Browser test process",
        definition: {
          serviceTreeId: "", endpointRegex: "^$", templateHints: [],
          allowedAuthMethods: [], allowedDataTypes: [], policyStatus: "Unspecified",
          category: "Custom", catalogSource: "Document", resourceProviders: [],
          icon: "generic/component.svg", description: "Synthetic browser-test node type",
        },
      }],
      nodes: [node("n_client", "Client", 100), node("n_api", "API", 450), node("n_archive", "Archive", 800)],
      edges: [
        edge("e_request", "n_client", "n_api", "Request payload"),
        edge("e_parallel", "n_client", "n_api", "Parallel flow"),
        edge("e_archive", "n_api", "n_archive", "Archive payload"),
      ],
      scenarios: [primary,
        scenario("s_archive", "Archive", ["n_api", "n_archive"], ["e_archive"], { e_archive: 1 })],
      boundaries: [],
      data: [
        { id: "d_request", name: "Synthetic request", description: "", classification: "EUII" },
        { id: "d_response", name: "Synthetic response", description: "", classification: "EUPI" },
      ],
      comments: [], issues: [], deviations: [], workItems: [],
    },
    view: {
      activeScenarioId: "s_primary",
      filter: { text: "", nodeType: "", authType: "", dataClassification: "" },
    },
  };
}

export function unavailableIssueFixture() {
  const model = modelFixture();
  const issue = (id, kind, status) => ({
    id, kind, status, targetKind: "edge", targetId: "e_request",
    scenarioIds: ["s_primary"], title: `Saved ${id}`, description: "Synthetic retained evidence.",
    createdAt: 1234, replies: [{ id: `ir_${id}`, text: "Saved review decision.", createdAt: 2345 }],
    resolutionLink: "https://example.invalid/remediation",
  });
  model.doc.issues = [
    issue("i_unavailable", "Synthetic_missing_rule", "Resolved"),
    issue("i_policy", "Edge_data_not_accepted", "Active"),
    issue("i_clear", "Edge_must_have_data", "Active"),
    issue("i_manual", undefined, "Active"),
  ];
  return model;
}

export function unavailableCatalogFixture() {
  const model = modelFixture();
  model.doc.data[0].classification = "ExampleRestricted";
  model.doc.data[0].sample = "SYNTHETIC_ONLY";
  model.doc.edges[0].authenticationTypes = ["ApiKey"];
  model.doc.edges[0].productionIdentity = {
    kind: "AppId", appId: "11111111-1111-4111-8111-111111111111", tenant: "ExampleTenant",
  };
  model.doc.boundaries = [
    { id: "b_security", type: "security", securitySubtype: "ExampleSecurity",
      title: "Synthetic security boundary", position: { x: 100, y: 340 },
      size: { width: 300, height: 180 }, nodeIds: [] },
    { id: "b_privacy", type: "privacy", privacySubtype: "ExamplePrivacy",
      title: "Synthetic privacy boundary", position: { x: 470, y: 340 },
      size: { width: 300, height: 180 }, nodeIds: [] },
  ];
  model.doc.scenarios[0].boundaryIds = ["b_security", "b_privacy"];
  model.doc.scenarios[0].nodeData = { n_api: { d_request: "ProcessingNoStorage" } };
  const definition = model.doc.nodeTypes[0].definition;
  delete definition.policyStatus;
  definition.defaultPrivacyBoundary = "ExamplePrivacy";
  definition.allowedDataTypes = [
    { id: "ExampleRestricted", retention: "ProcessingNoStorage", action: "Deny" },
    { id: "*", retention: "*", action: "Allow" },
  ];
  model.doc.deviations = [{
    id: "dv_example", key: "synthetic:catalog", kind: "example-evidence",
    title: "Synthetic evidence", description: "No external evidence was fetched.",
    explanation: "Retain the original evidence kind.", status: "Active",
    evidenceIds: ["synthetic:1"], scenarioIds: ["s_primary"], createdAt: 1, updatedAt: 2,
  }];
  return model;
}

export function catalogReferenceSnapshot(doc) {
  const definition = doc.nodeTypes.find(type => type.id === "nt_browser").definition;
  return {
    classification: doc.data.find(item => item.id === "d_request").classification,
    identities: doc.edges.map(edge => ({ id: edge.id, identity: edge.productionIdentity }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    securitySubtype: doc.boundaries.find(boundary => boundary.id === "b_security").securitySubtype,
    privacySubtype: doc.boundaries.find(boundary => boundary.id === "b_privacy").privacySubtype,
    deviationKind: doc.deviations.find(deviation => deviation.id === "dv_example").kind,
    dataPolicy: definition.allowedDataTypes,
    defaultPrivacyBoundary: definition.defaultPrivacyBoundary,
    edgeNumbers: doc.scenarios.find(scenario => scenario.id === "s_primary").edgeNumbers,
    requestData: doc.scenarios.find(scenario => scenario.id === "s_primary").edgeRequestData,
  };
}

export function catalogSnapshotFixture() {
  const model = unavailableCatalogFixture();
  model.doc.data[1].classification = "EUII";
  model.doc.catalogDefinitions = [
    ["classification", "ExampleRestricted", "Partner restricted data"],
    ["tenant", "ExampleTenant", "Partner tenant"],
    ["privacyBoundary", "ExamplePrivacy", "Partner privacy perimeter"],
    ["securityBoundary", "ExampleSecurity", "Partner trust perimeter"],
    ["deviation", "example-evidence", "Partner evidence"],
    ["classification", "EUII", "Saved EUII label"],
  ].map(([kind, id, label]) => ({
    kind, id, label,
    description: "Synthetic saved definition, not installed code.",
    library: { id: "example-library", version: "1.0.0" },
  }));
  return model;
}
