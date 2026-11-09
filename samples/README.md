# SecureDesignStudio reference models

Five **synthetic ideal reference designs** demonstrate concrete service types,
correct DFD roles, operation-scoped authorization and classified privacy data.
They describe recommended controls, **not observed deployments or security,
privacy, clinical-safety or compliance certification**.

Open a `.tma` through **File > Open**, or **Open model (.tma)…** in the
first-run dialog of a blank app. Start with the first Reference scenario;
use **Fit model to view** and close the inspector for a presentation view.
Orange rectangular **External Interactors** are users or separately controlled
providers. Blue **Processes** perform authorization and computation. Green
**Data Stores**, including actual registered **Azure SQL**, persist data.
Service type and DFD role are independent: changing a label to "database" does
not turn a Process into a SQL Data Store.

## Scenario guide

| Model and scenario | In-scope services / external participants | Flow and authorization ownership | Privacy and durable data |
|---|---|---|---|
| [Customer profile](customer-profile-service.tma): 01 owned profile update | App Service web/API, Azure SQL / customer | Delegated user -> OBO API -> MI SQL. API binds subject to profile; SQL exposes owned-row procedures, not a broad database role. | Contact profile **EUII** and ownership subject **EUPI** persist in SQL. Claims **Access Control Data** and other copies remain transient. Illustrative account-closure deletion includes backup expiry within 30 days. |
| Customer: 02 minimized metrics | Same subjects / customer and external metrics provider | API emits only allowlisted aggregate counters over direct mTLS. Provider maps the certificate to aggregate ingestion only. | **System Metadata** counters contain no contacts, user/tenant IDs or request IDs; provider's illustrative 30-day aggregate retention requires contractual verification. This replaces the old raw-contact disclosure. |
| [Payment](payment-processing.tma): 01 synchronous payment | App Service checkout/API, **Azure SQL payment ledger** / buyer and processor | API authorizes buyer/order, SQL atomically reserves the merchant attempt and returns canonical amount, mTLS processor returns outcome, MI SQL commits a verified transition. | Order reference/owner **EUPI**, financial content **Customer Content**, single-use token **Access Control Data**, merchant attempt/provider events **System Metadata** are separate. SQL retains order, owner, attempt/outcome/event evidence for illustrative 90-day reconciliation. No PAN/CVV or token storage. |
| Payment: 02 verified callback | Same subjects and external participants | Initial response is pending. A new mTLS processor callback supplies provider-assigned event and echoed attempt/order; API and SQL check freshness, binding and uniqueness before committing. | Provider event IDs are never invented in the outgoing merchant request. Pending is not a final status. A later buyer status query is outside this transaction. This replaces the unsigned callback variant. |
| [AI document assistant](ai-document-assistant.tma): 01 authorized grounding | App Service web/gateway, Azure AI Search Data Store / worker and Azure OpenAI provider | All subject interiors stay in scope. Gateway owns tenant/document authorization, queries Search with MI and rechecks chunks against returned stored ACLs; inference MI grants invocation only. | Questions/chunks/answers are **Customer Content**; subject **EUPI**, tenant **OII**, transient caller claims and separately stored document ACL **Access Control Data**. No identity/ACL payload is sent to inference. Index chunks/ACLs persist for active documents and purge within 24 hours of source deletion. |
| AI: 02 privacy-safe metrics | Same subjects plus application-owned Log Analytics Data Store | Gateway MI is restricted to one ingestion rule; allowlisted aggregate metrics only, no workspace query/admin privileges. | Only **System Metadata** counters reach the workspace, with illustrative 30-day expiry. No prompt, excerpt, user/tenant identity or correlation identifier. This replaces raw prompt logging and removes the old contrived Web App scope exclusion. |
| [Healthcare](healthcare-data-exchange.tma): 01 treatment access | App Service frontend/FHIR-compatible API, Azure SQL clinical repository / clinician | OBO API checks treatment relationship, purpose, consent and minimum fields; SQL MI executes patient-scoped procedures. The API is an application implementation, not a claim of a managed Azure FHIR service. | Clinical content **Customer Content**, patient/clinician references **EUPI**, permission evidence **Access Control Data**. Repository uses a separately approved clinical retention schedule; a category is not a legal retention determination. |
| Healthcare: 02 verified lab exchange | Same subjects / clinician and external laboratory | Persist patient/order/lab assignment **before** mTLS order dispatch. Initial call returns an accepted order and current summary. Later mTLS callback -> saved assignment lookup -> atomic verified result write. | Lab gets order/test and pseudonymous patient reference, never full chart. Persist order assignment **Access Control Data**, clinical result and event provenance. Illustrative 30-day partner exchange-copy deletion is distinct from independently governed clinical records. This replaces broad-key/empty-callback teaching gaps. |
| [Multi-tenant SaaS](multi-tenant-saas-platform.tma): 01 Tenant A / 02 Tenant B | Shared App Service web/gateway/data API and Azure SQL / distinct A or B user | OBO subject/tenant authorization at every API; SQL MI executes tenant-bound procedures with row-level predicates. Clear/rebind tenant context on pooled connections. | A/B records **Customer Content** and scenario data remain distinct. Tenant **OII**, subject **EUPI**, claims **Access Control Data** are separate. Active records persist in their partition, with illustrative 30-day closure/backup expiry. |
| SaaS: 03 approved support view | Gateway/data API/SQL / external support reviewer | A distinct support client uses delegated user identity and time-bound tenant/case approval. OBO preserves accountability; SQL returns only the approved Tenant A projection. | Permission **Access Control Data**, operator **Administrator Data**, case **Support Data** and response **Customer Content** are distinct. SQL retains underlying Tenant A records; projection and support display are transient. This replaces unscoped application-only cross-tenant export. |

