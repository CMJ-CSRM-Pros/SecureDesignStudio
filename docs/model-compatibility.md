# Unavailable catalog references

Native `.tma` documents can contain classification, production-identity tenant,
privacy/security boundary subtype, and deviation-kind identifiers that are not
defined in the running build. A missing definition is different from invalid
data. Starting with application version 0.1.25, valid unfamiliar identifiers
are retained rather than changed to EUII, Other, an unspecified boundary, or
the generic deviation kind.

## What survives

Native open/save, autosave recovery, Undo/Redo, embedded standalone HTML, and
compatible browser peers preserve these references. Document-local node-type
data policies retain unfamiliar classification IDs and default privacy-boundary
IDs too. Saved classification filters remain active, and unfamiliar attached
classifications can be selected in Filter.

Inspectors retain the selected value as `identifier (unresolved)`. Unavailable
values are not added to the defaults for authoring new model data. Explicitly
choosing a known value replaces the reference and is undoable; merely viewing
or saving does not resolve it. Existing known choices retain their behavior.

Canvas classification badges include the unresolved identifier and use a
neutral color when any attached classification is unavailable, rather than
inventing its sensitivity ranking. Review HTML and VSDX retain its display
label. External exports are still lossy drawings/reports, not editable native
backups; retain the `.tma`.

## Validation and trust

Catalog reference IDs are nonblank, trimmed strings of at most 128 UTF-16 code
units. They may contain Unicode and ordinary namespace separators. Control
characters, angle brackets, reserved object-property names, and the wildcard
`*` are not reference IDs. `*` remains valid only where the existing node-policy
schema explicitly defines it as a wildcard. Malformed values retain the
existing conservative normalization behavior.

An unresolved label means the definition is unavailable; it does not assert
policy compliance, equivalent semantics, or an installed library. IDs are
opaque text, not URLs to fetch or code to execute. Existing explicit node
policies still compare their declared identifiers; no classification meaning is
inferred from a name.

Authentication continues to use its separate strict ID, alias, protected
built-in, and saved-definition validation described in the
[Authentication Library contract](authentication-library.md).

## Current limits

Reference preservation in 0.1.25 adds no library loader or executable capability.
Version 0.1.26 additionally supports optional, data-only
[catalog-definition snapshots](catalog-snapshots.md) for these five catalogs.
Existing node-type definitions and authentication snapshots keep their current
contracts. Retention, geography, and GDPR definitions are not included in this
snapshot collection.

Version 0.1.28 adds an active [Classification Library](classification-library.md)
for authoring defaults and available choices. Its profile settings never
silently reclassify a model or change native normalization. Existing out-of-list
values are retained even when they cannot be selected for new data.

The built-in catalogs are still installed. Analyze still runs current
rules and reconciles typed issues by their existing definitions;
preservation of findings from unavailable rules is separate work. Opening a
model still merges the installed node-type catalog into its node-type list.

Use a current SecureDesignStudio build for every browser peer editing a diagram
with authentication or communication profile references. Older readers can
coerce or discard saved catalog definitions, communication profiles, and caller
Application IDs; this build cannot prevent an older client from writing a lossy
update. No new schema version or persistence namespace makes an older client
safe. Keep an editable `.tma` backup before using older tools or live rooms;
local synthetic peer checks are not a live-service guarantee.
