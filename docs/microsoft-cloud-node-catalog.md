# Microsoft cloud node-type catalog

Inventory baseline: 2026-08-16; scoped product-boundary/guidance update: 2026-10-09.

*Updated: 2026-10-09 - Added reviewed Azure guidance and reconciled owner-approved service boundaries.*

SecureDesignStudio provides **169 neutral core node types**, without requiring
an optional library. The optional Custom package contributes 13 node
definitions, including six private service identities; three explicitly
overlay same-ID Dataverse bases, yielding **179 combined IDs** when selected.
Private policy/identity definitions are not part of the neutral core. The Azure
portion starts from the 214-resource Microsoft Cloud
Adoption Framework inventory and collapses SKU/child-resource variants into
93 architecturally meaningful data-flow node families.
Use the [user guide](user-guide.md#4-advanced-features) for the modeling
workflow; this reference retains the catalog inventory and source methodology.

## Catalog policy

Catalog entries identify products, categories, public endpoint hints, resource-provider namespaces, documentation, and bundled diagram icons. They deliberately **do not assert service-specific authentication, data-classification, geo, retention, or GDPR policy**. SecureDesignStudio marks those entries as `policyStatus: Unspecified`; reviewers must confirm policy for the modeled use. The optional private entries retain their existing policy only when explicitly selected or saved in a document.

Because Microsoft services evolve continuously, this is a reviewed snapshot,
not a claim that every Azure Marketplace offer, retired SKU, preview feature,
or child ARM resource has its own node. The Azure inventory deliberately
collapses related SKUs and child resources into data-flow-relevant service
families; the linked Microsoft sources remain authoritative.

## Reviewed AI design guidance

166 of the 169 neutral core node types carry concise `aiDesignGuidance`:
Context, Dependencies, Risks and Uncertainty, with source URLs, authored
revision and edit date. Guidance remains withheld for Virtual machine
infrastructure, Network security and Route resources as directed by the
catalog owner. The optional Custom package adds guidance to four additional
IDs; three Dataverse component overlays retain the same core IDs and guidance.
Dates are edit dates, not fresh verification of a deployment or every linked
page.

The optional Custom package also gives neutral public meanings to its stable
legacy IDs `Connectors` and `Copilot Studio`, separate from the core IDs
`PowerPlatformConnectors` and `CopilotStudio`. New library definitions no
longer contain the former private Service Tree identities, environment API
endpoint matchers, or organization-specific policy fields. Saved diagram
definitions remain authoritative and are not rewritten by this catalog update.
The private CAPI, BAP, EDS, PPMS, MDL Service and XStore entries remain without
AI guidance.

New default choices:

| Stable ID | Meaning |
|---|---|
| `Dataverse` | Managed business-data platform, not customer-owned Cosmos DB or a private internal service alias. |
| `Dataverse Table` | Contained table accessed through parent Dataverse APIs; table kind affects storage and auditing. |
| `Dataverse Plugin` | Registered synchronous/asynchronous server-side handler, potentially making external calls; not a guarantee of one shared OS process. |
| `CopilotStudio` | Public agent/workflow authoring and management product, distinct from `m365_copilot` and `Agent365`. |
| `PowerPlatformConnectors` | Connector family; identify the actual connector, connection identity, operation and backend. |

Owner-approved Azure scopes preserve variant differences: WAF is Web
Application Firewall at public application entry points; Delivery covers
Azure Front Door and legacy Azure CDN; Azure Files covers both classic
account-contained and standalone shares; Managed Redis stays scoped to
`Microsoft.Cache/RedisEnterprise`; Azure Enclave is a managed deployment
composite. These definitions do not imply every listed component or control is
deployed. VM infrastructure, Network security, Route and six private service
identities remain without guidance.

For the request “a Power Pages application backed by Copilot to summarize
Dataverse data,” the public choices support `PowerPages` → `CopilotStudio` →
`Dataverse` directly. This is a proposed architecture, not a guarantee of a
configured integration. Confirm the intended Copilot product, supported
channel/data path, effective identity, table/row/column authorization and
summary audience. Do not substitute Microsoft 365 Copilot merely because it
was previously the only available Copilot choice. Table, plug-in, connector,
AI Search and Azure OpenAI nodes are not automatically required.

Descriptions distinguish Power Apps canvas/model-driven apps, Power Automate
cloud/desktop flows, Customer Insights Data/Journeys, the Dynamics suite,
Finance versus F&O platform, Sales Insights capabilities and Project Operations
deployment branches. Agent 365 is categorized as cross-product governance;
the on-premises gateway is shared integration infrastructure. Customer Voice
lifecycle and Intelligent Order Management production-availability questions
remain explicit uncertainty, not inferred retirement or provisioning approval.

The five new entries use `^$` with no matching hints: no unique public endpoint
classifier is established. Existing CRM/F&O wildcard hints are retained for
compatibility but **do not uniquely identify a Dynamics application**. A
table/API resource is not a separately hosted table hostname; this conservative
matching choice does not claim Dataverse has no APIs.

Saved definitions remain authoritative, including old names and an absent
guidance field; there is no wholesale migration. New core types omit default
DFD roles rather than inferring them; explicitly choose Process/Data Store as
appropriate for a modeled instance. Guidance is untrusted reference text, not
policy, a risk waiver or permission to create dependencies.

## Updating the catalog in the app

Open **Model > Node Type Catalog**. The catalog editor can:

- create a document-local type with a stable ID;
- override a shipped label, endpoint pattern, icon, documentation, or policy;
- edit auth, data, privacy, geo, retention, and GDPR rules;
- reset a shipped type to its built-in definition;
- delete an unused document type;
- export all document definitions as `secure-design-studio-node-catalog.json`; and
- import that package into another document.

Authentication policies use the same **Model > Customize authentication**
library as flow selectors. Node-catalog packages include referenced
`authenticationDefinitions`; missing or conflicting dependencies produce an
actionable error instead of silently removing policy rules. Importing a node
catalog does not replace browser-profile library preferences. See the
[Authentication Library contract](authentication-library.md).

These definitions are document-local model data rather than source-code
changes. They are included in `.tma` export/import, autosave, standalone HTML,
undo/redo, Compare to previous, and collaboration. An override affects the
current document only. It does not update the repository catalog or other
models. A shipped catalog update still belongs in
`src/data/microsoftCloudNodeTypes.json`; the editor is the low-friction path for
prototyping and distributing new definitions before they are promoted into the
product snapshot.

For a first model, select each node and review both inspector tabs:

- **General / Security**: confirm the type, ServiceTree context, endpoint
  pattern, and displayed authentication policy. Audience, constraints, and
  production identity are recorded on flows, not the node.
- **Privacy**: confirm allowed data rules, scenario data and retention, default
  privacy boundary, geographic behavior, post-subscription retention, and GDPR
  handling.

`policyStatus: Unspecified` identifies the service but makes no curated
authentication or data-policy claim. Empty fields are not permission to use any
authentication method or data class. Distinguish type policy from node
overrides and scenario-specific data: the type provides catalog guidance, a
node records deployment-specific overrides, and each scenario records its own
edge data attachments and node retention. Confirm Unspecified or deferred
values with the responsible security and privacy reviewers. See the
[user guide](user-guide.md#4-advanced-features) for the complete workflow.

## Official sources

- [Azure products](https://azure.microsoft.com/products/category/)
- [Azure resource abbreviation inventory](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations)
- [Microsoft 365 service descriptions](https://learn.microsoft.com/office365/servicedescriptions/office-365-service-descriptions-technet-library)
- [Power Platform documentation](https://learn.microsoft.com/power-platform/)
- [Microsoft Fabric overview](https://learn.microsoft.com/fabric/fundamentals/microsoft-fabric-overview)
- [Dynamics 365 documentation](https://learn.microsoft.com/dynamics365/)

Official SVGs are copied unmodified from Microsoft architecture icon packs. See [the icon source and usage notice](../src/assets/node-icons/README.md).

## Counts

| Catalog source | Types |
|---|---:|
| Dynamics 365 | 16 |
| Microsoft 365 | 40 |
| Microsoft Azure | 93 |
| Microsoft Fabric | 9 |
| Power Platform | 11 |
| **Neutral core total** | **169** |
| Optional Custom entries | 13 |
| Same-ID optional/core overlap | -3 |
| **Combined with Custom** | **179** |

Catalog-source grouping preserves the original source attribution; category
labels independently identify Agent 365 governance and shared gateway roles.

## Dynamics 365

| Category | Node type | Stable ID | Endpoint pattern | Resource providers |
|---|---|---|---|---|
| Dynamics 365 / Application | [Business Central](https://learn.microsoft.com/en-us/dynamics365/business-central/) | `D365BusinessCentral` | `^https?:\/\/api\.businesscentral\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Commerce](https://learn.microsoft.com/en-us/dynamics365/commerce/overview) | `D365Commerce` | `^https?:\/\/.*\.cloud\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Contact Center](https://learn.microsoft.com/en-us/dynamics365/contact-center/overview) | `D365ContactCenter` | `^https?:\/\/.*\.crm[0-9]*\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Product family | [Customer Insights](https://learn.microsoft.com/en-us/dynamics365/customer-insights/overview) | `D365CustomerInsights` | Not cataloged | — |
| Dynamics 365 / Application | [Customer Service](https://learn.microsoft.com/en-us/dynamics365/customer-service/) | `D365CustomerService` | `^https?:\/\/.*\.crm[0-9]*\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Customer Voice](https://learn.microsoft.com/en-us/dynamics365/customer-voice/help-hub) | `D365CustomerVoice` | Not cataloged | — |
| Dynamics 365 / Suite | [Dynamics 365](https://learn.microsoft.com/en-us/dynamics365/get-started/intro-crossapp-index) | `Dynamics365` | `^https?:\/\/.*\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Field Service](https://learn.microsoft.com/en-us/dynamics365/field-service/overview) | `D365FieldService` | `^https?:\/\/.*\.crm[0-9]*\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Finance](https://learn.microsoft.com/en-us/dynamics365/finance/) | `D365Finance` | `^https?:\/\/.*\.cloud\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Platform | [Finance and Operations](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/) | `D365FinanceOperations` | `^https?:\/\/.*\.cloud\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Human Resources](https://learn.microsoft.com/en-us/dynamics365/human-resources/) | `D365HumanResources` | `^https?:\/\/.*\.cloud\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Intelligent Order Management](https://learn.microsoft.com/en-us/dynamics365/intelligent-order-management) | `D365IntelligentOrderManagement` | Not cataloged | — |
| Dynamics 365 / Application | [Project Operations](https://learn.microsoft.com/en-us/dynamics365/project-operations/) | `D365ProjectOperations` | `^https?:\/\/.*\.crm[0-9]*\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Sales](https://learn.microsoft.com/en-us/dynamics365/sales/overview) | `D365Sales` | `^https?:\/\/.*\.crm[0-9]*\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Capability | [Sales Insights](https://learn.microsoft.com/en-us/dynamics365/sales/overview) | `D365SalesInsights` | `^https?:\/\/.*\.crm[0-9]*\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |
| Dynamics 365 / Application | [Supply Chain Management](https://learn.microsoft.com/en-us/dynamics365/supply-chain/) | `D365SupplyChainManagement` | `^https?:\/\/.*\.cloud\.dynamics\.com(?::\d+)?(?:\/.*)?$` | — |

## Microsoft 365

| Category | Node type | Stable ID | Endpoint pattern | Resource providers |
|---|---|---|---|---|
| Microsoft 365 / AI assistant | [Microsoft 365 Copilot](https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-overview) | `m365_copilot` | Not cataloged | — |
| Microsoft 365 / API platform | [Microsoft Graph](https://learn.microsoft.com/en-us/graph/overview) | `m365_graph` | `^https?:\/\/graph\.microsoft\.com(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Cloud app security | [Microsoft Defender for Cloud Apps](https://learn.microsoft.com/en-us/defender-cloud-apps/what-is-defender-for-cloud-apps) | `m365_defender_for_cloud_apps` | `^https?:\/\/.*\.portal\.cloudappsecurity\.com(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Cloud PC | [Windows 365](https://learn.microsoft.com/en-us/windows-365/overview) | `m365_windows_365` | Not cataloged | — |
| Microsoft 365 / Cloud printing | [Universal Print](https://learn.microsoft.com/en-us/universal-print/fundamentals/universal-print-whatis) | `m365_universal_print` | Not cataloged | — |
| Microsoft 365 / Collaborative canvas | [Microsoft Whiteboard](https://learn.microsoft.com/en-us/microsoft-365/whiteboard/whiteboard-overview) | `m365_whiteboard` | Not cataloged | — |
| Microsoft 365 / Collaborative workspaces | [Microsoft Loop](https://learn.microsoft.com/en-us/microsoft-365/loop/loop-overview) | `m365_loop` | Not cataloged | — |
| Microsoft 365 / Communities and social | [Viva Engage](https://learn.microsoft.com/en-us/viva/engage/overview) | `m365_viva_engage` | `^https?:\/\/(.*\.yammer\.com\|.*\.yammerusercontent\.com\|.*\.assets-yammer\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Compliance and governance | [Microsoft Purview](https://learn.microsoft.com/en-us/purview/purview) | `m365_purview` | `^https?:\/\/(purview\.microsoft\.com\|compliance\.microsoft\.com\|security\.microsoft\.com\|protection\.office\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Content collaboration | [SharePoint in Microsoft 365](https://learn.microsoft.com/en-us/sharepoint/introduction) | `m365_sharepoint_online` | `^https?:\/\/(.*\.sharepoint\.com\|.*\.sharepointonline\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Desktop productivity | [Microsoft 365 Apps](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-applications-service-description/office-applications-service-description) | `m365_apps` | `^https?:\/\/(.*\.officeapps\.live\.com\|.*\.online\.office\.com\|officecdn\.microsoft\.com\|officeclient\.microsoft\.com\|config\.office\.com\|.*\.office\.com\|www\.microsoft365\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Device management | [Microsoft Intune](https://learn.microsoft.com/en-us/intune/fundamentals/what-is-intune) | `m365_intune` | `^https?:\/\/(.*\.manage\.microsoft\.com\|manage\.microsoft\.com\|.*\.dm\.microsoft\.com\|EnterpriseEnrollment\.manage\.microsoft\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Email and collaboration security | [Microsoft Defender for Office 365](https://learn.microsoft.com/en-us/defender-office-365/mdo-about) | `m365_defender_for_office_365` | `^https?:\/\/(security\.microsoft\.com\|defender\.microsoft\.com\|protection\.office\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Email archiving | [Exchange Online Archiving](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-archiving-service-description/exchange-online-archiving-service-description) | `m365_exchange_archiving` | Not cataloged | — |
| Microsoft 365 / Email protection | [Exchange Online Protection](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-protection-service-description/exchange-online-protection-service-description) | `m365_exchange_protection` | `^https?:\/\/(.*\.protection\.outlook\.com\|.*\.mail\.protection\.outlook\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Employee communications and intranet | [Viva Connections](https://learn.microsoft.com/en-us/viva/connections/viva-connections-overview) | `m365_viva_connections` | Not cataloged | — |
| Microsoft 365 / Employee experience platform | [Microsoft Viva](https://learn.microsoft.com/en-us/viva/microsoft-viva-overview) | `m365_viva` | Not cataloged | — |
| Microsoft 365 / Employee feedback | [Viva Glint](https://learn.microsoft.com/en-us/viva/glint/introduction-viva-glint) | `m365_viva_glint` | Not cataloged | — |
| Microsoft 365 / Employee feedback | [Viva Pulse](https://learn.microsoft.com/en-us/viva/pulse/introduction-to-viva-pulse) | `m365_viva_pulse` | Not cataloged | — |
| Microsoft 365 / Endpoint security | [Microsoft Defender for Endpoint](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint) | `m365_defender_for_endpoint` | Not cataloged | — |
| Microsoft 365 / Enterprise video | [Microsoft Stream](https://learn.microsoft.com/en-us/stream/streamnew/streamnew) | `m365_stream` | Not cataloged | — |
| Microsoft 365 / Forms and surveys | [Microsoft Forms](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/set-up-microsoft-forms) | `m365_forms` | Not cataloged | — |
| Microsoft 365 / Identity and access | [Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/fundamentals/what-is-entra) | `m365_entra_id` | `^https?:\/\/(login\.microsoftonline\.com\|graph\.windows\.net\|login\.windows\.net\|login\.microsoft\.com\|.*\.msauth\.net\|.*\.msftauth\.net\|enterpriseregistration\.windows\.net)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Identity security | [Microsoft Defender for Identity](https://learn.microsoft.com/en-us/defender-for-identity/what-is) | `m365_defender_for_identity` | Not cataloged | — |
| Microsoft 365 / Internal communications | [Viva Amplify](https://learn.microsoft.com/en-us/viva/amplify/overview-viva-amplify) | `m365_viva_amplify` | Not cataloged | — |
| Microsoft 365 / Learning and knowledge | [Viva Learning](https://learn.microsoft.com/en-us/viva/learning/overview-viva-learning) | `m365_viva_learning` | Not cataloged | — |
| Microsoft 365 / List collaboration | [Microsoft Lists](https://support.microsoft.com/office/get-started-with-microsoft-lists-10e2e923-4a82-4e22-8fcb-71a6c485fcf3) | `m365_lists` | Not cataloged | — |
| Microsoft 365 / Mail and calendaring | [Exchange Online](https://learn.microsoft.com/en-us/exchange/exchange-online) | `m365_exchange_online` | `^https?:\/\/(outlook\.cloud\.microsoft\|outlook\.office\.com\|outlook\.office365\.com\|smtp\.office365\.com\|.*\.protection\.outlook\.com\|.*\.mail\.protection\.outlook\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Meetings and chat | [Microsoft Teams](https://learn.microsoft.com/en-us/microsoftteams/teams-overview) | `m365_teams` | `^https?:\/\/(.*\.teams\.cloud\.microsoft\|.*\.teams\.microsoft\.com\|teams\.cloud\.microsoft\|teams\.microsoft\.com\|.*\.lync\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Personal storage | [OneDrive](https://learn.microsoft.com/en-us/sharepoint/onedrive-overview) | `m365_onedrive` | `^https?:\/\/(.*\.sharepoint\.com\|storage\.live\.com\|admin\.onedrive\.com\|officeclient\.microsoft\.com\|g\.live\.com\|oneclient\.sfx\.ms)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Personal task management | [Microsoft To Do](https://support.microsoft.com/todo) | `m365_todo` | Not cataloged | — |
| Microsoft 365 / Presentations | [Microsoft Sway](https://support.microsoft.com/office/getting-started-with-sway-2076c468-63f4-4a89-ae5f-424796714a8a) | `m365_sway` | Not cataloged | — |
| Microsoft 365 / Privacy management | [Microsoft Priva](https://learn.microsoft.com/en-us/privacy/priva/priva-overview) | `m365_priva` | Not cataloged | — |
| Microsoft 365 / Project management | [Microsoft Project](https://learn.microsoft.com/en-us/project-for-the-web/project-management-overview) | `m365_project` | Not cataloged | — |
| Microsoft 365 / Scheduling | [Microsoft Bookings](https://learn.microsoft.com/en-us/microsoft-365/bookings/bookings-overview) | `m365_bookings` | Not cataloged | — |
| Microsoft 365 / Security operations | [Microsoft Defender XDR](https://learn.microsoft.com/en-us/defender-xdr/microsoft-365-defender) | `m365_defender_xdr` | `^https?:\/\/(security\.microsoft\.com\|defender\.microsoft\.com\|protection\.office\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Task management | [Microsoft Planner](https://learn.microsoft.com/en-us/planner/planner-overview) | `m365_planner` | Not cataloged | — |
| Microsoft 365 / Video creation | [Microsoft Clipchamp](https://learn.microsoft.com/en-us/microsoft-365/clipchamp/overview) | `m365_clipchamp` | Not cataloged | — |
| Microsoft 365 / Web productivity | [Office for the web](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-online-service-description/office-online-service-description) | `m365_office_for_the_web` | `^https?:\/\/(.*\.officeapps\.live\.com\|.*\.online\.office\.com\|office\.live\.com\|.*\.office\.com\|www\.microsoft365\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft 365 / Workplace analytics | [Viva Insights](https://learn.microsoft.com/en-us/viva/insights/introduction) | `m365_viva_insights` | Not cataloged | — |

## Microsoft Azure

| Category | Node type | Stable ID | Endpoint pattern | Resource providers |
|---|---|---|---|---|
| Azure / AI + machine learning | [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/search-get-started-text) | `azure.ai.search` | `^https?:\/\/[a-z0-9-]+\.search\.windows\.net(?::\d+)?(?:\/.*)?$` | `Microsoft.Search/searchServices` |
| Azure / AI + machine learning | [Azure AI services account](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ai.services-account` | Not cataloged | `Microsoft.CognitiveServices/accounts`<br>`Microsoft.CognitiveServices/accounts/projects`<br>`Microsoft.BotService/botServices`<br>`Microsoft.VideoIndexer/accounts`<br>`Microsoft.MachineLearningServices/workspaces` |
| Azure / AI + machine learning | [Azure AI Video Indexer](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ai.video-indexer` | Not cataloged | `Microsoft.VideoIndexer/accounts` |
| Azure / AI + machine learning | [Azure Machine Learning workspace](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ai.machine-learning-workspace` | Not cataloged | `Microsoft.MachineLearningServices/workspaces` |
| Azure / AI + machine learning | [Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/developer/ai/how-to/switching-endpoints) | `azure.ai.openai` | `^https?:\/\/[a-z0-9-]+\.openai\.azure\.com(?::\d+)?(?:\/.*)?$` | `Microsoft.CognitiveServices/accounts` |
| Azure / AI + machine learning | [Bot Service](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ai.bot-service` | Not cataloged | `Microsoft.BotService/botServices` |
| Azure / Analytics | [Azure Analysis Services server](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.analysis-services` | Not cataloged | `Microsoft.AnalysisServices/servers` |
| Azure / Analytics | [Azure Data Explorer cluster](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.data-explorer` | Not cataloged | `Microsoft.Kusto/clusters`<br>`Microsoft.Kusto/clusters/databases` |
| Azure / Analytics | [Azure Data Factory](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.data-factory` | Not cataloged | `Microsoft.DataFactory/factories` |
| Azure / Analytics | [Azure Databricks workspace](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.databricks-workspace` | Not cataloged | `Microsoft.Databricks/workspaces`<br>`Microsoft.Databricks/workspaces/accessConnectors` |
| Azure / Analytics | [Azure Digital Twins instance](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.digital-twins` | Not cataloged | `Microsoft.DigitalTwins/digitalTwinsInstances` |
| Azure / Analytics | [Azure Synapse Analytics workspace](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.synapse` | Not cataloged | `Microsoft.Synapse/workspaces`<br>`Microsoft.Synapse/workspaces/sqlPools`<br>`Microsoft.Synapse/workspaces/bigDataPools`<br>`Microsoft.Synapse/privateLinkHubs` |
| Azure / Analytics | [Data Lake Store account](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.data-lake-store` | Not cataloged | `Microsoft.DataLakeStore/accounts` |
| Azure / Analytics | [Event Grid](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.messaging.event-grid` | Not cataloged | `Microsoft.EventGrid/domains`<br>`Microsoft.EventGrid/namespaces`<br>`Microsoft.EventGrid/eventSubscriptions`<br>`Microsoft.EventGrid/domains/topics`<br>`Microsoft.EventGrid/systemTopics` |
| Azure / Analytics | [Event Hubs](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.messaging.event-hubs` | `^https?:\/\/[a-z0-9-]+\.servicebus\.windows\.net(?::\d+)?(?:\/.*)?$` | `Microsoft.EventHub/namespaces`<br>`Microsoft.EventHub/namespaces/eventHubs` |
| Azure / Analytics | [Fabric Capacity](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.fabric-capacity` | Not cataloged | `Microsoft.Fabric/capacities` |
| Azure / Analytics | [HDInsight cluster](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.hdinsight` | Not cataloged | `Microsoft.HDInsight/clusters` |
| Azure / Analytics | [Power BI Embedded](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.power-bi-embedded` | Not cataloged | `Microsoft.PowerBIDedicated/capacities` |
| Azure / Analytics | [Stream Analytics cluster](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.stream-analytics` | Not cataloged | `Microsoft.StreamAnalytics/cluster` |
| Azure / Analytics | [Time Series Insights environment](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.analytics.time-series-insights` | Not cataloged | `Microsoft.TimeSeriesInsights/environments` |
| Azure / Compute | [App Service app](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.app-service-app` | Not cataloged | `Microsoft.Web/sites` |
| Azure / Compute | [App Service environment](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.app-service-environment` | Not cataloged | `Microsoft.Web/hostingEnvironments` |
| Azure / Compute | [App Service plan](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.app-service-plan` | Not cataloged | `Microsoft.Web/serverFarms` |
| Azure / Compute | [Azure Load Testing instance](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.load-testing` | Not cataloged | `Microsoft.LoadTestService/loadTests` |
| Azure / Compute | [Batch account](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.batch-account` | Not cataloged | `Microsoft.Batch/batchAccounts` |
| Azure / Compute | [Communication Services](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.communication.services` | Not cataloged | `Microsoft.Communication/communicationServices` |
| Azure / Compute | [Notification Hubs](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.notification-hubs` | Not cataloged | `Microsoft.NotificationHubs/namespaces`<br>`Microsoft.NotificationHubs/namespaces/notificationHubs` |
| Azure / Compute | [Static Web App](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.static-web-app` | Not cataloged | `Microsoft.Web/staticSites` |
| Azure / Compute | [Virtual machine](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.vm` | Not cataloged | `Microsoft.Compute/virtualMachines`<br>`Microsoft.Compute/virtualMachineScaleSets` |
| Azure / Compute | [Virtual machine infrastructure](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.compute.vm-infra` | Not cataloged | `Microsoft.Compute/availabilitySets`<br>`Microsoft.Compute/cloudServices`<br>`Microsoft.Compute/diskEncryptionSets`<br>`Microsoft.Compute/disks`<br>`Microsoft.Compute/galleries`<br>`Microsoft.VirtualMachineImages/imageTemplates`<br>`Microsoft.Compute/proximityPlacementGroups`<br>`Microsoft.Compute/restorePointCollections`<br>`Microsoft.Compute/snapshots`<br>`Microsoft.Maintenance/maintenanceConfigurations`<br>`Microsoft.Storage/storageAccounts`<br>`Microsoft.Compute/sshPublicKeys` |
| Azure / Containers | [AKS cluster](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.containers.aks` | Not cataloged | `Microsoft.ContainerService/managedClusters`<br>`Microsoft.ContainerService/managedClusters/agentPools` |
| Azure / Containers | [Container Apps](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.containers.container-apps` | Not cataloged | `Microsoft.App/containerApps`<br>`Microsoft.App/managedEnvironments`<br>`Microsoft.App/jobs` |
| Azure / Containers | [Container instance](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.containers.container-instance` | Not cataloged | `Microsoft.ContainerInstance/containerGroups` |
| Azure / Containers | [Container registry](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.containers.container-registry` | Not cataloged | `Microsoft.ContainerRegistry/registries` |
| Azure / Containers | [Service Fabric cluster](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.containers.service-fabric` | Not cataloged | `Microsoft.ServiceFabric/clusters`<br>`Microsoft.ServiceFabric/managedClusters` |
| Azure / Databases | [Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-database-account) | `azure.databases.cosmos-db` | `^https?:\/\/[a-z0-9-]+\.documents\.azure\.com(?::\d+)?(?:\/.*)?$` | `Microsoft.DocumentDB/databaseAccounts`<br>`Microsoft.DocumentDB/databaseAccounts/sqlDatabases` |
| Azure / Databases | [Azure Cosmos DB for PostgreSQL](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.databases.cosmos-db-postgresql` | Not cataloged | `Microsoft.DBforPostgreSQL/serverGroupsv2` |
| Azure / Databases | [Azure Database for MySQL](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.databases.mysql` | Not cataloged | `Microsoft.DBforMySQL/servers` |
| Azure / Databases | [Azure Database for PostgreSQL - Flexible Server](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.databases.postgresql-flexible` | Not cataloged | `Microsoft.DBforPostgreSQL/flexibleServers` |
| Azure / Databases | [Azure Managed Redis](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.databases.managed-redis` | Not cataloged | `Microsoft.Cache/RedisEnterprise` |
| Azure / Databases | [Azure SQL](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.databases.sql` | Not cataloged | `Microsoft.Sql/servers`<br>`Microsoft.Sql/servers/databases`<br>`Microsoft.Sql/servers/elasticpool`<br>`Microsoft.Sql/servers/jobAgents`<br>`Microsoft.Sql/managedInstances` |
| Azure / Developer tools | [App Configuration store](https://learn.microsoft.com/en-us/azure/azure-app-configuration/rest-api) | `azure.devtools.app-configuration` | `^https?:\/\/[a-z0-9-]+\.azconfig\.io(?::\d+)?(?:\/.*)?$` | `Microsoft.AppConfiguration/configurationStores` |
| Azure / Developer tools | [Maps account](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.devtools.maps` | Not cataloged | `Microsoft.Maps/accounts` |
| Azure / Developer tools | [SignalR Service](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.devtools.signalr` | Not cataloged | `Microsoft.SignalRService/SignalR` |
| Azure / Developer tools | [Web PubSub](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.devtools.webpubsub` | Not cataloged | `Microsoft.SignalRService/webPubSub` |
| Azure / DevOps | [Azure Managed Grafana](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.devops.managed-grafana` | Not cataloged | `Microsoft.Dashboard/grafana` |
| Azure / DevOps | [Managed DevOps Pools](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.devops.managed-devops-pools` | Not cataloged | `Microsoft.DevOpsInfrastructure/pools` |
| Azure / Hybrid + multicloud | [Azure Arc](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.hybrid.arc` | Not cataloged | `Microsoft.HybridCompute/machines`<br>`Microsoft.Kubernetes/connectedClusters`<br>`Microsoft.HybridCompute/privateLinkScopes`<br>`Microsoft.HybridCompute/gateways` |
| Azure / Integration | [API Management service](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.integration.api-management` | Not cataloged | `Microsoft.ApiManagement/service` |
| Azure / Integration | [Integration account](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.integration.integration-account` | Not cataloged | `Microsoft.Logic/integrationAccounts` |
| Azure / Integration | [Logic App](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.integration.logic-app` | Not cataloged | `Microsoft.Logic/workflows` |
| Azure / Integration | [Service Bus](https://learn.microsoft.com/en-us/rest/api/servicebus/addressing-and-protocol) | `azure.integration.service-bus` | `^https?:\/\/[a-z0-9-]+\.servicebus\.windows\.net(?::\d+)?(?:\/.*)?$` | `Microsoft.ServiceBus/namespaces`<br>`Microsoft.ServiceBus/namespaces/queues`<br>`Microsoft.ServiceBus/namespaces/topics`<br>`Microsoft.ServiceBus/namespaces/topics/subscriptions` |
| Azure / IoT | [Device Provisioning Service](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.iot.dps` | Not cataloged | `Microsoft.Devices/provisioningServices`<br>`Microsoft.Devices/provisioningServices/certificates` |
| Azure / IoT | [IoT Hub](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.iot.hub` | Not cataloged | `Microsoft.Devices/IotHubs` |
| Azure / Management and governance | [Application Insights](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ops.application-insights` | Not cataloged | `Microsoft.Insights/components` |
| Azure / Management and governance | [Automation account](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ops.automation-account` | Not cataloged | `Microsoft.Automation/automationAccounts` |
| Azure / Management and governance | [Azure Monitor](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ops.monitoring` | Not cataloged | `Microsoft.Insights/actionGroups`<br>`Microsoft.Insights/dataCollectionRules`<br>`Microsoft.Insights/dataCollectionEndpoints`<br>`Microsoft.AlertsManagement/actionRules` |
| Azure / Management and governance | [Control plane resources](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ops.control-plane` | Not cataloged | `Microsoft.Resources/resourceGroups`<br>`Microsoft.Management/managementGroups`<br>`Microsoft.Authorization/policyDefinitions`<br>`Microsoft.Resources/templateSpecs`<br>`Microsoft.Resources/deploymentScripts` |
| Azure / Management and governance | [Log Analytics workspace](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ops.log-analytics` | Not cataloged | `Microsoft.OperationalInsights/workspaces`<br>`Microsoft.OperationalInsights/querypacks` |
| Azure / Management and governance | [Microsoft Purview instance](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.ops.purview` | Not cataloged | `Microsoft.Purview/accounts` |
| Azure / Migration | [Azure Migrate project](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.migration.migrate-project` | Not cataloged | `Microsoft.Migrate/assessmentProjects` |
| Azure / Migration | [Database Migration Service instance](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.migration.dms` | Not cataloged | `Microsoft.DataMigration/services` |
| Azure / Migration | [Recovery Services vault](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.migration.recovery-services-vault` | Not cataloged | `Microsoft.RecoveryServices/vaults` |
| Azure / Networking | [Application gateway](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.application-gateway` | Not cataloged | `Microsoft.Network/applicationGateways` |
| Azure / Networking | [Application security group](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.application-security-group` | Not cataloged | `Microsoft.Network/applicationSecurityGroups` |
| Azure / Networking | [Azure Enclave](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.azure-enclave` | Not cataloged | `Microsoft.Mission/communities`<br>`Microsoft.Mission/communities/communityEndpoints`<br>`Microsoft.Mission/communities/dedicatedHubs`<br>`Microsoft.Mission/communities/transitHubs`<br>`Microsoft.Mission/virtualEnclaves`<br>`Microsoft.Mission/virtualEnclaves/enclaveEndpoints`<br>`Microsoft.Mission/enclaveConnections`<br>`Microsoft.Mission/virtualEnclaves/workloads` |
| Azure / Networking | [Delivery services](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.delivery` | Not cataloged | `Microsoft.Cdn/profiles`<br>`Microsoft.Cdn/profiles/endpoints`<br>`Microsoft.Cdn/profiles/afdEndpoints`<br>`Microsoft.Network/frontDoors` |
| Azure / Networking | [DNS](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.dns` | Not cataloged | `Microsoft.Network/dnsZones`<br>`Microsoft.Network/privateDnsZones`<br>`Microsoft.Network/dnsForwardingRulesets`<br>`Microsoft.Network/dnsResolvers`<br>`Microsoft.Network/dnsResolvers/inboundEndpoints`<br>`Microsoft.Network/dnsResolvers/outboundEndpoints` |
| Azure / Networking | [ExpressRoute](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.expressroute` | Not cataloged | `Microsoft.Network/expressRouteCircuits`<br>`Microsoft.Network/expressRoutePorts`<br>`Microsoft.Network/virtualNetworkGateways` |
| Azure / Networking | [Firewall](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.firewall` | Not cataloged | `Microsoft.Network/azureFirewalls`<br>`Microsoft.Network/firewallPolicies` |
| Azure / Networking | [Local network gateway](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.local-network-gateway` | Not cataloged | `Microsoft.Network/localNetworkGateways` |
| Azure / Networking | [NAT gateway](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.nat-gateway` | Not cataloged | `Microsoft.Network/natGateways` |
| Azure / Networking | [Network interface](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.network-interface` | Not cataloged | `Microsoft.Network/networkInterfaces` |
| Azure / Networking | [Network security](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.network-security` | Not cataloged | `Microsoft.Network/networkSecurityPerimeters`<br>`Microsoft.Network/networkSecurityGroups`<br>`Microsoft.Network/networkSecurityGroups/securityRules`<br>`Microsoft.Network/privateEndpoints`<br>`Microsoft.Network/privateLinkServices`<br>`Microsoft.Network/bastionHosts` |
| Azure / Networking | [Network Watcher](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.network-watcher` | Not cataloged | `Microsoft.Network/networkWatchers` |
| Azure / Networking | [Public IP](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.public-ip` | Not cataloged | `Microsoft.Network/publicIPAddresses`<br>`Microsoft.Network/publicIPPrefixes` |
| Azure / Networking | [Route resources](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.route` | Not cataloged | `Microsoft.Network/routeFilters`<br>`Microsoft.Network/routeTables`<br>`Microsoft.Network/routeTables/routes`<br>`Microsoft.Network/virtualHubs` |
| Azure / Networking | [Service endpoint policy](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.service-endpoint-policy` | Not cataloged | `Microsoft.Network/serviceEndPointPolicies` |
| Azure / Networking | [Virtual network](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.network.virtual-network` | Not cataloged | `Microsoft.Network/virtualNetworks`<br>`Microsoft.Network/virtualNetworks/subnets`<br>`Microsoft.Network/virtualNetworks/virtualNetworkPeerings`<br>`Microsoft.Network/networkManagers`<br>`Microsoft.Network/virtualWans`<br>`Microsoft.Network/virtualHubs` |
| Azure / Security | [Azure Bastion](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.security.bastion` | Not cataloged | `Microsoft.Network/bastionHosts` |
| Azure / Security | [Key Vault Managed HSM](https://learn.microsoft.com/en-us/azure/key-vault/general/about-keys-secrets-certificates) | `azure.security.managed-hsm` | `^https?:\/\/[a-z0-9-]{3,24}\.managedhsm\.azure\.net(?::\d+)?(?:\/.*)?$` | `Microsoft.KeyVault/managedHSMs` |
| Azure / Security | [Managed identity](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.security.managed-identity` | Not cataloged | `Microsoft.ManagedIdentity/userAssignedIdentities` |
| Azure / Security | [SSH key](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.security.ssh-key` | Not cataloged | `Microsoft.Compute/sshPublicKeys` |
| Azure / Security | [VPN Gateway](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.security.vpn` | Not cataloged | `Microsoft.Network/vpnGateways`<br>`Microsoft.Network/vpnGateways/vpnConnections`<br>`Microsoft.Network/vpnGateways/vpnSites` |
| Azure / Security | [Web Application Firewall policy](https://learn.microsoft.com/en-us/azure/networking/design-guide/web-application-firewall) | `azure.security.waf` | Not cataloged | `Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies`<br>`Microsoft.Network/FrontDoorWebApplicationFirewallPolicies`<br>`Microsoft.Cdn/cdnWebApplicationFirewallPolicies` |
| Azure / Storage | [Backup Vault](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.storage.backup-vault` | Not cataloged | `Microsoft.DataProtection/resourceGuards`<br>`Microsoft.DataProtection/backupVaults`<br>`Microsoft.DataProtection/backupVaults/backupPolicies` |
| Azure / Storage | [File share](https://learn.microsoft.com/en-us/azure/storage/files/create-file-share) | `azure.storage.file-share` | Not cataloged | `Microsoft.Storage/storageAccounts/fileServices/shares`<br>`Microsoft.FileShares/fileShares` |
| Azure / Storage | [Storage account](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction) | `azure.storage.storage-account` | `^https?:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net(?::\d+)?(?:\/.*)?$` | `Microsoft.Storage/storageAccounts` |
| Azure / Storage | [Storage Sync Service](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.storage.storage-sync` | Not cataloged | `Microsoft.StorageSync/storageSyncServices` |
| Azure / Virtual desktop infrastructure | [Virtual desktop application group](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.vdi.application-group` | Not cataloged | `Microsoft.DesktopVirtualization/applicationGroups` |
| Azure / Virtual desktop infrastructure | [Virtual desktop host pool](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.vdi.host-pool` | Not cataloged | `Microsoft.DesktopVirtualization/hostPools` |
| Azure / Virtual desktop infrastructure | [Virtual desktop scaling plan](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.vdi.scaling-plan` | Not cataloged | `Microsoft.DesktopVirtualization/scalingPlans` |
| Azure / Virtual desktop infrastructure | [Virtual desktop workspace](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) | `azure.vdi.workspace` | Not cataloged | `Microsoft.DesktopVirtualization/workspaces` |

## Microsoft Fabric

| Category | Node type | Stable ID | Endpoint pattern | Resource providers |
|---|---|---|---|---|
| Microsoft Fabric / Analytics | [Power BI](https://learn.microsoft.com/en-us/power-bi/fundamentals/power-bi-overview) | `PowerBI` | `^https?:\/\/(.*\.powerbi\.com\|api\.powerbi\.com\|.*\.analysis\.windows\.net\|.*\.pbidedicated\.windows\.net)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft Fabric / Analytics platform | [Microsoft Fabric](https://learn.microsoft.com/en-us/fabric/fundamentals/microsoft-fabric-overview) | `MicrosoftFabric` | `^https?:\/\/(.*\.fabric\.microsoft\.com\|api\.fabric\.microsoft\.com\|.*\.onelake\.(?:dfs\|blob)\.fabric\.microsoft\.com)(?::\d+)?(?:\/.*)?$` | — |
| Microsoft Fabric / Fabric workload | [Fabric Data Engineering](https://learn.microsoft.com/en-us/fabric/data-engineering/data-engineering-overview) | `FabricDataEngineering` | Not cataloged | — |
| Microsoft Fabric / Fabric workload | [Fabric Data Factory](https://learn.microsoft.com/en-us/fabric/data-factory/data-factory-overview) | `FabricDataFactory` | Not cataloged | — |
| Microsoft Fabric / Fabric workload | [Fabric Data Science](https://learn.microsoft.com/en-us/fabric/data-science/overview/) | `FabricDataScience` | Not cataloged | — |
| Microsoft Fabric / Fabric workload | [Fabric Data Warehouse](https://learn.microsoft.com/en-us/fabric/data-warehouse/overview) | `FabricDataWarehouse` | `^https?:\/\/.*\.datawarehouse\.fabric\.microsoft\.com(?::\d+)?(?:\/.*)?$` | — |
| Microsoft Fabric / Fabric workload | [Fabric Databases](https://learn.microsoft.com/en-us/fabric/database/) | `FabricDatabases` | `^https?:\/\/.*\.database\.fabric\.microsoft\.com(?::\d+)?(?:\/.*)?$` | — |
| Microsoft Fabric / Fabric workload | [Fabric Real-Time Intelligence](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/overview) | `FabricRealTimeIntelligence` | `^https?:\/\/.*\.kusto\.fabric\.microsoft\.com(?::\d+)?(?:\/.*)?$` | — |
| Microsoft Fabric / Fabric workload | [OneLake](https://learn.microsoft.com/en-us/fabric/onelake/onelake-overview) | `FabricOneLake` | `^https?:\/\/.*\.onelake\.(?:dfs\|blob)\.fabric\.microsoft\.com(?::\d+)?(?:\/.*)?$` | — |

## Power Platform

| Category | Node type | Stable ID | Endpoint pattern | Resource providers |
|---|---|---|---|---|
| Power Platform / AI capability | [AI Builder](https://learn.microsoft.com/en-us/ai-builder/overview) | `AIBuilder` | Not cataloged | — |
| Microsoft 365 / Agent governance | [Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/) | `Agent365` | Not cataloged | — |
| Integration / Data gateway | [On-premises data gateway](https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem) | `OnPremisesGateway` | `^https?:\/\/(.*\.servicebus\.windows\.net\|gatewayadminportal\.azure\.com\|.*\.frontend\.clouddatahub\.net)(?::\d+)?(?:\/.*)?$` | — |
| Power Platform / Application platform | [Power Apps](https://learn.microsoft.com/en-us/power-apps/) | `PowerApps` | `^https?:\/\/(.*\.powerapps\.com\|.*\.api\.powerplatform\.com\|.*\.powerplatform\.com\|.*\.crm[0-9]*\.dynamics\.com)(?::\d+)?(?:\/.*)?$` | — |
| Power Platform / Automation | [Power Automate](https://learn.microsoft.com/en-us/power-automate/) | `PowerAutomate` | `^https?:\/\/(.*\.flow\.microsoft\.com\|.*\.powerautomate\.com\|.*\.logic\.azure\.com\|.*\.azure-apim\.net\|.*\.azure-apihub\.net)(?::\d+)?(?:\/.*)?$` | — |
| Power Platform / Websites | [Power Pages](https://learn.microsoft.com/en-us/power-pages/) | `PowerPages` | `^https?:\/\/(.*\.powerappsportals\.com\|.*\.powerpages\.microsoft\.com)(?::\d+)?(?:\/.*)?$` | — |
| Power Platform / Data platform | [Microsoft Dataverse](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-intro) | `Dataverse` | Not cataloged | — |
| Power Platform / Dataverse component | [Dataverse Table](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-intro) | `Dataverse Table` | Parent Dataverse APIs; no separate host classifier | — |
| Power Platform / Dataverse component | [Dataverse Plugin](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/plug-ins) | `Dataverse Plugin` | Event handler; no standalone host classifier | — |
| Power Platform / Agents and workflows | [Microsoft Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio) | `CopilotStudio` | Not cataloged | — |
| Power Platform / Integration | [Power Platform connectors](https://learn.microsoft.com/en-us/power-platform/) | `PowerPlatformConnectors` | Select the connector/backend; no family-wide classifier | — |
