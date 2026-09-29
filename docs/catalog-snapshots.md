# Portable catalog-definition snapshots

Starting with 0.1.26, native documents can carry display definitions for five
catalogs: classifications, production-identity tenants, privacy boundary
subtypes, security boundary subtypes, and deviation kinds.

This is saved document data, not a Custom Libraries installer. It adds no
network discovery, sign-in, executable rules, provider configuration, or
permissions. Authentication definitions and document-local node policies retain
their existing contracts.

## File contract

`PsDocument.catalogDefinitions` is an optional array. Existing document version
1, native wrapper version 2, `.tma`, and persistence keys are unchanged:

```json
{
  "catalogDefinitions": [
    {
      "kind": "classification",
      "id": "PartnerRestricted",
      "label": "Partner restricted data",
      "description": "Display metadata supplied with this synthetic model.",
      "library": {
        "id": "example-library",
        "version": "1.0.0"
      }
    }
  ]
}
```

| Field | Validation |
|---|---|
| `kind` | Exactly `classification`, `tenant`, `privacyBoundary`, `securityBoundary`, or `deviation`. Retention, geography, GDPR and authentication are not additional kinds here. |
| `id` | The bounded opaque reference ID defined in [model compatibility](model-compatibility.md); lookup is case-sensitive. |
| `label` | Nonblank text, at most 160 UTF-16 code units. |
| `description` | Optional nonblank text, at most 4,000 UTF-16 code units. No executable meaning is inferred. |
| `library` | Optional object with `id` and nonblank `version` (at most 128 UTF-16 code units). Both are required when the object is present. This is an unverified provenance claim, not installation or publisher verification. |

At most 2,000 snapshots are accepted. Duplicate `(kind, id)` pairs, invalid
types, unsupported fields, and disallowed control characters are rejected as
one invalid collection. A matching ID in two different kinds is valid. There
are no script, endpoint, token, capability, behavioral, or policy fields.

Native import validates before replacing the current model. Invalid saved
snapshots in embedded HTML/autosave pause recovery with an explicit notice;
automatic saving cannot overwrite the stored model until the user opens a
valid backup or explicitly creates a new document.

## Capture and precedence

Native export, autosave (including history), and browser collaboration capture
available definitions referenced by the document. This includes all data items,
edge tenant values, boundary subtypes, deviation kinds, and explicit
document-local node policy classification/default-boundary references, even in
inactive scenarios. Wildcards and installed node types without a document-local
policy do not expand into the whole catalog.

Only referenced snapshots travel with a saved model. Unused definitions are
omitted during dependency capture; no input object or global catalog is
modified. A valid unfamiliar ID without a definition stays unresolved: the app
does not invent one.

Resolution for a document is:

1. Its saved definition, if present.
2. The installed definition for that same kind/ID.
3. The retained identifier with an unresolved label.

For classifications in 0.1.28 and later, available definitions come from the
active [Classification Library](classification-library.md), not an implicit
union with every shipped entry. New choices are limited to its enabled entries;
existing saved out-of-list selections remain readable. Other catalog kinds keep
their existing resolution behavior.

Saved labels/descriptions never silently become a profile library. Opening or
creating another document does not change installed defaults or Authentication
Library preferences. Definitions can be reused by selectors within the current
document; they are not installed for other documents.

From 0.1.29, classification-library edits pin the existing diagram/history
definitions before changing the profile. The editor's explicit **Use active
definition in this diagram** action can replace a differing saved classification
definition without changing IDs or profile preferences. Library transactions and
this diagram-only action remain separate Undo steps.

The **Saved catalog definitions** disclosure shows document-only entries,
differences from installed definitions, and unverified library metadata.
Descriptions are rendered as text/safe existing rich-text content, never raw
executable HTML. A saved label does not change classification ranking,
authentication behavior, or the meaning of explicit policy IDs. Unfamiliar
classifications retain neutral canvas styling.

## Round trips and collaboration

Native JSON, autosave/history, embedded standalone HTML, and compatible browser
peers preserve referenced definitions. Comparison has a **Saved catalog
definitions** category and ignores collection ordering. Reports and supported
Visio/TM7 display labels use the saved definitions; those formats remain lossy
and do not become editable snapshot backups.

Node-catalog packages include the snapshots referenced by their explicit
policies. Same-kind/same-ID conflicts with the current diagram reject the
package before any import mutation; importing a node catalog does not silently
overwrite the diagram's definitions.

Yjs stores complete snapshot values under composite kind/ID keys and a
`catalogDefinitionsVersion: 1` marker. Definition-only room state prevents
stale seeding. Unknown marker versions or malformed entries block materializing
or writing that room instead of dropping fields. Whole-value updates keep
concurrent provenance/label fields from forming a hybrid snapshot. As with
other Yjs values, concurrent edits to the same definition resolve using Yjs's
conflict semantics; no publisher authenticity is implied.

An older helper that omits the optional collection is not treated as deleting
it. This is not a guarantee for every older client: readers before 0.1.26 may
discard the field when saving a file. Use compatible browser writers and keep
native backups. The private CLI does not acquire a new snapshot-administration
capability.

## Explicit limits

This checkpoint does not load custom libraries, extract internal content,
snapshot entire node/authentication policy libraries, remove the ServiceTree
rule, or preserve findings from unavailable rules. Those are separate changes.
Model snapshots can themselves contain internal descriptions; snapshot
portability does not sanitize a model for external sharing.
