# Authentication Library

*Updated: 2026-09-15 - Linked the canonical user journey and retained compatibility detail.*

The library describes **authentication on flows between modeled services**.
It neither signs users into SecureDesignStudio nor stores real keys, tokens,
passwords or certificates. Its entry point is **Model > Customize authentication**.
For a first model, start with the [user guide](user-guide.md#3-simple-how-to).
This reference defines library behavior, portable JSON, and compatibility.

## One library, two fields

The ordinary editor exposes **Method** (display name) and **Description**
(plain-language explanation). Search, add, edit, disable, safe delete,
built-in presentation reset, import and export are available in one dialog.
The flow inspector shows the selected Description without requiring hover.
Node-type authentication policies use the same available methods.

The library is React store state persisted at
`secure-design-studio:authentication-library:v1` in browser localStorage,
per profile and application origin. It survives reload and New/Open. It is
not a hosted registry; separate origins, profiles and standalone file origins
have separate browser storage. Export/import is the portable workflow.
Opening a diagram never silently replaces this library.
Authentication is independent of the communication protocol: absent, unresolved
or disabled protocol profiles do not hide or clear an existing method. Supported
legacy authentication IDs and labels remain visible, with review diagnostics
when their definitions are unavailable. A saved null protocol is unspecified.
AI design responses require an explicit authentication selection (or null when
unknown). On an existing unchanged route, null or an omitted legacy field
preserves authentication; changing only protocol never clears it. New or
redirected flows with null remain unspecified, not anonymous. HTTPS alone does
not establish a caller authentication mechanism.
An already-open tab reloads to pick up another tab's library edits. A stale
tab cannot overwrite newer preferences through a library edit or Undo/Redo;
it reports the conflict and asks for a reload.

[`src/data/authTypes.json`](../src/data/authTypes.json) remains the maintainable
shipped defaults. Source edits require rebuilding. The browser downloads
`secure-design-studio-authentication-catalog.json`; it cannot overwrite that
repository file. Imported descriptions are text, not executable HTML.

## Catalog file contract

The JSON wrapper has `format`, `version` and `methods` only:

```json
{
  "format": "secure-design-studio-authentication-catalog",
  "version": 1,
  "methods": [
    {
      "id": "auth_partner_contract",
      "label": "Partner assertion",
      "description": "Uses the assertion format and receiver validation documented in the partner contract."
    }
  ]
}
```

An imported file merges into the library. New IDs are added; matching IDs are
replaced only after the import preview is explicitly applied. Entries not in
the file remain. Invalid imports are rejected in full with a diagnostic; no
partial list, library state or document mutation is committed.

| Field | Contract |
|---|---|
| `id` | Immutable reference identity. 1-128 characters; starts with a letter, then letters, digits, `.`, `_` or `-`. Reserved object/prototype names and case-insensitive duplicate IDs are rejected. The editor generates an ID internally. |
| `label` | Method; nonblank text up to 80 characters. Names/aliases/IDs must not ambiguously identify different entries, including reserved shipped names. |
| `description` | Nonblank text up to 4,000 characters. No semantics are inferred from it. |
| `shortLabel` | Optional internal canvas label, at most 24 characters. Defaults to the first 20 Method characters; ordinary Method edits regenerate it. |
| `disabled` | Optional boolean, default false. Disables new selection, not existing references. |
| `behavior` | Optional explicit modeling-field metadata, below. Built-in behavior cannot be changed. |
| `legacy` | Reserved shipped compatibility status. Cannot be set on custom entries or changed on built-ins. |
| `aliases` | Reserved shipped legacy label mappings. Cannot be set on custom entries or changed on built-ins. |

The runtime validator is
[`validateAuthenticationDefinitions`](../src/authentication.ts). Unsupported
fields, malformed types, duplicate or ambiguous IDs/names, protected metadata
changes and over 2,000 entries are rejected. Exported files include normalized
internal metadata; edit only Method/Description unless deliberately defining a
custom modeling contract.

When `behavior` is supplied, all its fields are required:

```json
{
  "productionIdentity": "unknown",
  "audience": false,
  "constraints": false,
  "anonymous": false,
  "managedIdentity": false
}
```

`productionIdentity` accepts `required`, `optional` or `unknown`. The other
fields are booleans: show Audience, show Constraints, mark absence of
authentication proof on the canvas, and require the existing Managed Identity
production-identity kind, respectively. `managedIdentity: true` also requires
`productionIdentity: "required"`. Omitted custom metadata defaults to the
unknown example. Omitted built-in metadata uses the protected shipped values.
Custom entries remain **unverified even with explicit metadata**; these flags
are modeling requirements, not executable validation, a claim of security,
issuer verification, provider approval or target acceptance.

## Precedence and portability

Flows and node-policy rules retain stable IDs. The additive
`PsDocument.authenticationDefinitions` array stores compatibility definitions
inside `.tma`, autosave, exported standalone HTML and collaborative documents.
It is not a user-managed per-diagram library or a scope selector.

Resolution is deterministic:

1. A saved diagram definition retains its display and explicit metadata.
   It does not install a library or authorize a conflicting behavior contract.
2. An installed ID without a saved override uses the active library's
   presentation, with protected supplied behavior.
3. An unknown custom reference without a saved definition is **unresolved**,
   even if the same ID happens to exist in the local library. The ID, legacy
   array and identity evidence are retained; a definition is not guessed.

The UI reports same-ID/different-definition collisions and missing dependencies.
These remain **Diagram authentication warnings**, independent of the running
application version, with explicit definition-review controls.
Importing a library does not overwrite conflicting saved definitions. Review
the local and saved versions, then explicitly use the library definition in
the current diagram when appropriate. This operation does not rewrite other
files or change the local library. Definitions imported with diagrams do not
automatically become reusable library entries.

### Core defaults and optional definitions

Core supplies **14 definitions** (13 modern choices and the legacy certificate)
and **Customer/Other** tenant choices. A selected library can contribute
additional definitions and tenant choices without changing core defaults.

Installed availability is passed explicitly by the runtime, separately from
profile preferences and saved diagram definitions. Cached preferences and
saved snapshots cannot make an unavailable library definition available for
new selections. A saved contract that differs from the installed behavior is
retained for review, not silently rewritten or trusted for analysis. The flow
remains readable, but its method is unavailable for new calls until the
definition is available and explicitly reconciled.

Portable diagram validation and authoring validation are distinct.
`validatePortableAuthenticationDefinitions` preserves structurally valid
historical snapshots, including conflicting behavior evidence. Schema checks,
reserved IDs/names and compatibility-alias ownership remain enforced. Library
imports and profile writes retain strict contract checks. Compatibility aliases
are import mappings only; they do not confer installed authority.

Unavailable/conflicting contracts use unknown effective behavior and cannot
create new identity requirements. Historical findings about the retired
Production identity field remain visible as retired evidence with their status
and discussion intact. The current edge editor has one standalone caller
Application ID field, required only by authentication methods whose installed
contract requires it; Managed Identity does not require a redundant caller ID.
Legacy Production identity and tenant data remain read-only evidence and are
never copied into the active caller ID. Conflicts between that evidence and
the current method are reported without rewriting either value.

`unavailableReason` remains a runtime-only catalog diagnostic, never a saved
definition or synchronized installation state. Explicit definition adoption
remains a diagram-only, undoable operation. Historical tenant values remain
available for import and display; they do not automatically become writable
choices in the edge editor.

A normal library edit updates a referenced definition in the current diagram
only when it matched the previous library definition; saved conflicts remain
untouched. Library transactions and matching current-diagram changes share one
Undo/Redo step. Optional library-history snapshots are local autosave metadata,
outside `PsDocument`, exported `.tma`, and Yjs. Storage failures are visible and
do not commit a success-shaped library edit.

Disabling preserves IDs and descriptions. Existing disabled/legacy selections
stay visible; new selections are gated. Built-ins cannot be deleted. Custom
deletion is blocked by current flow/node-policy and undo/redo references;
disable is safer when other saved files may use an entry. Other files are
never inspected or rewritten; their saved definitions remain portable.

Node-catalog exports include referenced authentication definitions. Complete
saved definitions remain portable even when their owning library is unavailable;
runtime diagnostics are never serialized into them. A dependency with no saved
or available definition blocks export rather than silently stripping its rules.
Importing these dependencies does not install a library or enable new choices.
Wildcard policies expand over the same method library;
exact Allowed/Deprecated rules take precedence over the wildcard. Unknown or
uncurated node policies are not proof of acceptance.

## Stable semantics and compatibility limits

Historical IDs remain stable. Legacy multiple-auth arrays remain until an
explicit single selection replaces them.
**Not specified** remains empty and is not Custom method.

An internal process call is distinct from anonymous access across a boundary.
Existing identity evidence is retained on imports and method changes; it is not
silently promoted into an active caller identity. Definitions and labels do not
establish protocol behavior or target-node acceptance.

| Surface | Support and loss boundary |
|---|---|
| `.tma`, autosave, embedded standalone HTML | Stable IDs and saved definitions retained. Document/wrapper versions remain 1/2; `.tma` is unchanged. Embedded model takes precedence over autosave. |
| Browser collaboration | Saved definitions synchronize; local library preferences do not. Test with synthetic peers; this is not live-service validation. |
| Older readers / mixed-version rooms | Builds older than a referenced method's compatibility floor may discard its ID or definition. Do not use them to edit these models or join their rooms. New-reader/old-file compatibility does not imply old-reader/new-file safety; older peers cannot be reliably detected or prevented. |
| TM7 | Human-readable auth names and an `Auth IDs` label line preserve identifiers emitted by this build. Legacy shipped labels are accepted. Definitions/behavior are not a native TM7 concept and are not restored; custom IDs reopen unresolved and need explicit resolution. |
| Scenario/DFD JSON, PMEXP, endpoint imports | These formats do not supply this Authentication Library schema. Do not infer authentication semantics from unrelated text. |
| VSDX / PNG / review HTML | Review/visual exports, not lossless editable library backups. Review HTML uses resolved display labels; retain `.tma` and catalog JSON for editing. |

### Compatibility notice and affected items

**Model > Customize authentication** separates file compatibility from
definition warnings. Referenced authentication IDs outside the historical
11 require application version **0.1.5** or later, except
`InternalProcessCall`, which requires **0.1.11** or later. The dialog uses the
highest minimum required by the referenced methods and compares it with the
actual running build's application SemVer, not document
version 1, wrapper version 2, or an inferred creator/collaborator version.
Only an older running build shows **Compatibility warning: requires
SecureDesignStudio [minimum version] or later**. Equal or newer builds instead show neutral
**Authentication compatibility** information; an unavailable or invalid
version shows **Compatibility not determined**, not a claim of compatibility.
This logic cannot retrofit older published bundles or detect older peers.

**Affected items** remains available on compatible builds. It groups
referenced methods by resolved name and stable ID, with flow titles,
source/target service labels, scenario context, and explicit node-type
`allowedAuthMethods` policies (Allowed/Deprecated). Blank names or missing
objects fall back to their IDs. Saved definitions take precedence; an
unresolved method is not silently named from a local custom definition.

Counts are unique authentication methods, flows, and node-type policies
(one policy per node type). A flow or policy referencing multiple affected
methods appears under each, but is counted once in the total. The read-only
inventory covers the whole diagram, including inactive scenarios, unassigned
flows, and saved policies with no current nodes. Policy-only references are
identified. Wildcard-only rules and unused library methods do not add items.
Edits, removal, and explicit definition resolution refresh the inventory;
it is not persisted in `.tma` or collaboration state.

Compatibility information is not an authentication failure, a security
assessment, or evidence that every definition is resolved. Use a compatible
build when editing or collaborating, and save an editable backup as `.tma`.

## Validation

`npm run test:runtime` exercises the strict catalog, current-source
normalization/policy/analyzer/diff and synthetic browser-model Yjs contracts.
`npm run test:authentication` runs this shared runtime suite.
Use Node 24 LTS for its current-TypeScript source loader.
`npm run test:browser` includes flow/library authoring and keyboard/focus
contracts plus local synthetic browser Yjs peers in the existing isolated
browser harness. No live rooms are joined. See the
[browser coverage and evidence guide](../tests/browser/README.md).
Automated checks are not human-usability research or live collaboration testing.
