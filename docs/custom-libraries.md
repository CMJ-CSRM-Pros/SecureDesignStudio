# Custom Libraries

Custom Libraries are explicitly selected deployment packages, not
authentication providers or authorization grants. They add catalogs, metadata
fields, declarative checks and help through one documented interface.
**Model > Custom Libraries** lists loaded, rejected and unavailable packages,
identities, versions, contributions and provenance. About and the status bar
summarize the selected set.

The built-in catalog includes Microsoft and generic component types, boundary
types and reusable policy definitions. Optional libraries can add supported
catalog entries and metadata without changing the document format. Service
configuration is selected separately using `SDS_SERVICE_CONFIG` or explicit
endpoint environment settings; no service destinations are inferred. No
optional package is selected by default.

Libraries can declare compatible dependencies and explicit overrides for
existing definitions. Unresolved collisions reject the affected package rather
than choosing a winner based on discovery order. Existing saved definitions
remain authoritative, including when an optional library is unavailable.

## Select local packages

Each package directory contains one `library.json`. No files are discovered
automatically and no dependencies are downloaded. For example, in PowerShell:

```powershell
$env:SDS_LIBRARY_PATHS = '["examples\\custom-libraries\\example"]'
npm run dev
```

Use the same environment variable for `npm run build`. Remove it for an
unconfigured build:

```powershell
Remove-Item Env:SDS_LIBRARY_PATHS -ErrorAction SilentlyContinue
npm run build
```

The example is synthetic and selected only explicitly. Keep confidential
packages out of version control and deployment artifacts. Git ignore rules are
not sanitization: never distribute an artifact built with confidential packages
to an unauthorized audience.

Selection changes require a restart/rebuild. A browser cannot scan a sibling
folder; a built standalone file cannot discover packages added after the build.
No arbitrary JavaScript, TypeScript modules, `eval`, URL-installed
packages, custom React components or external assets are supported in v1.

## Delivery and failure behavior

- Vite resolves selected local files with bounded reads and embeds their data
  for local development. Local mode makes no library network requests and
  retains its existing collaboration/API guards.
- A configured multi-file production build emits a content-named JSON asset
  and a reference to it. Startup reads that same-origin deployment asset,
  without credentials or redirects, before profile/model/autosave restoration.
  Missing JSON, HTML SPA fallbacks, corrupt data, oversized responses and
  timeouts produce visible nonblocking diagnostics. No configuration means
  no manifest request.
- A single-file build embeds the selected data. It does not fetch adjacent
  files. Standalone export preserves that same deployment-selected set.
- Invalid packages register nothing. Missing, invalid or version-mismatched
  dependencies reject dependent packages. Unrelated valid packages can load.
  The core remains usable. No sign-in, AI or collaboration action is initiated.

Limits: 16 packages, 1 MiB per package, 4 MiB per set, two seconds for a local
read or hosted startup fetch; up to 2,000 catalog records and 100 fields, rules
or help records per package. Text and IDs have additional schema bounds.
Links must be absolute HTTP(S) URLs without embedded credentials.

## Package contract, API 1

See [`examples/custom-libraries/example/library.json`](../examples/custom-libraries/example/library.json)
for a complete package and `src/libraries/contracts.ts` for the typed shape.
The root fields are `format: "secure-design-studio-library"`, `apiVersion: 1`,
`id`, `name`, numeric `version`, `dependencies`, `overrides`, `catalogs`,
`fields`, `rules` and `help`. Unknown fields reject the package.

| Contribution | Contract |
|---|---|
| `catalogs.authentication` | Existing strict authentication definitions, including optional `aiDesignGuidance` (same shape and limits as node guidance). Protected built-in behavior/aliases remain protected. New methods remain unverified; prose does not establish security semantics. |
| `catalogs.classifications` | One complete validated Classification Library, with enabled default and existing presentation/guidance rules. Overrides `classifications/default` explicitly; never silently replaces a stored profile list. |
| `catalogs.nodes` | Stable bounded node ID (including existing spaces/parentheses), label and explicit node definition: auth/data policy, optional current geo/retention/GDPR metadata, endpoint hints, description, optional `aiDesignGuidance` and existing bundled icon references. Optional `defaultDfdRole` is exactly `Process`, `DataStore`, or `ExternalInteractor`; an unknown package role rejects the package. Curated data policy requires one wildcard fallback. |
| `catalogs.taxonomy` | Existing portable tenant, privacy/security boundary and deviation definitions. Classification entries use the dedicated Classification Library instead. |
| `fields` | Stable ID, node/edge target, label/description and storage binding. The inventory (`serviceTreeId`) binding additionally supports `validation: "guid"`; other metadata uses declarative validation rules. Generic values use `metadata`; node fields may bind existing `serviceTreeId` or `endpointRegex`. Core `serviceTreeId` is labeled Inventory ID and permits ordinary text; bindings cannot be changed by an overlay. |
| `rules` | Stable finding ID, target, `fieldId`, `check: "required"` or `"guid"`, title/description and optional guidance. GUID checks allow blank values; combine with a required check when blank must also be flagged. No arbitrary expressions or scripts. |
| `help` | Stable ID, title, plain text and optional safe URL. Help is readable in Custom Libraries; designated slots also appear in their relevant dialogs. |

