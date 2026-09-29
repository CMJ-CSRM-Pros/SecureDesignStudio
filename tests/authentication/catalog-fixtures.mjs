export const UNKNOWN_BEHAVIOR = Object.freeze({
  productionIdentity: "unknown",
  audience: false,
  constraints: false,
  anonymous: false,
  managedIdentity: false,
});

export const LEGACY_LABELS = Object.freeze({
  EntraDelegatedUserAccess: "Microsoft Entra ID - delegated user access",
  EntraApplicationOnlyAccess: "Microsoft Entra ID - application-only access",
  EntraApplicationOnlyWithForwardedUserContext: "Application-only access with forwarded user context (custom)",
  EntraApplicationOnlyWithCdt: "Application-only access with constrained delegation token (CDT)",
  ProtectedForwardedAccessToken: "Protected Forwarded Access Token (PFAT)",
  PopWithProtectedForwardedToken: "POP+PFT",
  CertificateAuthentication: "Certificate authentication",
  SharedAccessSignature: "Shared access signature (SAS)",
  SharedKeyAuthorization: "Shared key authorization",
  AnonymousAccess: "Anonymous access (no authentication)",
  CustomAuthentication: "Custom or other authentication",
});

// These expectations are independent of the shipped JSON and compatibility maps.
export const EXPECTED_PROFILES = Object.freeze({
  EntraDelegatedUserAccess: ["required", true, false, false, false],
  EntraApplicationOnlyAccess: ["required", true, false, false, false],
  EntraApplicationOnlyWithForwardedUserContext: ["optional", false, false, false, false],
  EntraApplicationOnlyWithCdt: ["required", true, true, false, false],
  ProtectedForwardedAccessToken: ["required", false, false, false, false],
  PopWithProtectedForwardedToken: ["required", false, false, false, false],
  CertificateAuthentication: ["optional", false, false, false, false],
  SharedAccessSignature: ["optional", false, false, false, false],
  SharedKeyAuthorization: ["optional", false, false, false, false],
  AnonymousAccess: ["optional", false, false, true, false],
  InternalProcessCall: ["optional", false, false, false, false],
  CustomAuthentication: ["unknown", false, false, false, false],
  EntraOnBehalfOf: ["required", true, false, false, false],
  EntraManagedIdentity: ["required", true, false, false, true],
  EntraFederatedWorkloadIdentity: ["required", true, false, false, false],
  OAuthAccessToken: ["optional", true, false, false, false],
  ClientCertificateMtls: ["optional", false, false, false, false],
  ApiKey: ["optional", false, false, false, false],
});

export const PACKAGE_METHOD_IDS = Object.freeze([
  "EntraApplicationOnlyWithForwardedUserContext", "EntraApplicationOnlyWithCdt",
  "ProtectedForwardedAccessToken", "PopWithProtectedForwardedToken",
]);

// Historical saved-file fixtures, not an authoring catalog or private checkout
// dependency. Real package content is verified by its companion-only tests.
export function historicalAuthenticationDefinitions() {
  return PACKAGE_METHOD_IDS.map(id => {
    const [productionIdentity, audience, constraints, anonymous, managedIdentity] = EXPECTED_PROFILES[id];
    return {
      id, label: LEGACY_LABELS[id], description: "Synthetic historical compatibility fixture.",
      shortLabel: id.slice(0, 20), disabled: false, legacy: false,
      aliases: [LEGACY_LABELS[id]],
      behavior: { productionIdentity, audience, constraints, anonymous, managedIdentity },
    };
  });
}

export function historicalAuthenticationPackage() {
  return {
    format: "secure-design-studio-library", apiVersion: 1, id: "historical-auth-fixture",
    name: "Historical authentication fixture", version: "1.0.0",
    overrides: [{ key: "fields/servicetreeid", from: "core" }],
    fields: [{ id: "serviceTreeId", target: "node", storage: "serviceTreeId", label: "ServiceTreeId", validation: "guid" }],
    rules: [{ id: "Node_must_have_servicetree", target: "node", fieldId: "serviceTreeId", check: "required",
      title: "Historical inventory identifier missing", description: "Supply the selected library's inventory identifier." }],
    catalogs: {
      authentication: historicalAuthenticationDefinitions(),
      nodes: [{
        id: "Legacy Service (v1)", label: "Legacy service fixture",
        definition: {
          serviceTreeId: "11111111-1111-4111-8111-111111111111",
          endpointRegex: "^https://legacy-node\\.example\\.invalid/",
          allowedAuthMethods: [{ id: "ApiKey", status: "Allowed" }],
          allowedDataTypes: [{ id: "*", retention: "*", action: "Allow" }],
        },
      }],
      taxonomy: [
        { kind: "tenant", id: "ME", label: "Historical tenant ME" },
        { kind: "tenant", id: "FirstParty", label: "Historical first-party tenant" },
        ...historicalTaxonomyDefinitions(),
      ],
    },
  };
}