SaaS SQL retains the OII tenant partition key with its business rows in every
applicable scenario, including support review. API query selectors, human
subject/permission claims and the support export projection remain transient;
a supplied tenant parameter never grants access by itself.

The first scenario opens by default. **Show all** displays the shared
architecture; flow numbering belongs to individual scenarios. **Sequence**
orders requests and their return data. A callback is a new directional edge;
a response bucket returns on the existing call and does not imply another
login. Inspect **Properties**, **Data**, **Issues** and **Comments** for the
control owner, actual payload, retention and review assumptions.

## Model contracts and limits

- Native wrapper `secure-design-studio-diagram` version 2 and document version
  1 remain unchanged. The `s_risky` IDs remain stable for existing links, but
  their names and semantics are now **reference variants**, not deliberate
  insecure designs. Retaining an old filename/ID does not retain its old risk.
- Azure service IDs come from the existing shipped catalog, with portable
  saved definitions, real service icons and **Unspecified** policy. No fake
  official allow-all policies or new service catalog registrations were added.
  Azure SQL uses its saved DataStore default without a Process override.
  Search and Log Analytics instances explicitly represent application-owned
  persistence; Azure OpenAI is a separately operated external instance.
- All subject processes/stores are **in scope**. External Interactors remain
  visible black boxes, not out-of-scope infrastructure. No scenario reason or
  hidden payload is used to suppress a finding.
- Authentication is not authorization. Required rights name the receiving
  operation, resource and enforcing owner. Managed identity authenticates the
  workload; it does not delegate a user or ensure tenant isolation. Direct
  mTLS is not certificate-based Entra token acquisition.
- Intended HTTP/API and direct mTLS hops reference the shipped HTTPS
  communication profile and embed its exact definition for portable reopen.
  HTTPS declares intended channel protection, not verified TLS, authorization,
  or a specific HTTP/TLS version or transport. Authentication and directional
  privacy/retention choices remain independent. SQL hops stay unspecified:
  managed identity does not establish a wire protocol, and no SQL profile is
  invented.
- Fictional App IDs identify the **calling application**, not the human.
  Within each model, client `11111111-1111-4111-8111-111111111111`
  is the end-user client; subsequent distinct calling applications have
  separate synthetic registrations. SaaS A/B share that browser client,
  while its Web App, gateway and support client use distinct IDs.
  Audiences identify the receiving API. No real credentials or service
  inventory identities are included; illustrative endpoints use `.example`.
- Privacy categories use actual shipped definitions. A pseudonymous
  identifier is not anonymous; System Metadata may still be linkable.
  The AI provider's processing-only assumption must be checked against its
  actual retention/abuse-monitoring configuration and contract, not inferred
  from the Azure OpenAI service name. No-training is not a universal
  no-retention guarantee.
- Security/privacy rectangles describe trust and custody, not proof of
  enforcement, residency or legal control. Customer VNet and AI Subnet
  four-field network intent is declarative and selectively authored.
  Other physical subtypes stay unspecified when the model does not establish
  them. The shared SaaS plane is not a physical tenant-isolation guarantee.

Each fictional model has two **Active authored review concerns** grounded in
its actual subject or crossing, plus a verification work item. These are
unverified requirements to review, not observed vulnerabilities, accepted
risks or completed mitigations. Reference controls address the threat path;
negative tests and deployment/contract evidence are still needed.

With default core libraries, **Analyze has no generated structural findings**
for the five reference designs. This is not the acceptance criterion by
itself: actual service/role, visibility, operation rights, data direction,
privacy classification, durable state and ordering are tested independently.
Analyze neither proves least privilege nor verifies mTLS, provider contracts,
clinical safety, PCI compliance or prompt-injection resistance.

## Maintaining the gallery

```powershell
node --test tests\authentication\samples.test.mjs
node --test tests\authentication\communication-protocols.test.mjs
node --test --test-name-pattern="regression: sample " tests\browser\contracts.test.mjs
```

`sample-expectations.mjs` contains independent intended service/role,
authentication, communication profile, calling-client, classification and request-order choices.
Pure contracts additionally check exact sensitive-data directions/retention,
the full normalized native model and saved dependencies, and payment SQL
`GE.DS` mapping in TM7. TM7 is lossy: privacy data and detailed rights remain
in the native file; XML assertions do not certify desktop TMT rendering.

Browser contracts exercise the five gallery files and their scenarios,
rendered service/role/scope, Diagram and Sequence, complete model/view
save/reopen, measured sizes, label/path overlap, fit clipping and Show all.
Tests use isolated installed browsers, synthetic data and network guards;
never reuse an unrelated local server or personal profile. See the
[browser guide](../tests/browser/README.md).
Run the full build and applicable browser union separately, without concurrent
build/output writes. A passing automated run is not participant usability,
native OS-picker validation or an error-free-console guarantee.