Dependencies use exact `{ id, version }` pairs. IDs and contribution keys are
checked case-insensitively for collisions. Duplicate package IDs and unordered
collisions reject every contender rather than choosing by discovery order.
An overlay declares `{ key, from }`; keys include `authentication/<id>`,
`classifications/default`, `nodes/<id>`, `taxonomy/<kind>/<id>`, `fields/<id>`,
`rules/<id>` and `help/<id>`. The previous owner must match. Non-core overlays
also declare that exact owner/version as a dependency. Cycles are rejected.
Core analyzer rules cannot be replaced by this checkpoint.

The five new security-boundary IDs are exactly `VNet`, `Subnet`, `Container`,
`Process`, and `Machine`. A package contribution using any of these IDs,
including a case variant, requires an explicit core override, for example
`{ "key": "taxonomy/securityBoundary/VNet", "from": "core" }`. Keep persisted
IDs stable rather than renaming saved references to evade a collision. Boundary
subtypes describe intended separation, not verified isolation; `Process` here
is not a node DFD role.

## Endpoint-import help slots

The generic endpoint text importer is always available for an active scenario.
Two independently optional help IDs extend its dialog:

- `endpoint-import.instructions`: additional plain-text preparation guidance.
- `endpoint-import.example`: a read-only example with a Copy to clipboard action.

Each displays the effective loaded package's name, ID and version. An explicit
overlay changes that provenance to the effective contributor. Missing, rejected
or unselected packages provide no fallback organization-specific content.
Generic instructions and Choose file remain usable. The dialog never executes
the example, queries telemetry, signs in or contacts imported endpoint URLs.
Clipboard denial selects the text and explains how to copy it manually.

The synthetic example demonstrates these slots without organization-specific
content. Public setup and tests must remain self-contained; an unconfigured
build must not include organization-specific queries or confidential package
content.

## Review guidance

`analysis.deprecated-auth-guidance` optionally supplies a safe URL for findings
about methods explicitly marked Deprecated by a target node policy. It is help,
not rule or policy authority: the same finding is produced without it, with no
library-specific link. Pure "not accepted" findings do not use this slot.
Only startup-selected library help is used; a model cannot install guidance.

Supplemental retention instructions may use `retention.guidance`, readable
under **Model > Custom Libraries**. Core retains the same three retention IDs,
labels and behavior; its descriptions do not assert a universal legal deadline.
Existing saved links are retained on import. A successful Analyze refreshes
rule-driven links as before; unavailable rules/policies retain their saved
evidence. This is not automatic sanitization of imported models.

## Saved models and profiles
Profile choices win over deployment defaults. Loading a package does not
overwrite browser storage. Classification replacement still uses its existing
explicit preview; authentication edits keep protected definitions and stale-tab
checks. Profile updates and their Undo/Redo remain coherent.

Authentication retains its existing shipped-default merge: newly installed
methods can become choices, but stored same-ID presentation and disabled flags
win. Disable a deployment-provided method for this profile instead of deleting
it (which would otherwise reappear on reload). Classification profile lists
remain authoritative replacements, not unions with deployment defaults.

Referenced package node policies, authentication definitions, taxonomy labels
and metadata-field descriptions are captured as document dependencies. Unused
package catalogs, rules, help and deployment settings are not copied into a
model. Saved definitions govern that model; merely opening or selecting it
must not replace them with a same-ID installed definition. An ID-only reference
without an available definition remains ID-only: normalization does not invent
an empty saved override that would block resolution when its library returns.
An explicitly saved Unspecified definition still wins. Saved definitions also
win when `aiDesignGuidance` is absent: clearing guidance does not reactivate an
installed same-ID field.
For taxonomy, portable meaning is keyed by `(kind, id)` and carries `label`,
optional `description`, and optional library ID/version, not arbitrary
executable metadata. A saved snapshot wins even when its library is absent
or a same-ID installed label/description differs; **Saved catalog definitions**
distinguishes that conflict from a document-only definition. Without a
snapshot, an available same-ID definition can be captured as local fallback.
That fallback cannot reconstruct the original author's missing meaning.
Saved `defaultDfdRole` definitions likewise win over installed defaults.
New/adopted nodes capture a known role default, including public catalog
defaults. Old nodes lacking role evidence get `dfdRoleLegacy: true` before
catalog hydration; only an explicit **Use type default** action removes that
legacy pin. `dfdRoleOverride` wins independently of the service type and is
never erased by type changes. Unknown saved role tokens remain unresolved
evidence, not authority to treat a node as external.

