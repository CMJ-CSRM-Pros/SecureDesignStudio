# SecureDesignStudio user guide

*Updated: 2026-09-22 - Start from the root launcher scripts.*

**Contents**

1. [What SecureDesignStudio is](#1-what-securedesignstudio-is)
2. [How to install and run](#2-how-to-install-and-run)
3. [Simple how-to](#3-simple-how-to)
4. [Advanced features](#4-advanced-features)
5. [Analysis and review](#5-analysis-and-review)
6. [Using sequence view](#6-using-sequence-view)
7. [Import and export](#7-import-and-export)
8. [Troubleshooting and quick reference](#8-troubleshooting-and-quick-reference)

## 1. What SecureDesignStudio is

SecureDesignStudio helps engineers, service owners, and security/privacy
reviewers describe information flows, record assumptions and controls, and
review a design.

| Concept | Meaning |
|---|---|
| **Node** | A service, process, datastore, or external dependency. |
| **Flow / edge** | A source-to-target call with request and response data. |
| **Boundary** | A labeled security perimeter or privacy region containing nodes. |
| **Scenario** | A workflow with its own membership, call order, data attachments, retention, and comments. |
| **Deviation** | A document-wide, evidence-backed exception with a stable key, required explanation, and review status. |
| **Document** | The whole model, scenarios, and review records, saved as `.tma`. |

Nodes, edges, and boundaries are shared across scenarios. Renaming a shared
node changes it everywhere; changing a scenario's flow order does not.
Selecting a scenario hides objects outside its membership.

**This is modeling metadata, not resource configuration or certification.**
Authentication describes flows, not app sign-in. Boundaries do not enforce
isolation; a clean analysis does not prove real services secure or compliant.

## 2. How to install and run

### From source on Windows

Use Git, PowerShell, a current browser, and **Node.js 24 LTS with npm**.
The locked frontend toolchain requires Node 22.12 or later; Node 24 LTS is
the recommended choice and also supports the repository's contributor checks.
Use the repository URL supplied by the distribution or its owner. Ordinary
modeling needs no Azure account, API, MCP server or cloud resource.

```powershell
git clone <repository-url> SecureDesignStudio
cd SecureDesignStudio
.\Start-SecureDesignStudio.ps1
```

The launcher is in the repository root, so there is no folder to hunt for. It
verifies your prerequisites before doing anything: if Node.js, npm, or a
supported version is missing, it names what is missing and the exact command
that installs it, instead of failing with a raw error. It then installs
dependencies on first run and starts the app.

Open **http://localhost:5173/**. Keep that terminal running; Ctrl+C stops it.
Port 5173 is strict: the launcher checks it first and, when it is busy, reports
the owning process. Stop only your own server, and never an unfamiliar process
on a shared machine. Follow the
[port guidance](#8-troubleshooting-and-quick-reference).

This starts Vite only. Collaboration and Design Assistant are disabled.
After initial page load, editing, analysis, autosave, and local file operations
work offline. External help links and optional network features are separate.

If you prefer to run the underlying steps yourself, `npm ci` followed by
`npm run dev` is equivalent and performs no prerequisite checks.

### Start with the optional AI assistant

The AI Design Assistant is **bring your own AI**. No model service ships with
SecureDesignStudio and none is provided for you: you supply an Azure OpenAI
resource you are authorized to use. Everything in this guide except Chat and AI
Analysis works without it.

That mode needs three things beyond the setup above:

| Requirement | Notes |
|---|---|
| Azure Functions Core Tools | Runs the local API on port 7071. The launcher reports the install command if it is missing. |
| Azure CLI, signed in | A secured account accepts Microsoft Entra tokens only, so `az login` is required. No API key is used. |
| Your own Azure OpenAI deployment | Its HTTPS endpoint and model deployment name. |

```powershell
$env:AZURE_OPENAI_ENDPOINT = "https://<your-resource>.openai.azure.com"
$env:MODEL_DEPLOYMENT_NAME = "<your-model-deployment-name>"
az login
.\Start-SecureDesignStudio-WithAI.ps1
```

Add `-VerifyEndpoint` to probe the deployment before starting, which reports a
missing role, a blocked IP, or a wrong deployment name as a clear message
rather than an opaque failure in the browser.

To create that Azure OpenAI instance and secure it properly — disabling key
authentication, restricting network access, and assigning the data-plane role —
follow [Bring your own AI](bring-your-own-ai.md). For what the assistant sends,
see [advanced configuration](advanced-configuration.md).

### Update an existing clone safely

Inspect `git status --short --branch` in the clone. Save a `.tma` backup,
stop only your own server, preserve local changes, and confirm the intended
branch before running:

```powershell
git pull --ff-only
.\Start-SecureDesignStudio.ps1
```

The launcher reinstalls dependencies only when `node_modules` is absent. After
a lockfile change, run `npm ci` once yourself. Resolve Git conflicts or
non-fast-forward updates with the branch owner; do not discard edits or switch
a shared preview branch.

### From a trusted standalone HTML file

A trusted `dist-single\index.html` or exported standalone HTML opens directly
in a browser without Git, Node, or a server. Obtain it from an approved source;
no public download or release package is assumed.

To build it from your trusted clone, run `npm run build:single` and open
`dist-single\index.html`. This does not deploy a website. Standalone editing
works offline, but enabled collaboration can contact services, unlike
`.\Start-SecureDesignStudio.ps1`.

## 3. Simple how-to

### Build a proposed threat model with AI

When the existing Assistant service is configured, choose **Design with AI**
on the first-scenario screen, or **File > Design with AI** (directly below
**Open**) for the selected
scenario. For example: “I need a web server to securely host documents for
authenticated users.” With an existing document, select a scenario first:
**Show all** cannot be an authoring target. **New scenario** remains a manual
creation flow; create and select it before asking AI to populate it.

The **Threat Model Designer** is a modeless prompt dialog. Enter sends;
Shift+Enter inserts a newline. A valid response immediately adds or refines
catalog-backed components, directional flows, data and boundaries. The model
switches to Diagram view and fits the design. **Collapse** leaves more canvas
visible. Drag the title bar to move the dialog, or focus the title bar and use the
arrow keys (Shift+arrow moves farther). It stays within the available viewport
when resized. Active filters have an explicit **Clear filters and show design**
remedy. The bottom-left zoom controls remain available.

Each applied response is one model Undo step, including creation of the first
scenario. Redo restores it. Ask follow-up questions to refine the same IDs.
Clarifications, invalid/incomplete responses and cancelled requests do not
change the model or history. **Stop generating**, closing the dialog, switching
scenarios or a timeout discards the pending response. If model semantics or
catalog choices change while AI is working, resend the prompt; it will not
overwrite that work. Existing authored geometry is retained where possible;
unsafe boundary expansion is rejected rather than enclosing unrelated nodes.

AI can add, edit and delete components, connections and boundaries, redirect
connections, and remove data attachments or boundary members. Give an explicit
design instruction such as **"Route browser traffic through Application Gateway
and remove the direct connection to the web app."** Adding an exclusive gateway
should replace bypass paths, not simply add parallel connections. Advice-only
questions can still return an explanation without changing the diagram.

**Deletion is global**, matching the editor's Delete action, including all
scenarios using the item. Deleting a component removes its remaining incident
connections and their comments/issues; a connection explicitly rerouted away
from it in the same response survives. Deleting a boundary keeps its components.
Evidence-backed deviations are retained without their deleted target, not
silently resolved. Other model content and reusable data are preserved.

Rerouting retains the connection ID and sequence numbers, updates the connection
everywhere it is shared, and includes its new endpoints in those scenarios.
Old endpoint-specific identity/audience/rights claims and routing handles are
cleared where no longer applicable; review the new flow's required controls.
Data attachment replacement affects only the selected scenario, not reusable
data, other scenarios' attachments, or previously recorded node retention.
Removing boundary members moves them outside that boundary while preserving
their other memberships. Conflicting geometry rejects the entire response.

Each response remains **one Undo step** for all additions, removals and reroutes.
The result shows counts calculated from the applied model, rather than only
the AI's prose. Empty/no-op responses do not add history. Request/response data
remain separate. New catalog selections must still be available and permitted.

To change the execution sequence, ask **"Order the flows browser to WAF, WAF
to backend, then backend to Copilot."** AI can explicitly reorder the selected
scenario's complete flow list and renumber it from 1. Other scenarios keep their
own order and numbers. This does not change the connection endpoints or canvas
positions. Sequence participants follow first appearance in the saved flow list;
an order-only edit keeps Sequence view open so the result is immediately visible.
Correct connectivity alone does not establish correct execution order.

When AI attaches data to a flow, the receiving node's **Privacy** inventory is
populated immediately in the same undoable edit: request data goes to the
target, response data to the source. You do not need to run Analyze first.
The node's General tab offers **View privacy data** when items are recorded.
Newly propagated retention is **Not specified** until you choose it; existing
retention choices are preserved. "Low risk" does not mean public/nonpersonal
data or establish that data is never stored. Review classification and retention
separately. Removing a flow attachment does not erase prior node retention.

**This is proposed, unverified design intent, not deployment evidence,
certification or a complete threat assessment.** Review generated descriptions,
assumptions, authentication, data and boundaries before relying on them.
Specialized services without an available catalog entry require an explained
generic component or clarification. No deployment or evidence discovery occurs.

Your prompt, up to 12 prior conversation messages, the selected scenario's
authoring context and available catalog choices go to the **same configured
Assistant endpoint**. The dialog discloses the destination. Conversation is
retained in this browser session when you close and reopen the dialog, including
your unfinished prompt. Closing still cancels a pending request; it cannot apply
a late response. Switching scenarios, opening or creating a model, or refreshing
clears the conversation and draft. Neither is saved in `.tma`, autosave,
standalone HTML or collaboration. Generated model content and explicit
assumptions are saved normally. **Review > Design Assistant** remains the
separate analysis/chat experience.

Default credential-free `npm run dev` makes no AI requests. Manual scenario
creation remains available. To enable AI, use the existing explicitly configured
[optional AI workflow](advanced-configuration.md#optional-local-design-assistant);
this feature introduces no new service or credential setting.

Use synthetic data for **Submit a support case**: a web frontend calls an API
that writes to Dataverse. Authentication and retention below are practice
assumptions, not service policy recommendations.

1. **Start a scenario.** In a blank app, name it in **Create your first
   scenario** and choose **Create**. Otherwise save your existing work before
   **File > New**, or use **Model > New scenario** to add a workflow without
   replacing it. Select `Submit a support case` in the top bar.
2. **Add three nodes.** Right-click blank canvas and choose **New Node**.
   In **Properties > General / Security**, set titles `Support web`,
   `Support API`, and `Case store`. Choose **App Service app** for the first
   two and **Storage account** for the store. Unspecified policy needs review.
3. **Connect the workflow.** Drag a node handle from Support web to Support
   API, then from Support API to Case store. Select each arrow and set its
   **Title** to `Submit case` or `Store case`. Direction follows the arrow,
   not the nodes' left-to-right positions.
4. **Describe authentication.** In the flow's **General / Security** tab,
   select **Entra user** for Submit case and **Entra app** for Store case,
   under the example's assumptions. Read the Description below the selector.
   Record required Audience and Production identity from evidence, not
   invented production IDs; flag unknowns for review.
5. **Define and attach data.** Choose **Model > Data Elements > Add data item**.
   Name it `Case text`, classify it as **Customer Content**, and leave Sample
   blank or synthetic. On each flow's **Privacy** tab, attach it under
   **Data in request**. Reuse the same item on both flows.
6. **Mark the perimeter.** Right-click blank canvas > **New Security Boundary**.
   Name it `Support service`, size it around Support API and Case store, and
   explain the crossing in a flow comment. Add a **New Privacy Boundary**
   when there is a meaningful privacy scope.
7. **Complete retention.** Choose **Review > Analyze** to propagate incoming
   data onto receiving nodes. Select Support API and Case store in turn;
   in **Privacy**, set Case text retention for this scenario. For this
   practice workflow, the API processes only and the store retains data at
   least 48 hours. Verify real lifecycle requirements before using those choices.
8. **Review and save.** Analyze again, inspect **Review > Issues**, and record
   unanswered questions as comments or work items. Use **File > Save as >
   SecureDesignStudio model (.tma)** and name it `support-case.tma`.
   Use **File > Open** to reopen that saved file and check the scenario.

Core provides an optional **Inventory ID**, accepting ordinary text such as
`ASSET-123`. The compatible JSON field remains `serviceTreeId`. Custom library
can label the same field **ServiceTreeId** and add GUID validation and a
required-value check. Existing values remain editable without that library.
Private curated policies still require the selected Custom library or a saved
document definition. Neutral public Dataverse, Dataverse Table, Dataverse
Plugin, Microsoft Copilot Studio and Power Platform connectors are available
without it. `CopilotStudio` is the public agent product; the optional spaced
`Copilot Studio` identity is not its alias. See the [catalog guide](microsoft-cloud-node-catalog.md)
for product distinctions, selected integrations and unresolved lifecycle scope.

Opening node properties does not replace saved **Inventory ID** or
**EndpointRegex** values with catalog defaults. When they differ, review the
notice and use **Use type metadata** only if replacement is intended; it asks
for confirmation and supports Undo/Redo. Recommitting the current type leaves
the values alone. A different type applies only valid supplied defaults; fields
without a supplied default keep their existing values.

The right-hand inspector edits the selection; **View > Properties** returns
to details. For nodes and flows, **Custom metadata** appears below **Issues**,
after the **General / Security** or **Privacy** fields. **Undo/Redo** recovers
edits. On narrow screens use the menus when direct buttons are hidden.
**Autosave is recovery, not backup**:
save `.tma` in an approved location before replacing or sharing a model.

## 4. Advanced features

### DFD roles and scenario scope

A service **Type** and its **DFD role** are independent. In **Model > Node Type
Catalog**, set Default DFD role to Process, Data Store, or External Interactor.
Azure SQL has an explicit Data Store default. Other unclassified services use
the conservative Process fallback; there is no title/icon-based guessing.
In node **Properties > General / Security**, choose **Use type default** or an
explicit override. A SQL node can be Process without changing its service type,
identity, endpoint, or policy. An explicit override survives later type changes.

For an active scenario, enter an **Out-of-scope reason** on the node. Blank or
whitespace means in scope. The reason applies only to that scenario; duplicating
a scenario copies its reasons independently. Show all displays per-scenario
context and does not provide a global scope editor. Removing membership keeps a
dormant reason for an existing node; deleting the node removes its reasons.

Clear an ordinary editable reason by deleting its text. Recovery-only actions
remain for nonblank inactive External Interactor reasons and unrecognized
imported evidence; clearing them is explicit and undoable.

The application's **Undo** and **Redo** treat a continuous scope-reason edit
as one unit and keep its node editor visible while that node remains valid in
the same active scenario. Leaving the field or editing another field starts a
separate gesture; selected-text replacement and switching between typing and
deletion are separate edits. Enter still inserts a newline and starts a new
group. Other model actions are not folded into the scope edit. **Ctrl/Cmd+Z
inside the text field** remains the browser's native text undo, not the app's
history command. Editor context is local to the current session: restored or
imported history does not carry this context and does not promise to reopen
the same editor.

External Interactors are black boxes, **never effectively out of scope**.
Imported contradictory reasons remain visible but inactive and can be cleared.
Unknown roles and malformed fields are retained as bounded recovery evidence,
with visible diagnostics; they cannot silently exclude node interiors. Older
models remain Process until explicitly adopting defaults, even when a newly
installed library gives their service a different role.

Canvas shapes, textual role/scope labels, dashed out-of-scope borders, sequence
headers, edge context and reports carry the semantics without hiding graph
content. **Scope appearance (this browser)** in Properties changes local accents
only; shapes and labels remain and preferences are not collaborative model data.

Only optional **LLM review** applies scope exclusions: Process/Data Store
interiors are included unless out of scope; External Interactor interiors are
excluded. All flows remain included except External Interactor connected to an
out-of-scope node, in either direction. Request/response data use the same
eligibility. Included crossing flows retain minimal endpoint identity context,
not the excluded node's description, retention or other interior details.
Missing endpoints are structural gaps, not successful review.
**Analyze's deterministic checks are unchanged.** Scope edits do not delete,
resolve or re-rate existing/manual findings.

Native `.tma`, autosave/history, standalone HTML, semantic comparison and
compatible Yjs peers retain the model's roles and per-scenario reasons.
Node-catalog packages carry type role defaults, not node overrides or
scenario scope reasons. Use clients
with this feature on every peer: older normalizers can discard these fields.
Concurrent changes to one scenario's reason map use the existing atomic-map
Yjs behavior (one whole map wins, not per-node/text merging). Native `.tma`
remains authoritative; external formats may omit these semantics.

### Reuse scenarios without duplicating services

Use **Model > Duplicate current scenario** or **New scenario > Start from**,
then adjust membership and data. **Scenario settings** edits the description.
Duplication copies memberships, numbering, attachments, and node retention,
but not comment threads.

**Add to scenario / Remove from scenario** changes the selected object's
membership. Removing a node also removes its touching flows from that scenario.
The last membership can offer deletion; global deletion affects all scenarios.
Read **Model > Delete current scenario**'s impact dialog: scenario-exclusive
nodes/flows can be deleted, while shared objects remain.

### Choose and customize libraries

**Model > Node Type Catalog** supports search, document-local definitions,
shipped overrides/reset, and JSON import/export. Changes travel with `.tma`,
not to other diagrams or repository source. See the
[cloud catalog](microsoft-cloud-node-catalog.md) for services, icons, sources,
and Unspecified-policy limitations.

**AI design guidance** is an optional, separate field in the catalog editor.
Reviewed Microsoft cloud entries now include short **Context / Dependencies /
Risks / Uncertainty** guidance, with explicit owner-withheld types left blank.
For a Power Pages site that uses an agent to summarize Dataverse data, the
default catalog offers `PowerPages`, `CopilotStudio` and `Dataverse` directly;
Microsoft 365 Copilot need not be used as a substitute. Confirm the intended
Copilot product, supported site/agent integration, effective connection
identity and summary audience. Guidance does not create dependency nodes or
verify that a proposed control is deployed.
It is untrusted reference text for Threat Model Designer and Design Assistant,
not a policy rule, risk waiver, or evidence that a deployment has a control.
Existing Description text is never converted into guidance automatically.
In node **Properties > General / Security**, expand **AI design guidance** to
read it and its source URLs/revision/edit date. **Edit guidance for this type in
this diagram** opens a draft with explicit Save and Cancel (Escape cancels and
returns focus). Saving affects every node of that type in this diagram, across
scenarios, but not installed libraries, instance metadata or policy. Undo/Redo
restores the entire edit. Remove guidance from the draft and Save to clear it;
the saved type definition still wins over installed guidance.
Source URLs are not fetched automatically, and revision/date do not imply
review approval. Native files, autosave, exported HTML, node catalogs and
current-version collaborators retain guidance. Older readers and lossy external
formats are not guaranteed to retain it. See the [guidance contract and
limits](custom-libraries.md#ai-design-guidance).

**Model > Customize authentication** opens one Authentication Library per
browser profile/origin. Edit **Method** and **Description** for flow selectors
and node-type policies. It contains 17 modern profiles plus the ambiguous
legacy certificate entry. It also distinguishes **Internal process call** from
anonymous access: use it only for calls that stay inside one process boundary
and require no particular authentication mechanism. The flow inspector hides
Production identity controls for this method while retaining any existing
identity evidence for later method changes. JSON import/export moves it between
profiles without editing shipped source JSON.

Library presence is not target acceptance. **Not specified** means no selection;
**Custom method** is unverified. Disabled methods remain on existing flows.
Saved diagram definitions do not overwrite your library: resolve conflicts
explicitly. Never infer direct mTLS from legacy certificate authentication.
The [library contract](authentication-library.md) covers stable IDs,
safe deletion, Undo/Redo, and compatibility.

### Document required flow access rights

Select a flow and open **Properties > General / Security > Required access
rights** to record an Azure RBAC role or rights such as read/write/execute.
This is optional declared intent, not verification of deployed grants or
compliance. Authentication and production identity remain independent.
The same flow shares its text across all scenarios; parallel flows have
separate values. Blank means unspecified, not no rights required. The limit
is 4,000 UTF-16 code units; some characters count as two. Invalid edits are
rejected, not shortened.

Save `.tma` or portable application HTML to retain the exact text and newlines.
The HTML review report displays it in full with its flow. Use current editing
clients and keep a native backup: older readers can discard this field.
TM7, VSDX and PNG are not full-metadata backups. The
[TM7 loss preview](tm7-compatibility.md#intentional-losses) reports nonblank
rights omitted from exported flows; it does not map them to native permissions.

### Document boundary network intent

Move a security or privacy boundary by dragging its **outer border**, not its
empty center. Empty interior space passes through to canvas gestures and
underlying items, so it will not move the boundary or its contained nodes.
Border dragging moves the boundary and its members together. Select its border
or title to inspect it; use the visible resize handles to resize, and
double-click the title to rename. Each move/resize is one Undo step.

Select a security boundary and open **Properties** to edit **Inbound Allow**,
**Inbound Deny**, **Outbound Allow**, and **Outbound Deny**. These four optional
multiline values are plain-text declared intent, not parsed firewall rules,
verified enforcement or compliance. Blank means undocumented. Text and
newlines are retained without a field-specific length or network-syntax limit;
non-text saved values produce an explicit recovery error rather than coercion.

Notes belong to the boundary instance: the same ID shares them across scenarios.
Ordinary new boundaries start blank and never infer a source. Scenario Duplicate
shares boundary IDs; it does not create independent boundary copies. There is
no new source selector, Duplicate command or inheritance mechanism.

Switching to Privacy retains the notes as inactive native data, hides their
editors and excludes them from reports and Assistant context. Switching back
to Security restores access. Unrelated title, geometry and subtype edits keep
the notes. Active security notes may accompany an explicitly requested
Assistant review; editing them does not trigger an AI call.

Save `.tma` or portable application HTML for a complete backup. Review reports
show active notes as escaped multiline text. Use current editing clients:
older readers may discard these fields. TM7, VSDX and PNG do not preserve this
metadata. The [TM7 loss preview](tm7-compatibility.md#intentional-losses) counts
distinct exported security boundaries with nonblank notes without displaying
their contents or inventing native network fields. Privacy boundaries and
objects outside all scenarios retain their existing separate omission notices.

### Model privacy and lifecycle

**Model > Customize classifications** opens the Classification Library editor.
Add/edit names and descriptions, select an enabled default, disable or safely
delete unused entries, and import/export JSON. Import previews distinguish
Merge (keep the active identity/default) from Replace (use the incoming list).
Existing IDs and saved definitions are retained; adopting a changed diagram
definition is an explicit, undoable action.

The Data inspector shows the active library/source/default. Existing
out-of-list values remain readable while new choices use the active enabled
list. See the [Classification Library contract](classification-library.md)
for storage, recovery, history, and format details.

Reuse Data Elements across flows. The shared defaults retain the original ten
types and add Administrator Data and Customer Data, aligned with public
[Microsoft Purview guidance](https://learn.microsoft.com/en-us/purview/purview-privacy).
Customer Content stays narrower than Customer Data; Administrator Data describes
people's administrative activity, not permission records. Read the descriptions
and assess actual content: pseudonymized identifiers and system metadata can
still be personal data. Category colors are not a legal risk scale.
Do not enter real sensitive samples. Stored profiles and models keep their
definitions until explicitly edited or updated; a newer build does not
automatically replace them.

Request data travels **source to target**; response data travels **target to
source**. Attach each under the flow's Privacy tab and review policy on that
direction's receiver. Attachment pickers use curated receiver policy;
availability is not approval.

After Analyze, review each receiving node's **Privacy** tab. Retention is
per data item, node, and scenario: unset, processing only, storage under
48 hours, or storage of at least 48 hours. Existing authored retention is
preserved when data is propagated.

Type-level default privacy boundary and GDPR handling are reference policy,
not automatic boundaries. Geographic/post-subscription overrides appear where
the type exposes them. Confirm retained-days ranges, calling-service
responsibility, and Unknown/deferred values with the owner.

### Navigate a larger model

Core privacy boundaries offer Geo boundary. Core security choices are IFrame,
CSP, Azure, User browser, User Tenant Trust, VNet, Subnet, Container, Process,
and Machine. Select a boundary and use **Properties > Security subtype** to
choose its type and read its description. New security boundaries still
default to IFrame. A subtype describes intended separation, not proof that
isolation is enforced; the Process boundary subtype is distinct from a node's
DFD role.

Organization compliance/deployment perimeters and the ESTS
evidence-kind label are available for new selections only when their library
is installed. Saved values retain their labels/descriptions or appear as
unresolved IDs; they are not silently replaced with generic choices. A saved
definition does not install a library. Saved definitions take precedence over
same-ID installed definitions; **Saved catalog definitions** reports conflicting
labels or descriptions without replacing the saved meaning. Without a saved
snapshot, an available same-ID definition supplies the current meaning; this
does not recover an absent author's original description. With neither a
snapshot nor an available definition, the ID remains unresolved. See
[Custom Libraries](custom-libraries.md) for the portable-definition contract.

**Filter** stages text, node-type, auth, and classification choices until
**Apply**. Cancel/Escape discards drafts; **Clear all** immediately clears
active and staged filters. Only visibility changes.

Inspector tabs cover Properties, Edges, Issues, Comments, Changes, Data, Work,
and Findings. Tabs with a count show it beside the label; Findings counts the
AI findings from the most recent AI Analysis. Pin to retain a tab; ordinary
unpinned tabs follow
selection, while Edges/Changes retain context. Resize with the separator or
its arrow keys; double-click to reset. **View > Inspector** closes/reopens it.
On narrow screens, **Expand inspector** gives the bottom panel more height;
**Restore inspector size** returns it to its usual height. These buttons work
with keyboard and touch, and keep the canvas zoom controls above the panel.

New browser profiles use **light mode**. Toggle **Settings > Dark Theme** to
choose dark mode; your saved choice survives reloads. **Reset all preferences**
returns to light mode without changing the diagram.

In Diagram, drag a selected flow's line or double-click it to add routing
waypoints; select a waypoint to move/delete it. Double-click a node or flow
title for inline editing.

### Collaborate or use optional AI

**About** shows effective collaboration and Design Assistant availability and
configured destinations. These are deployment settings, not permissions or
proof that a service is reachable. A disabled collaboration build ignores room
links and keeps editing local; the Assistant explains when no service is
configured. A plain build has no collaboration or Assistant destination.
Deployers explicitly select service configuration; Custom Libraries alone
cannot enable networking. Removing service defaults does not replace the
remaining content/licensing and public-release review.

Deployed/standalone collaboration can start encrypted rooms from the status
menu. Protect the full URL and its decryption key; share only with authorized,
compatible peers. Rooms share diagrams, not profile library preferences.
An optional Copilot CLI participant can inspect and make authorized edits.

**Review > Design Assistant** provides optional network-backed Chat/AI Analysis,
not local Analyze. It is **bring your own AI**: it calls an Azure OpenAI
deployment you supply, and is unavailable until you configure one. See
[bring your own AI](bring-your-own-ai.md) to create and secure that instance,
and [start with the optional AI assistant](#start-with-the-optional-ai-assistant)
to run it. Requests include active-scenario context, not just selected
or filtered objects. [Advanced configuration](advanced-configuration.md) covers
approved data/endpoint handling and collaboration/CLI safeguards.

AI Analysis and Chat require a specific scenario in the top-bar **Scenario**
selector. **(Show all)** displays the whole diagram but does not provide an AI
analysis scope. Native `.tma` files preserve this view choice, so a valid model
can reopen with Assistant actions disabled. The Assistant notice explains how
to select a scenario, or create one through **Model > New scenario** when none
exist. Selecting a scenario removes this notice; separate endpoint/local-mode
restrictions still apply.

Select an AI finding's heading (or **Focus**) to select and center its first
available referenced node, flow, or boundary. Assistant keeps the current
scenario when it contains the target; otherwise it opens a containing scenario,
or Show all for an unassigned target. The selected finding is marked until the
diagram selection moves away. Like Issues, an unpinned inspector follows the
selection to Properties; pin it to keep reviewing findings. Chat reference
buttons use the same navigation. Missing references are shown as unavailable.

When space permits, AI Analysis scrolls its results while the mode selector and
model context remain visible; Chat keeps its own scrolling area and fixed
composer. In short panels, Assistant content scrolls together instead, keeping
the inspector title and tabs visible. Scroll or Tab through finding actions to
reach the final result. In the compact layout, focus the Assistant panel and
use Page Up/Page Down or Home/End to scroll with the keyboard.

Drag the Chat text box's bottom-right handle to resize it vertically. Its height
is bounded to preserve space for the rest of the panel; longer text scrolls
inside the box. Resizing does not enable AI in credential-free local mode.

## 5. Analysis and review

### Deployment-selected Custom Libraries

**Model > Custom Libraries** shows explicitly selected packages, their catalogs,
metadata fields, declarative checks and help, plus any missing/rejected package
diagnostics. About and the status bar summarize the same set. No package is
selected automatically, and this is not an internal/public mode or access grant.
Current built-in content remains present in this checkpoint. See
[Custom Libraries](custom-libraries.md) for selection, portability and trust rules.

### Use the deterministic review loop

**Review > Analyze** runs local rules across the **whole document**, not only
the visible scenario. It propagates request data to targets and response data
to sources in every scenario, then opens Issues. Rules cover missing data,
retention information, authentication compatibility,
receiver data policy, deferred instance values, and production identity.
The ServiceTree required-value check is supplied only by the selected Custom
library; core does not require an Inventory ID.

Open a finding to locate its target, correct the model, and Analyze again.
Still-triggered findings keep their ID, status, replies and creation time.
Findings no longer triggered are removed, not archived, **only after their
rule completely evaluates the affected target**. Manual issues/comments are
untouched. Save a review snapshot if you need its history.

If a finding's rule or required policy definition is unavailable, Analyze
retains its original evidence, scenarios, guidance and review status, and
labels it **Not re-evaluated**. This includes missing/unspecified node policies
and unknown or unverified authentication semantics used for production-identity
checks. Display-only classification labels are not policy requirements:
explicit ID-based acceptance rules remain evaluable without a label library.
For partial coverage (for example, only one flow direction has a known receiving
policy), an existing finding is kept whole rather than narrowed. New definite
violations can still be reported, with the same incomplete-coverage warning.
Restore the required rules/definitions and Analyze again to refresh or clear
them. Removing the affected target still removes its findings.

The warning appears in both issue lists and review reports and survives native
Save/Open, Undo/Redo, autosave and standalone HTML. Search Issues for
`not re-evaluated` to locate retained findings. A legacy file without a warning
does not establish freshness or complete coverage. Unknown evaluation metadata
gets an explicit unrecognized-state warning rather than being treated as success.
Use matching current readers for collaboration: older builds can drop this
metadata or clear unavailable findings. Analysis does not execute rules from a
model, and this version keeps every existing installed rule enabled.

**Review > Issues** has All, Active, and Resolved views. Resolution records
a decision, not a fix or proof of complete evaluation. An evaluator failure
reports an error without changing the model, findings or Undo/Redo history.
Core issues have status, not severity; AI Analysis
suggests critical/high/medium/low findings for human assessment.

Authentication definitions carried by a model do not install a required
library. If their behavior conflicts with the installed contract, the original
metadata is retained with an unavailable warning rather than used to clear
findings. Review the versions in **Model > Customize authentication** and use
the explicit, undoable definition-adoption action when appropriate.

Use **Review > Comments** for scenario-scoped discussion and **Model > Work
Items** for follow-up descriptions/tracker links, not external tracker
synchronization.

Use **Review > Deviations** for evidence-backed exceptions found while
reconciling the model with deployed-service evidence. A deviation can
optionally point to a node or edge, but remains in the document if that target
is later removed. Stable keys let repeated evidence reviews update the same
record instead of creating duplicates. Every deviation requires an
explanation. In the UI, existing deviations are retained: you can revise their
explanation, but cannot delete them or change their Active or Resolved status.
Status changes made by evidence tooling or present in imported files remain
visible and do not alter the diagram topology. Network endpoint deviations can
include representative observed calls; choose **View sample calls** to review
their source, sanitized destination, and observed count.

### Compare models and assess the limits

**File > Compare to previous** (also under Review) loads a `.tma` or compatible
JSON baseline without replacing the working model. Open **Review > Changes**
to inspect differences; **No changes** is a valid result. Compare is a user
model feature, not a source-code regression check.

Unknown/Unspecified policy and unsupported metadata need review even without
a finding. Verify direction, order, boundaries, classification, and actual
configuration separately; Analyze does not inspect deployments or scan live CVEs.

Review AI evidence before **Create issue / Create work item**; severity does
not carry into ordinary issues. Persist decisions as issues/comments rather
than relying on transient chat.

Before sharing, confirm membership, auth/identity, directional data/retention,
boundary/lifecycle assumptions, and open actions. Analyze and save a named `.tma`.

## 6. Using sequence view

Sequence is another view of the same model, useful for walking a reviewer
through calls in order.

1. Select **Submit a support case** in the scenario selector and clear filters
   if you want the complete workflow. Choose **View > Sequence**.
2. Read participants across the top, in order of first appearance. Only nodes
   involved in visible flows appear. Read calls top to bottom: a solid arrow
   shows direction, sequence number, title, and auth.
3. Follow the dashed **return** arrows. For Support web > Support API >
   Case store, the view shows Submit case, Store case, the return from Case
   store, then the return to Support web. Returns are inferred from call
   order, not stored flows or observed timing.
4. Click a participant or call/return row to select its underlying node or
   edge. Use **View > Properties** to edit it; call/return rows select the
   same flow. Edit request/response attachments under **Privacy**.
5. To reorder, open **View > Edge list**. Use **Move up / Move down** or drag
   a row before/after another row. Double-click a row for Properties, where
   **Sequence # (in scenario)** also moves it. These operations renumber the
   active scenario sequentially; they do not change another scenario's order.
6. Return through **View > Diagram**. Both views share edits and ordering;
   no conversion is needed.

Response attachments describe the payload going back to the source. Adding
them does **not** create another call; dashed returns are inferred even
without response data. Self-calls use a curled arrow without a separate return
row. Multiple same-direction flows between the same pair remain distinct
ordered calls, not a claim that they execute concurrently.

You cannot drag participants or arrows to reorder in Sequence itself. Use the
Edge list or Sequence # field; layout/routing edits belong in Diagram.

## 7. Import and export

**Save a native `.tma` first.** External formats are interchange or review
outputs, not full-fidelity backups.

**File > Save** and **File > Save as > SecureDesignStudio model (.tma)** use
the browser save picker or fall back to a filename dialog/download. Open adopts
the filename for later suggestions. Save is not a background write.
**File > Open** replaces the document; **Compare to previous** does not.

Saved classifications, production-identity tenants, boundary subtypes, and
deviation kinds can reference definitions this build does not have. Valid
identifiers are retained and displayed as **(unresolved)** instead of being
silently replaced. This does not install a library or verify the definition.
See [unavailable catalog references](model-compatibility.md) for limits.
Models can also carry [saved catalog definitions](catalog-snapshots.md) so their
labels/descriptions remain available without installing a library. The saved
definition wins for that diagram; the disclosure below the command bar shows
its provenance and any difference from installed labels.

| Format | Direction and command | What to expect |
|---|---|---|
| Native `.tma` / compatible JSON | File > Open; Save / Save as | Editable document/view state; current version-2 and supported legacy wrappers or bare models. Not all browser preferences or the whole Authentication Library. |
| Threat Modeling Tool `.tm7` | File > Import; File > Save as | Import replaces the model. Export makes a drawing surface per scenario with generic nodes, flows, and security boundaries. Not full fidelity; see losses below. |
| Scenario/DFD JSON | File > Import > Import JSON format | Import only; requires the supported `scenarios` and `dfds` structure, not arbitrary JSON. Replaces the model; summary reports skipped annotations/edges and empty scenarios. No export to this format. |
| PMEXP inventory `.pmexp` | File > Import > PMEXP import | Import only; locally merges data/retention into mapped or created nodes. Requires scenarios. Unique saved inventory-ID matches import immediately; others need mapping. Unknown classifications become Other. |
| Endpoint `.txt` | File > Import > Endpoints text; Model > Endpoint matching | Import only; adds nodes for matched types missing from the document, in the active scenario. No call inference/service scan. Unmatched lines download as `_unknown.txt`. |
| Visio `.vsdx` | File > Save as > Microsoft Visio | Export only; one page per scenario, node/type/inventory labels, classification-labeled flows, and privacy boundaries. Security boundaries are omitted. No VSDX importer. |
| Diagram `.png` | Export > Diagram image | Export only; requires an active scenario and Diagram view. A picture, not an editable model. |
| Review report `.html` | Export > Review report | Export only; active-scenario report, optionally with a Diagram-view image. Not a runnable app or import format. |
| Standalone `.html` | File > Save as > Standalone HTML | Export only from a single-file build. App + native model; open in the browser, not File > Open. May have network features. |
| Node-catalog JSON | Model > Node Type Catalog > Import / Export | Moves document-local type definitions and referenced authentication dependencies, not the whole diagram. |
| Authentication-catalog JSON | Model > Customize authentication > Import / Export | Profile library with explicit import preview, not a diagram; saved conflicts remain. No repository JSON writes. |

### Supported scenario/DFD JSON import

**File > Import > Import JSON format...** converts a local `.json` file in the
supported scenario/DFD structure. JSON is an encoding, not one universal model
format: this command does not accept arbitrary JSON, native `.tma`/model JSON
or PMEXP inventory records. Use **File > Open** for native models and the
separate import commands for TM7 and PMEXP.

The source format originates from Threat Modeling Copilot (TMC) scenario/DFD
exports. The converter operates locally without sign-in, portal access,
acquisition tooling or a Custom Library. The rename preserves source field
names and stable identifiers; it does not define a new schema.

The top-level `scenarios` object must contain a `threatModel` object with a
`scenarios` array. The top-level `dfds` object must contain an `items` array.
Each scenario's string `id` is matched to `items[].diagram.id`, not to array
position. For example, using synthetic data only:

```json
{
  "scenarios": {
    "threatModel": {
      "scenarios": [{"id": "scenario-example", "name": "Example flow"}]
    }
  },
  "dfds": {
    "items": [{
      "diagram": {
        "id": "scenario-example",
        "nodes": [
          {"id": "node-client", "type": "externalinteractor", "label": "Client", "position": {"x": 100, "y": 100}},
          {"id": "node-api", "type": "process", "label": "API", "position": {"x": 400, "y": 100}}
        ],
        "edges": [
          {"id": "edge-request", "source": "node-client", "target": "node-api", "label": "1. Request"}
        ]
      }
    }]
  }
}
```

Supported source shapes include `process`, `datastore`, `externalinteractor`,
`boundary` and `freetext`. Nested boundary positions are relative to their
parent and are converted to absolute coordinates. Boundaries become security
boundaries; source shape categories do not assign policy-bearing node types.
Repeated source IDs retain stable model IDs, while distinct same-label nodes
stay distinct. Multi-numbered flow labels become separate ordered edges;
continuation lines become descriptions. This does not infer authentication
or data classifications from flow text.

The command confirms replacement when a diagram has content. Declining the
confirmation, cancelling the file picker, or rejecting an unsupported format
leaves it unchanged. A successful import is one undoable replacement.
The scenario/DFD JSON importer reports free-text annotations it does not yet map,
unresolved edges, scenarios without diagrams and unmatched diagrams.
Scenarios without diagrams remain empty; unmatched diagrams do not create
scenarios. Save a native `.tma` to preserve the converted model.

### PMEXP inventory import

**File > Import > PMEXP import...** reads a local `.pmexp` data-inventory file.
It does not connect to a portal, download an inventory, sign in, or query
services. No optional library is required. The format originates from Privacy
Manager; this command retains its existing source fields and parsing behavior,
not an arbitrary JSON importer. Native model JSON belongs under **File > Open**.

The file contains either an array of inventory records or an object with a
top-level `data` array. For example, using synthetic data only:

```json
{
  "data": [{
    "serviceId": "11111111-1111-4111-8111-111111111111",
    "serviceName": "Example service",
    "elementName": "Example record",
    "sampleData": "SYNTHETIC_ONLY",
    "dataClassification": "Customer Data",
    "dataRetainDuration": "7 days",
    "dataStoreBoundary": "Stored"
  }]
}
```

Records without a nonempty `serviceId` are ignored. Missing descriptive fields
retain the parser's existing defaults. Optional `storeDependency`,
`processDependency` and `downstreamDependency` fields retain the existing
service-reference expansion; they do not trigger remote lookups.

The importer compares each source `serviceId` with the saved node inventory
identifier (`serviceTreeId` in model JSON), ignoring surrounding whitespace
and letter case. A unique match merges automatically. Missing or duplicate
matches open **PMEXP import**, where each service can create a node, map to a
chosen existing node, or be ignored. Create all/Ignore all affect unmapped
services only; mapping to an existing node requires selecting it.

The import merges into every scenario, reuses matching name/classification
pairs, preserves nonempty samples and existing retention assignments, and
reports created/reused/skipped counts. Cancel leaves the model unchanged;
Undo reverses the whole import in one step. Original source-provenance
descriptions on created nodes remain unchanged for compatibility.

Endpoint import always includes generic local-file instructions. If the deployer
selected a library with endpoint guidance, the dialog also displays its
instructions/example and the contributing package's identity. Copying the
example does not run it. Without that library, Choose file and matching work
normally; the app does not discover telemetry services or prompt for sign-in.

TM7 export omits privacy boundaries, data/retention, much metadata, and
issues/threats. Auth labels/ID lines preserve this build's identifiers, not
definitions/behavior; custom methods reopen unresolved. TM7 imports leave node
policy types blank. Standard GE.A free text is preserved as canvas annotations.
Explicitly unattached connectors are omitted with an individual warning and
their nonempty labels preserved as annotations; nonzero broken references fail.
Line boundaries and unsupported properties remain disclosed losses.

### Canvas text annotations

Choose **Model > New text annotation**, or right-click the canvas and choose
**New text annotation**. These notes explain a drawing without creating a
process, data flow, data element, review comment or policy target. They have no
connection handles, sequence lifelines, authentication or data propagation.

Select a note (double-click to open Properties), enter complete plain text,
then choose **Apply text**. One Apply is one undoable edit; **Discard text
edits** restores the saved value. Drafts survive inspector tab switches; apply
before changing the selected note or closing its editor. Drag to move, use the
selected resize handles, or edit position/size in Properties. Keyboard users
can focus the note, press Enter to edit, or use arrows (Shift for larger steps)
to move. Delete removes the selected note; Ctrl+Z restores it.

Properties and the context menu manage scenario membership. Duplicating a
scenario shares the note; edits appear in every included scenario. Removing
membership retains the note in Show all. Deleting a scenario also deletes
notes used only by that scenario, while shared and already-detached notes stay.
Sequence view lists scenario notes separately from participants.

Native `.tma`, autosave, portable HTML and current collaboration peers preserve
text, placement, size and membership. Compare reports edits and navigates to
the note. Review HTML contains complete escaped text and geometry; PNG is a
visual rendering, not a backup. TM7 uses standard GE.A rectangles with the
[documented geometry mapping](tm7-compatibility.md#free-floating-text).
VSDX does **not** map these notes and warns before exporting.

Older application/CLI versions can discard optional annotation data or scenario
membership: do not edit these models with older clients. No compatibility
marker can retrofit protection into an old reader. Current CLI reads preserve
annotations on unrelated mutations but do not provide annotation authoring.
The current app treats New, Open and history restoration as complete document
state: replacing a model with a legacy or empty model removes its previous
annotations from the room. The compatibility adapter preserves absent annotation
fields for partial legacy callers, not for deliberate current-app replacement.
Ordinary Undo/Redo clears selection; reselect a note to reopen its saved text.
The browser text editor displays CR/CRLF as line breaks. Untouched/no-op edits
retain the exact source text; real edits retain a uniform source newline style.
Editing mixed newline styles uses the browser's LF representation.
Optional Assistant requests include notes only as untrusted authored context,
never instructions; creating/importing notes makes no model-service request.
Reassign types and review the summary and
[auth compatibility](authentication-library.md#stable-semantics-and-compatibility-limits).

After opening VSDX in Visio, use **Position > Auto Align & Space** as prompted.
New exports regenerate document properties instead of copying the template's
author/company/custom metadata or stale thumbnail. The template's required
BSD-3-Clause notice travels in the VSDX properties and is readable in the app
under **About > Visio template notice**. See
[third-party provenance](third-party-notices.md); that component notice is not
a license for the entire application.
Artifact retrieval from source systems has separate access requirements.
Local handlers do not upload files, but imported edits synchronize when in a room.

Keep versioned `.tma` and separate library JSON backups. Autosave can fail,
is profile/origin-specific, and does not update HTML on disk. Embedded HTML
models take precedence when reopened. See
[browser recovery](advanced-configuration.md#browser-recovery) before clearing storage.

## 8. Troubleshooting and quick reference

| Problem | Action |
|---|---|
| Port 5173 is occupied | The launcher reports the owning process and stops. Stop only your own server in its terminal; coordinate with other owners. Do not change ports or kill unknown processes. Inspect with `Get-NetTCPConnection -LocalPort 5173 -State Listen`. |
| Clone denied / Node version error | Obtain private GitHub access; Azure credentials are unrelated. The launcher checks Node, names the fix, and offers to install Node 24 LTS for you. |
| Script blocked by execution policy | PowerShell may refuse an unsigned local script. Run `Unblock-File .\Start-SecureDesignStudio.ps1`, or start it with `powershell -ExecutionPolicy Bypass -File .\Start-SecureDesignStudio.ps1`. |
| Design Assistant missing or failing | It is bring your own AI and needs your own configured Azure OpenAI deployment. Run `.\Start-SecureDesignStudio-WithAI.ps1 -VerifyEndpoint`, then see [bring your own AI](bring-your-own-ai.md). |
| Missing node, flow, or sequence participant | Check the active scenario, use Show all in Diagram if needed, and Filter > Clear all. Sequence requires a scenario and only shows nodes with visible flows. |
| Cannot create nodes or boundaries | Create/select a scenario first. Show all is not an authoring scenario. |
| Cannot attach a data item | Check its classification, request/response direction, and receiver policy. Do not weaken policy just to remove a warning. |
| Storage denied/full or recovery missing | Save `.tma`. Check profile/origin and storage permissions; back up before clearing site data. Working in memory does not guarantee refresh recovery. |
| Unknown/disabled auth or conflicting definitions | Preserve IDs; review Customize authentication warnings, import needed library JSON, and resolve explicitly. These warnings are independent of build-version compatibility. |
| Authentication compatibility information | In Model > Customize authentication, expand **Affected items** for methods, flows, and node-type policies across the whole diagram, including inactive/unassigned flows and unused saved policies. Counts are unique per category. Only a running app older than the required version (0.1.5 for new/custom IDs) gets a compatibility warning; a compatible build keeps the neutral inventory. Unknown versions are explicitly undetermined. This is not an authentication failure or older-peer detection. Keep an editable `.tma` backup. |
| Collaboration or Design Assistant unavailable locally | Expected with `.\Start-SecureDesignStudio.ps1`. Use `.\Start-SecureDesignStudio-WithAI.ps1` for the assistant. Do not add collaboration endpoint overrides; use approved optional modes only when needed. |
| Inspector hidden or stays on the wrong tab | View > Inspector reopens it; View > Properties selects details. Unpin if you want ordinary tabs to follow selection. |

**Essential shortcuts** (use Cmd instead of Ctrl on macOS):

| Action | Shortcut |
|---|---|
| New / Open / Save / Save as | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Document Undo / Redo outside text fields | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z |
| Toggle extra nodes/boundaries in selection | Ctrl+click |
| Delete selected objects globally, outside editable fields | Delete / Backspace; use Remove from scenario instead for membership-only changes |
| Diagram zoom out / in / reset / fit | `-` / `+` or `=` / `0` / `F`, with canvas focus and no Ctrl modifier |
| Finish / cancel inline node or edge title edit | Ctrl+Enter / Escape after double-clicking the title |
| Navigate menu items / inspector tabs | Arrow keys, Home, End; Enter activates a menu command, Escape closes the top temporary surface |

Bottom-left Diagram controls provide zoom/fit. Settings has theme and autosave
interval. See [model concepts](#1-what-securedesignstudio-is),
[Authentication Library](authentication-library.md), and
[cloud catalog](microsoft-cloud-node-catalog.md) for definitions.