export function historicalTaxonomyDefinitions() {
  return [
    ["privacyBoundary", "M365ComplianceBoundary"], ["privacyBoundary", "CAndAIComplianceBoundary"],
    ["securityBoundary", "CoreServicesIslands"], ["securityBoundary", "CoreServicesIslandsZeroTrust"],
    ["securityBoundary", "PowerPlatformPlex"], ["securityBoundary", "CoreServicesCmp"],
    ["deviation", "ests-relationship"],
  ].map(([kind, id]) => ({ kind, id, label: `Historical ${id}`, description: "Synthetic retained taxonomy fixture." }));
}

export const IDS = Object.freeze({
  source: "11111111-1111-4111-8111-111111111111",
  target: "22222222-2222-4222-8222-222222222222",
  edge: "33333333-3333-4333-8333-333333333333",
  scenario: "44444444-4444-4444-8444-444444444444",
  app: "55555555-5555-4555-8555-555555555555",
});

export function definition(overrides = {}) {
  return {
    id: "ContosoProofV1",
    label: "Contoso proof",
    description: "An owner-defined proof whose guarantees require review.",
    shortLabel: "Contoso",
    behavior: { ...UNKNOWN_BEHAVIOR },
    disabled: false,
    legacy: false,
    aliases: [],
    ...overrides,
  };
}

export function documentFixture(overrides = {}) {
  return {
    version: 1,
    authenticationDefinitions: [],
    nodeTypes: [],
    nodes: [
      { id: IDS.source, title: "Caller", description: "", type: "", serviceTreeId: IDS.source, endpointRegex: "", position: { x: 120, y: 120 }, size: { width: 180, height: 90 } },
      { id: IDS.target, title: "Receiver", description: "", type: "", serviceTreeId: IDS.target, endpointRegex: "", position: { x: 420, y: 120 }, size: { width: 180, height: 90 } },
    ],
    edges: [{ id: IDS.edge, source: IDS.source, target: IDS.target, title: "Review flow", description: "", waypoints: [] }],
    boundaries: [],
    scenarios: [{
      id: IDS.scenario, name: "Authentication review", description: "",
      nodeIds: [IDS.source, IDS.target], edgeIds: [IDS.edge],
      edgeNumbers: { [IDS.edge]: 7 }, boundaryIds: [], nodeData: {},
      edgeRequestData: {}, edgeResponseData: {},
    }],
    data: [], comments: [], issues: [], deviations: [], workItems: [],
    ...overrides,
  };
}

export function withFlow(authenticationTypes, overrides = {}) {
  const doc = documentFixture();
  doc.edges[0] = { ...doc.edges[0], authenticationTypes, ...overrides };
  return doc;
}

export function withPolicy(rules, authenticationTypes = ["ContosoProofV1"], policyOverrides = {}) {
  const doc = withFlow(authenticationTypes);
  doc.nodes[1].type = "nt_test";
  doc.nodeTypes = [{
    id: "nt_test", label: "Test receiver",
    definition: {
      serviceTreeId: IDS.target, endpointRegex: "^$",
      allowedAuthMethods: rules, allowedDataTypes: [],
      ...policyOverrides,
    },
  }];
  return doc;
}

function xmlText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Independent import fixture: not generated by the product's TM7 exporter.
export function tm7Fixture(flowLabel) {
  const node = (id, name) => `<KeyValueOfguidanyType><Value>
    <GenericTypeId>GE.P</GenericTypeId><Guid>${id}</Guid>
    <Properties><anyType><DisplayName>Name</DisplayName><Value>${name}</Value></anyType></Properties>
    <Left>100</Left><Top>100</Top><Width>100</Width><Height>100</Height>
  </Value></KeyValueOfguidanyType>`;
  return `<?xml version="1.0"?><ThreatModel><DrawingSurfaceList><DrawingSurfaceModel>
    <Properties><anyType><DisplayName>Name</DisplayName><Value>Legacy authentication</Value></anyType></Properties>
    <Borders>${node(IDS.source, "Caller")}${node(IDS.target, "Receiver")}</Borders>
    <Lines><KeyValueOfguidanyType><Value>
      <GenericTypeId>GE.DF</GenericTypeId><Guid>${IDS.edge}</Guid>
      <SourceGuid>${IDS.source}</SourceGuid><TargetGuid>${IDS.target}</TargetGuid>
      <Properties><anyType><DisplayName>Name</DisplayName><Value>${xmlText(flowLabel)}</Value></anyType></Properties>
    </Value></KeyValueOfguidanyType></Lines>
  </DrawingSurfaceModel></DrawingSurfaceList></ThreatModel>`;
}
