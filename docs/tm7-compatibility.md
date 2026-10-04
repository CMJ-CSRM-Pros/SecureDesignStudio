# TM7 drawing compatibility

**Save `.tma` for the full-detail model.** TM7 is a bounded drawing projection,
not another extensible SecureDesignStudio document format. File > Save as >
Microsoft Threat Modeling Tool previews losses before download. File > Import >
Threat Modeling Tool parses and previews losses before replacing the diagram.
Cancel makes no change; replacement uses the existing undoable native import.
Keep the original TM7 when importing unsupported content.

## Supported role and scope mapping

| Effective DFD role | Native generic type | Instance / representation |
|---|---|---|
| Process | `GE.P` | `StencilEllipse` / `Ellipse` |
| Data Store | `GE.DS` | `StencilParallelLines` / `ParallelLines` |
| External Interactor | `GE.EI` | `StencilRectangle` / `Rectangle` |

These are existing native definitions, not custom stencil semantics. The writer
declares each in its embedded KnowledgeBase. Roles come from the shared DFD
resolver: explicit node override, catalog default, or the existing legacy
Process fallback. Titles never classify a node. An unresolved role blocks
export rather than silently asserting a Process mapping.

Each scenario becomes a tab. Its node occurrence gets **Out Of Scope** and
**Reason For Out Of Scope** only when the shared resolver says it is effectively
out of scope. External Interactors always export false/empty; inactive evidence
is reported as a loss. LLM eligibility never removes nodes or flows from export.
With no scenarios, the fallback Diagram includes the graph and resolved roles
but has no scenario exclusion.

On import, recognized generic types become explicit DFD overrides; service
types stay blank because native stencils are not SDS service catalog entries.
Node scope reasons remain per scenario. A true flag without a reason does not
invent one. A false/absent flag with a reason is diagnosed and the reason is
omitted to avoid activating an exclusion. External reasons are retained only
as inactive evidence. Unknown node roles remain unresolved with diagnostics.
Conflicting shared roles or connector endpoints block replacement.

## Identity and integrity

Tab GUIDs are derived from scenario IDs, not names. Valid imported tab GUIDs
remain scenario IDs. Legacy tabs without a GUID get a new ID with a notice.
Node/flow/boundary GUIDs keep the existing deterministic ID mapping.
Same-direction parallel flows remain separate objects. Every connector must
resolve to node occurrences on its own tab.

`prepareTm7Export(doc, options)` returns `{ xml, diagnostics, references }`.
`references` contains **only emitted occurrences**, with `kind`, `entityId`,
`scenarioId` (null on fallback), `tabGuid`, `objectGuid`, and `serializationId`.
The serialization ID is allocated by the same file-wide allocator used to
render the occurrence. The authored-threat adapter consumes this seam; it does
not match titles, independently hash IDs, or reference omitted objects.
`exportTm7` retains its existing string-returning API; interactive callers must
use the prepared result to present diagnostics before downloading.

Duplicate/colliding IDs, missing memberships/endpoints, conflicting dictionary
keys, unsupported serialization references, invalid XML text and malformed XML
fail explicitly. XML `z:Ref` object reuse is not supported by this bounded
reader. Cross-tab differences in labels, authentication or layout keep the first
occurrence and are disclosed; no claim of arbitrary-template fidelity is made.

## Intentional losses

The projection retains node titles, existing inventory labels/IDs, flow titles,
authentication labels and IDs, direction, exported numbers, basic layout,
scenario membership, security boundary labels, and effective role/scope.
Authentication definitions/behavior, service types, catalog/override provenance,
additional metadata, privacy boundaries, data/retention/attachments, comments,
issues, deviations and work items are not fully represented. Security boundary
subtypes become label text. Node and flow descriptions, endpoint patterns,
production identity, audience, constraints, required access rights and waypoint
geometry are omitted. The loss preview counts distinct exported flows with
nonblank required-rights text, once per shared flow even across multiple tabs.
Blank text and flows outside the exported tabs do not trigger that notice.
No native rights property is created; retain `.tma` or portable application HTML
for the exact declaration, or use the HTML review report to read it.
Scenario descriptions are omitted. When scenarios exist, objects outside every
scenario are omitted; the no-scenario Diagram fallback includes the graph.

Flow numbers are exported, but the existing importer sorts and compacts them
to sequential numbers. This limitation is disclosed, not repaired here.
Unsupported input properties, template behavior and native threat sections
are reported before replacement.

**Explicit authored threat notes are exported as native User-defined records.**
See [Threat notes](threat-notes.md) for the precise field mapping, aggregation,
single-tab projection, workflow/priority limitations and required native
acceptance evidence. Ordinary comments, untyped legacy issues, accepted AI
findings and analyzer issues are not promoted to authored threats.
Missing optional explanation is not an error. TM7 re-import still reports
native threat data as unsupported before replacement; keep the `.tma` original.

## Evidence boundary

Synthetic tests in `tests/authentication/tm7-semantics.test.mjs` cover roles,
scope, native-shaped independent inputs, references, parallel flows, conflicts,
escaping, losses and no-mutation behavior. Run them with:

```powershell
node --test tests\authentication\tm7-semantics.test.mjs
```

These tests and a frontend build do not establish native TMT open/save/reopen
compatibility, browser File interaction behavior, or human usability. Those
gates require separate observations on the exact candidate. Installed standard
template declarations corroborate role representations but are not a native
runtime pass.
