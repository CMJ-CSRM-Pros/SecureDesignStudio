# Custom Libraries

Custom Libraries are explicitly selected deployment packages, not an
internal/public mode, employee check, authentication provider or authorization
grant. They add catalogs, metadata fields, declarative checks and help through
one documented interface. **Model > Custom Libraries** lists loaded, rejected
and unavailable packages, identities, versions, contributions and provenance.
About and the status bar summarize the selected set.

Core defaults exclude four owner-specific authentication methods, two tenant
choices and all 13 former curated node definitions. The 164 public-cloud
entries remain. Inventory ID is an optional text field in core; a selected
library can supply its ServiceTree label, GUID validation and required-value
rule. The two compliance perimeters, four organization-specific deployment
boundaries and ESTS evidence label also require an available library for new
selections. Core retains Geo boundary, IFrame, CSP, Azure, User browser and
User Tenant Trust. Both core-only and companion-library configurations inherit
the same twelve Purview-aligned/supplemental classification definitions.
Private guidance stays in optional help rather than duplicating the common
dictionary. Service configuration is selected separately using `SDS_SERVICE_CONFIG`
or explicit endpoint environment settings; no service destinations are inferred.
This is not public-release certification.
The default selection is empty even if an `internal` directory exists.

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

The example is synthetic and selected only explicitly. Keep private packages
under the ignored `internal\` overlay in an authorized workspace, not in public
source or artifacts. Gitignore is not sanitization: never ship an artifact
that was built with confidential packages to an unauthorized audience.

Selection changes require a restart/rebuild. A browser cannot scan a sibling
folder; a built standalone file cannot discover a later-added `internal`
directory. No arbitrary JavaScript, TypeScript modules, `eval`, URL-installed
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
| `catalogs.authentication` | Existing strict authentication definitions. Protected built-in behavior/aliases remain protected. New methods remain unverified; prose does not establish security semantics. |
| `catalogs.classifications` | One complete validated Classification Library, with enabled default and existing presentation/guidance rules. Overrides `classifications/default` explicitly; never silently replaces a stored profile list. |
| `catalogs.nodes` | Stable bounded node ID (including existing spaces/parentheses), label and explicit node definition: auth/data policy, optional current geo/retention/GDPR metadata, endpoint hints, description and existing bundled icon references. Curated data policy requires one wildcard fallback. |
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

The synthetic example demonstrates these slots without private content. The
current internal companion repository tracks its real pilot package through
narrow `internal\custom` ignore exceptions for its manifest, README and companion-only test; that directory and those
exceptions must be excluded from the reviewed public source import. Public
setup and tests must not depend on that package. An unconfigured build must
contain no pilot query even when the private directory is present.

## Review guidance

`analysis.deprecated-auth-guidance` optionally supplies a safe URL for findings
about methods explicitly marked Deprecated by a target node policy. It is help,
not rule or policy authority: the same finding is produced without it, with no
organization-specific link. Pure "not accepted" findings do not use this slot.
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
An explicitly saved Unspecified definition still wins.
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
A selected field override can label it ServiceTreeId and validate GUIDs;
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
exports can still contain saved organization-specific definitions, labels and
identity evidence. Review that content separately before sharing it.

Saved field descriptions do not install rules. Without a package, its previous
findings remain **Not re-evaluated**; restoring an evaluable rule refreshes or
clears its findings while retaining review status/discussion. Use matching
current readers for collaboration: older applications and older CLI writers
are not guaranteed to preserve this optional metadata. TM7/VSDX and other
external formats do not promise to preserve generic custom metadata.

Saved taxonomy definitions are not installed choices. Boundary subtypes,
node-type default privacy boundaries and new deviation kinds are offered only
from the available catalog. Existing unavailable selections remain visible with
their saved labels (or unresolved IDs), and unrelated edits preserve them.
Switching to an available choice or clearing a subtype is explicit and undoable.
The CLI applies the same availability check to new/changed selections while
retaining old values through unrelated updates. Reports and visual exports
resolve saved definitions first and capture referenced available definitions,
not entire optional catalogs.

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