Public node definitions materialize an absent `resourceProviders` list as
`[]` before entering the registry or being captured into a document. Native
Open uses the same representation, so saving and reopening a newly captured
public definition does not add an empty array or change a full-model diff.
Explicit provider values, policies and other optional metadata are retained.

`Scenario.nodeScopeReasons[nodeId]` holds per-scenario scope text. An effective
out-of-scope reason requires a nonblank string and a resolved Process/DataStore
role. Invalid values are retained as `{ invalid, truncated? }` recovery records
(role evidence capped at 128 characters; reason evidence at 16000).
Malformed whole maps use `nodeScopeReasonsRecovery`. Those records are inert
and diagnosed rather than coerced into exclusion. Real nonmember reasons stay
dormant; orphan-node entries are removed. No document or storage namespace
version changes are needed for these optional fields.
Properties shows an unavailable-definition notice for an unresolved node type;
viewing that notice does not create a replacement definition.

Node properties always display the stored instance identity/endpoint values.
Opening or selecting a node, or recommitting its current type, does not rewrite
them. **Use type metadata** is an explicit confirmed, undoable application of
supplied defaults. Changing to a different type can apply its valid supplied
defaults; blank identities and an Unspecified `^$` placeholder do not erase
retained values. Invalid type defaults are diagnosed and not partially applied.
Endpoint matching uses the effective installed-and-saved catalog, so a package
type need not already occur in the document before it can be matched.

The public label **Inventory ID** is a presentation change, not a document
migration: native files retain `serviceTreeId`. Ordinary identifiers such as
`ASSET-123` are accepted in node instances and document-local type definitions.
A selected field override can supply a more specific label and validation;
missing-library historical values stay editable under the generic field.
Reports, comparisons and visual exports use the selected label. TM7 imports
accept both the new Inventory ID label and historical `ST:` labels.

Node-package icons reference `src/data/nodeIconKeys.json`, the allowlist of
already bundled SVGs. Update it when changing the bundled icon collection;
the registry test requires exact agreement with the asset directory. This
does not authorize redistributing an asset or loading an external image.

Node/edge metadata values and field descriptions survive native files, autosave,
Undo/Redo, standalone HTML and existing entity-level Yjs synchronization.
They are shown in Properties and HTML review reports, and changes are included
in Compare to previous. Unknown bounded metadata remains editable with an
unresolved label. Malformed metadata rejects an import; corrupt recovery is
paused without overwriting the stored backup.

An unconfigured build is not a model-sanitization mode. Opened models and their
exports can still contain saved custom definitions, labels and identity
evidence. Review that content separately before sharing it.

Saved field descriptions do not install rules. Without a package, its previous
findings remain **Not re-evaluated**; restoring an evaluable rule refreshes or
clears its findings while retaining review status/discussion. Use matching
current readers for collaboration: older applications are not guaranteed to
preserve this optional metadata. TM7/VSDX and other external formats do not
promise to preserve generic custom metadata.

Saved taxonomy definitions are not installed choices. Boundary subtypes,
node-type default privacy boundaries and new deviation kinds are offered only
from the available catalog. Existing unavailable selections remain visible with
their saved labels (or unresolved IDs), and unrelated edits preserve them.
Switching to an available choice or clearing a subtype is explicit and undoable.
Reports and visual exports resolve saved definitions first and capture
referenced available definitions, not entire optional catalogs.

## AI design guidance

