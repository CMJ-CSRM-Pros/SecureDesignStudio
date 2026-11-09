# Authentication Library

*Updated: 2026-10-31 - Added optional AI design guidance to authentication definitions.*

The library describes **authentication on flows between modeled services**.
It neither signs users into SecureDesignStudio nor stores real keys, tokens,
passwords or certificates. Its entry point is **Model > Customize authentication**.
For a first model, start with the [user guide](user-guide.md#3-simple-how-to).
This reference defines library behavior, portable JSON, and compatibility.

## One library, three editable fields

The ordinary editor exposes **Method** (display name), **Description**
(plain-language explanation) and optional **AI design guidance** (reference
text for the AI features; see [AI design guidance](#ai-design-guidance)).
Search, add, edit, disable, safe delete,
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

The JSON wrapper has `format`, `version` and `methods` only. The synthetic
example's `aiDesignGuidance` object is optional; omit it for a method without
guidance:

```json
{
  "format": "secure-design-studio-authentication-catalog",
  "version": 1,
  "methods": [
    {
      "id": "auth_partner_contract",
      "label": "Partner assertion",
      "description": "Uses the assertion format and receiver validation documented in the partner contract.",
      "aiDesignGuidance": {
        "content": "Ask which party issues the assertion and which receiver validates it.\nRequest the partner contract; do not assume token lifetime or audience rules.",
        "sources": ["https://example.invalid/partner-contract"],
        "revision": 1,
        "updatedOn": "2026-10-31"
      }
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
| `aiDesignGuidance` | Optional reference card, below. Absent means no guidance. `null`, unknown inner fields and malformed values reject the definition or import. Separate from `description`, `behavior` and protected identity. |
| `behavior` | Optional explicit modeling-field metadata, below. Built-in behavior cannot be changed. |
| `legacy` | Reserved shipped compatibility status. Cannot be set on custom entries or changed on built-ins. |
| `aliases` | Reserved shipped legacy label mappings. Cannot be set on custom entries or changed on built-ins. |

The runtime validator is
[`validateAuthenticationDefinitions`](../src/authentication.ts). Unsupported
fields, malformed types, duplicate or ambiguous IDs/names, protected metadata
changes and over 2,000 entries are rejected. Exported files include normalized
internal metadata; edit only Method, Description and AI design guidance unless
deliberately defining a custom modeling contract. The protected-metadata
rejection message names these three editable fields.

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

## AI design guidance

`aiDesignGuidance` is an optional reusable reference card for a method, using
the same shape and validator as node-type and protocol guidance
(`shared/aiDesignGuidance.ts`):

| Field | Contract |
|---|---|
| `content` | Required nonblank multiline text, at most 8,000 JavaScript string characters; disallowed control characters are rejected and nothing is truncated. |
| `sources` | Optional list of at most 16 absolute HTTP(S) URLs, each at most 2,048 characters, without credentials or whitespace. They are citations only. |
| `revision` | Required positive safe integer, authored by the editor. |
| `updatedOn` | Required real calendar date, `YYYY-MM-DD`, recording the last edit. |

Unknown fields reject the card. Revision and date record authorship and editing
only; they do not imply an independent review, provider approval or deployment
verification. Existing Description text is never converted into guidance.

Guidance is **reference data, not authority**. It is separate from the stable
ID, aliases, legacy status, `behavior`, runtime availability and target-node
policy, none of which it can change. It does not make an unavailable method
selectable, establish that a flow is authenticated, replace a missing owner
contract, grant an exception, or create identity requirements. Source URLs are
not fetched automatically by SecureDesignStudio, a browser tab or the AI
service. The AI features treat the text as untrusted data, never as
privileged instructions or a verified assurance. Selecting or viewing a method
sends no AI request.

Where to author it:

- **Model > Customize authentication** edits the profile-library definition.
  The editor shows the guidance fields beside Method and Description, with
  **Remove guidance from draft**. Save writes the library and, as for other
  presentation edits, updates matching saved definitions in the current diagram;
  saved definitions that differ remain untouched. Cancel changes nothing. An
  unchanged Save is a no-op. If another tab or action changed that method after
  the editor opened, Save reports that the method changed and applies nothing.
- In a selected flow's authentication area, **Authentication AI design
  guidance** shows the effective card, its revision, whether the diagram holds
  a saved definition or the card comes from an available catalog definition,
  and any source links, labelled unverified reference guidance. **Edit guidance
  for this method in this diagram** opens a draft with **Save guidance** and
  **Cancel guidance edit** (Escape also cancels and returns focus). This is
  **method-wide**: saving changes the diagram's saved definition for that
  method, so it affects every flow using it across all scenarios. It does not
  edit the profile library, the flow's selected method, Description, audience,
  constraints, caller identity, rights or protocol. Per-flow guidance is not
  supported; use the flow's own Description for flow-specific context. A
  method that is unresolved shows the card as unavailable to edit until it is
  resolved in the library; existing flow values are preserved.
- Saving in a diagram captures the complete effective definition as a saved
  definition (when none existed) with the new card. It does not install or
  enable the method, and protected behavior is unchanged. Each diagram-only
  edit, and each library edit with its matching-diagram updates, is one
  Undo/Redo step; a validation or storage failure applies nothing.

Removing guidance is explicit. In either editor, remove it from the draft and
Save. A cleared **saved** definition remains saved without guidance, so a
same-ID installed or library card does not silently return. The saved
definition wins as a whole, never merged with the installed one.
To use the library or installed card again, explicitly resolve/adopt the
library definition in the diagram, an undoable diagram-only action. A library
**Reset** restores the supplied Method, Description, short label and
guidance; a built-in with no supplied guidance returns to none.

How the AI features use it:

- **Design Assistant (Chat and AI Analysis)** adds an `authenticationGuidance`
  list to the request context: one entry per method used by flows inside the
  permitted review scope, with `methodId`, `definitionSource` (`saved` or
  `available`), `revision`, `updatedOn`, `sources`, `content` and the
  `appliesToEdgeIds` flows it describes. Flows whose method is unresolved or has
  no card are listed in `authenticationGuidanceMissing` (flow ID, method ID,
  reason) so the AI reports the gap instead of inventing steps. It does not add a
  card-selection model call, sends no unbound cards, and never broadens an
  endpoint-only node's interior scope. Legacy multiple-method arrays bind each
  method to the flow; unresolved IDs remain evidence. The card body appears only
  here, not in the separate `authenticationDefinitions` summary.
- **Threat Model Designer** always supplies cards for methods on included
  existing flows and checks that required context before any call. When the
  complete request with every selectable method's card fits within the limits
  and the single-call context heuristic, one design call carries all those
  cards. Otherwise one planning call
  receives a compact `authenticationIndex` (`id`, `label`, `hasGuidance`,
  `usedInScenario`, no card text) and returns up to 8 `authenticationIds`;
  only those and the in-use cards are sent in the design call, with empty
  `appliesToEdgeIds` for methods that no included flow uses. The design
  catalog still lists every selectable (enabled, non-legacy, resolved) method
  with `hasGuidance` and `guidanceSupplied`, and target-node rules still decide
  acceptance, so an omitted card never clears or forbids a method. A proposed
  method without a supplied card is reported as "Proposed authentication without
  supplied guidance"; in-use methods without a card are reported too. Plan IDs
  must resolve in the final scoped request; a model, scenario or catalog change
  between the calls blocks the design call.
- Guidance can never select, change or clear a flow's authentication, make a
  method acceptable to a target, or supply Application IDs, audiences, tenants,
  secrets, certificates or grants. Accepted findings record the supplied
  method, revision, edit date and sources as unverified reference context.
- Both features share one **384,000-byte** aggregate limit for serialized node,
  protocol and authentication guidance, and the existing **500,000-byte**
  limit for the complete serialized request. Authentication cards do not receive
  a separate allowance. Planning requests carry indexes only and are rejected if
  they include card bodies. If the required cards do not fit, no provider call is
  made. If selected optional cards overflow, one planning request has been sent,
  no design request is sent, and the exchange stops with an explanation and a
  request for a narrower task. SecureDesignStudio does not
  truncate cards, batch the design automatically, or apply a partial result.
  See [custom libraries](custom-libraries.md#ai-design-guidance) and
  [bring your own AI](bring-your-own-ai.md#request-size-and-tokens-per-minute).

### Shipped cards and coverage

The shipped set covers all 18 inventoried methods: 17 selectable methods and
the legacy `Certificate authentication` entry. All 18 are core definitions in
every build, with no optional package required. Cards are concise original
syntheses with public source URLs, authored revision 1 and an edit date. They
explain the roles involved, how a credential or token is acquired, presented and
validated by the receiver, and the audience, lifetime, replay and key-handling
questions that matter, and they ask for missing information instead of
assuming it. They separate authentication from authorization and transport
encryption. All cards are public-use reference content. The `Custom method` and
legacy `Certificate authentication` entries have
uncertainty cards that ask for the contract (or, for the legacy certificate, for
reclassification into a specific method) and do not assign a default mechanism.
`Not specified`, unresolved custom IDs and user-created custom methods have no
shipped card.

**Limited cards (owner-contract questions).** For the four methods below, no
authoritative public protocol specification was found, so
their cards are deliberately limited and uncertainty-aware. They are **not**
sourced, complete explanations of the mechanism. They contain only generic,
conditional public facts (for example that app-only tokens identify the
application, that forwarding a token raises confused-deputy risk, and what proof
of possession mechanisms exist publicly) and a list of questions for the owner:

| Method (ID) | What the card cannot state |
|---|---|
| App + user context (`EntraApplicationOnlyWithForwardedUserContext`) | The forwarded field and format, who produces it, how it is integrity-protected and bound to the request, receiver and application token, whether the application token is a standard Entra app-only token, how the receiver combines application permission with per-user and tenant authorization, and the consent model. |
| Constrained delegation (CDT) (`EntraApplicationOnlyWithCdt`) | The issuer, signing or protection and format of the token; what is delegated and for whom; its binding to the application token and request; the constraint language and where it is enforced; lifetime, replay, revocation, audit and onward forwarding. The card explains the SDS fields (Application ID, Audience, Constraints) and does not assume it is Kerberos constrained delegation, OAuth token exchange or on-behalf-of; without an owner contract it asserts neither equivalence nor distinction. |
| PFAT (`ProtectedForwardedAccessToken`) | The product meaning of the acronym, issuer, protection and binding, forwarding path and original audience, carried identities, receiver validation, revocation and audit. It is not described as equivalent to, or distinct from, PoP + PFT. |
| PoP + PFT (`PopWithProtectedForwardedToken`) | Which proof-of-possession mechanism applies (public mechanisms such as mTLS-bound tokens or DPoP are named only as examples; the mechanism is unknown), what PFT is and who issues it, who holds the key, whether forwarding preserves or re-binds the proof, and audience, replay and revocation. It is not described as equivalent to, or distinct from, PFAT. |

The shipped limited cards do not guarantee that an unknown proprietary method
is fully described. Their purpose is to prevent invented protocol steps: the AI
should explain what the model shows, list these questions and mark any proposed
change as conditional. To close a gap, an owner can supply a public-use,
owner-reviewed explanation, which must then be source-checked and merged as a
new revision; a public-use decision does not make unrelated owner material
publishable. Until then, treat those four methods as having incomplete
coverage.

Being built in does not verify a method or its labels: the definitions keep
their protected behavior profiles, and a method named for an owner-specific
contract is still not established as secure, equivalent to another method, or
accepted by a target. A saved diagram definition whose contract differs from the
core definition is retained for review, not silently adopted.

Guidance quality depends on its sources and wording. Cards for owner-specific
or proprietary methods may be incomplete when no adequate public description
exists; such a card asks for the missing contract rather than inventing protocol
steps. Custom method, Not specified and ambiguous legacy entries describe
uncertainty, not a mechanism. The cards were checked against their cited
public sources when authored; they have not been validated by live-model
evaluation unless a separate evaluation is reported, and mocked contract tests
do not prove live model quality or deployed authentication correctness.

## Precedence and portability

Flows and node-policy rules retain stable IDs. The additive
`PsDocument.authenticationDefinitions` array stores compatibility definitions
inside `.tma`, autosave, exported standalone HTML and collaborative documents.
It is not a user-managed per-diagram library or a scope selector.

Resolution is deterministic:

1. A saved diagram definition retains its display, explicit metadata and its
   guidance, or its absence, as one unit. It does not install a library or
   authorize a conflicting behavior contract.
2. An installed ID without a saved override uses the active library's
   presentation and guidance, with protected supplied behavior.
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

Core supplies **18 definitions** (17 selectable methods and the legacy
certificate), including App + user context, CDT, PFAT and PoP + PFT, and
**Customer/Other** tenant choices. These methods do not require an optional
package for new selection. A selected library can contribute additional
definitions and tenant choices without changing core defaults. A package that
contributes one of these 18 IDs collides with core and must be reconciled under
the [overlay rules](custom-libraries.md#package-contract-api-1), not by a silent
same-ID win.

Installed availability is passed explicitly by the runtime, separately from
profile preferences and saved diagram definitions. Cached preferences and
saved snapshots cannot make an unavailable library definition available for
new selections. A saved contract that differs from the installed behavior is
retained for review, not silently rewritten or trusted for analysis. The flow
remains readable, but its method is unavailable for new calls until the
definition is available and explicitly reconciled. The same applies to an
unknown custom ID or a saved definition whose contract does not match a core
method.

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

Node-catalog exports include referenced authentication definitions, with any
saved guidance. Complete
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
| `.tma`, autosave, embedded standalone HTML | Stable IDs and saved definitions, including any `aiDesignGuidance`, retained. Document/wrapper versions remain 1/2; `.tma` is unchanged. Embedded model takes precedence over autosave. |
| Compare to previous | An authentication definition whose AI design guidance differs is reported as a changed definition; the change text names the guidance among the differing fields. |
| Browser collaboration | Saved definitions synchronize through the existing authentication-definition Y maps, carrying the full nested guidance field, which is validated before the transaction; local library preferences do not synchronize. Test with synthetic peers; this is not live-service validation. |
| Older readers / mixed-version rooms | Builds older than a referenced method's compatibility floor may discard its ID or definition. Builds that predate `aiDesignGuidance` may reject a definition containing it, or drop the card when re-saving. No guidance-specific minimum application version is defined, so the method-ID compatibility notice below is not assurance that a build supports guidance. Do not use them to edit these models or join their rooms. New-reader/old-file compatibility does not imply old-reader/new-file safety; older peers cannot be reliably detected or prevented. Keep an editable `.tma` backup. |
| TM7 | Human-readable auth names and an `Auth IDs` label line preserve identifiers emitted by this build. Legacy shipped labels are accepted. Definitions/behavior/guidance are not a native TM7 concept and are not restored; custom IDs reopen unresolved and need explicit resolution. |
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
assessment, or evidence that every definition is resolved. It also does not
establish support for AI design guidance: the version check covers
authentication method IDs only, and older readers may reject the optional
field. Use a compatible build when editing or collaborating, and save an
editable backup as `.tma`.

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