Node, communication-protocol and authentication definitions may each include
an optional `aiDesignGuidance` object. The authentication-specific workflow,
precedence and portability rules are in the
[Authentication Library contract](authentication-library.md#ai-design-guidance);
the shared object, limits and size budget below apply to all three kinds.
Node definitions may include this optional object (synthetic example):

```json
{
  "aiDesignGuidance": {
    "content": "If ingress is public, ask the owner about authentication and the intended trust boundary.\nVerify deployment controls separately.",
    "sources": ["https://example.invalid/design-reference"],
    "revision": 1,
    "updatedOn": "2026-10-08"
  }
}
```

`content` is one nonblank multiline string, at most 8,000 JavaScript string
characters; disallowed control characters are rejected. `sources` is optional:
at most 16 absolute HTTP(S) URLs, each at most 2,048 characters, without
credentials or whitespace. URLs are citations, not auto-fetched instructions.
`revision` is a positive safe integer. `updatedOn` is a real calendar date in
`YYYY-MM-DD` form, recording editing, not an independent review.
Unknown fields, `null`, invalid dates/revisions/URLs and oversized content reject
the new metadata before document or catalog mutation. Missing legacy metadata
remains absent; ordinary descriptions are never migrated. Malformed
autosave/embedded/history guidance pauses recovery without overwriting stored
data. Current peers synchronize the guidance object atomically inside the
existing node definition.

The catalog editor and expandable node Properties editor save diagram-local
type definitions. Guidance-only edits preserve all other definition fields,
instance metadata, policies, geometry and scenarios. Cancel and unchanged Save
do not create history. Clear retains the definition, so installed guidance
cannot silently return. A saved definition is authoritative in both AI
experiences even if an available library has a newer revision.

Both consumers use the same effective-guidance resolver and send exact type
IDs, content, revision, edit date, source URLs and saved/available/core origin.
Design Assistant sends guidance only for included interiors in the selected
scenario, with explicit node bindings; endpoint-only nodes supply crossing
identity, never permission to review their interiors. Threat Model Designer
also includes complete guidance for available proposed type choices, once per
type; it does not copy every unused definition into the saved document.
It marks existing nodes as interior/endpoint-only and omits endpoint interior
descriptions. Neither path changes fixed checks or resolves findings.

Serialized guidance has a 384,000-byte UTF-8 aggregate limit; the entire AI
request, including context, question and conversation, has a 500,000-byte
limit. Oversized requests fail visibly, never silently truncate/drop guidance
or contact AI. A synthetic 177-type catalog with approximately 1,600-character
guidance on every type is covered by tests and fits both contexts. The 8,000
per-entry limit is not a promise that 177 maximum-length records fit one
request. Shorten overly verbose guidance or reduce the selected library/model
scope before retrying; no retrieval backend or unbounded multi-stage protocol
is added.

**Authentication guidance** in a package's `catalogs.authentication` uses the
same object. A contributed card is an available definition: it is shown for a
method until the diagram has a saved definition, which then wins as a whole (a
saved definition without guidance means no guidance; it does not fall back to
the package). Package authors may supply guidance for new methods and for
existing shipped IDs, but protected IDs, aliases, legacy status and behavior
stay protected, and a card never makes a method available, verified or
accepted by a target. Cards are not copied into a diagram unless the method is
referenced or edited there. Contributed cards are public reference text you
provide; do not place secrets, tenant-specific data or unreleased details in
them. Design Assistant sends cards only for methods in use on reviewed flows;
Threat Model Designer sends cards for every selectable method when the complete
request fits in one call, otherwise the in-use and planner-selected cards. Node, protocol and
authentication cards share the one 384,000-byte guidance budget; an
authentication card adds to it rather than receiving a separate allowance, and
the 500,000-byte request limit still applies. When selected cards do not fit,
the design call is not sent and a smaller scope is requested; mandatory in-use
cards that cannot fit stop the request before any provider call. Nothing is
truncated, automatically batched or partially applied. Source URLs are never
fetched, and live model behavior is not validated by these contracts.

Trusted application/API instructions treat all guidance as untrusted reference
data, never control evidence, risk acceptance, permission for actions, or
dependency-creation commands. Accepted issue/work-item descriptions retain
relevant request-time type/revision/source references marked **unverified
reference context**, not model-invented citations or claims that the AI used
every supplied source. No assessment/checklist model or analyzer policy is
introduced. Native `.tma`, autosave, catalog JSON, standalone HTML and compatible
current peers preserve the optional field; older writers and lossy external
formats may not. Preserve a native backup before using those readers.

## Validation

Companion integrations can use the same library contract; they are not needed
to build or test the browser application. Their maintainers own startup
selection, validation and parity checks. Packages never supply executable
modules. Browser preferences, URL fragments and room metadata cannot activate
a package.

Run the normal build and browser union without a configured package to verify
the unchanged baseline. `npm run test:runtime` includes registry,
dependency, collision, bounded-read, profile, rule and persistence contracts.
`npm run test:libraries:browser` separately selects the synthetic package plus
a missing directory using the existing isolated strict-port harness. Do not
run browser suites concurrently or against a personal browser profile.

After a build explicitly selecting only the synthetic example, run
`npm run test:libraries:production` for configured hosted/standalone behavior.
Rebuild with no selection before handing off an unconfigured artifact.

An internal companion repository may have additional tests for its actual
optional packages. Those are not public runtime dependencies. The shared suite
uses synthetic historical fixtures rather than requiring a private directory.
