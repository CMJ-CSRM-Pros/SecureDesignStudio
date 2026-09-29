# Classification Library

Version 0.1.28 adds one active, browser-profile Classification Library. The
initial shipped library preserves the existing ten classification IDs, labels,
descriptions, EUII new-item default, and diagram presentation.

Version 0.1.29 adds **Model > Customize classifications** for editing the active
list and importing/exporting JSON. The Data inspector displays its name/source
and new-item default. This is not an internal/external runtime mode and does not
make the current build ready for public distribution.

## Shared defaults and public guidance

Version 0.1.39 uses one shared dictionary (revision `1.1.0`) in core-only and
companion-library configurations. All ten existing IDs/labels remain, with
**Administrator Data** and **Customer Data** added. Existing colors and the
EUII new-item default are unchanged; the new categories have neutral
presentation, not an invented sensitivity ranking.

The definitions and guidance align with
[Privacy in Microsoft Purview](https://learn.microsoft.com/en-us/purview/purview-privacy):

| Category | Meaning and scope |
|---|---|
| EUII | End User Identifiable Information, such as user names, email, UPN and IP addresses. |
| EUPI | End User Pseudonymized Identifiers, such as UserID, UserKey and mailbox GUID. Pseudonymized does not mean anonymous. |
| Administrator Data | Identifying information associated with a person's administrative duties; not the same as permission records or billing details. |
| Customer Data | The broader Purview-aligned category, including content, configuration, queries/results, alerts, reports, connector data and labels. |
| Feedback Data | User/admin feedback; the application category is not limited to Purview's feedback platform. |
| Customer Content | Retained narrower category for customer-provided/generated content. No automatic conversion to Customer Data. |
| OII, System Metadata, Access Control Data, Support Data, Account Data, Other | Retained supplemental modeling categories, not claimed to be defined by that Purview page. |

These categories can overlap. A data item's selected category does not prove
personal-data status, lawful basis, contractual scope, retention requirements
or compliance. Do not copy Purview's service-specific retention/residency
commitments into a model as universal rules. This is not a NIST/GDPR taxonomy.

Common definitions are maintained once; an optional library need not copy
them. Private instructions can be separate `help` contributions visible under
**Model > Custom Libraries** without changing the common dictionary.

Existing profile libraries (including the earlier ten-entry seed) and saved
diagram definitions remain authoritative. Loading a newer build does not
silently add categories to a customized/stored profile or rewrite old text.
To adopt new entries, explicitly import/merge a reviewed updated catalog or
add entries in the editor; adoption of a changed definition into a diagram
remains separate. A public build does not sanitize an old profile or model.

Native imports retain valid IDs and saved definitions. Missing/invalid legacy
classification fields still normalize deterministically to EUII, independent
of profile preferences. Recognized PMEXP labels, including the new category
names, map to stable IDs even when not enabled in the active authoring list.

## Editor workflow

Search/select an entry, then **Edit classification** to change its name and
description. **Add classification** creates a stable ID; IDs are not renamed by
editing display text. Existing presentation metadata is retained. Library
settings edits the name, revision, optional guidance URL and enabled default;
the library identity is read-only there and changes only through an explicit
replacement catalog.

Choose a different default before disabling/deleting the current default.
Deletion is blocked for IDs referenced by data, node policies, or Undo/Redo
history; use Disable instead. Other saved files cannot be inspected by this
browser, so disabling is also safer for entries they may use.

Library edits preserve the current diagram's existing definitions. When a saved
definition differs, **Use active definition in this diagram...** previews and
explicitly adopts its display metadata for that diagram only. IDs, policy rules
and profile settings do not change. This action is independently undoable.

### JSON import, merge and replace

**Import JSON...** validates the file and opens a preview; nothing changes until
Apply. Preview includes entry changes/removals, default, identity/revision,
guidance and display metadata.

- **Merge** adds new IDs and replaces matching entry definitions. It retains
  the active library identity, name, revision, guidance and default. If imported
  entries would disable that default, the merge is rejected: choose another
  enabled default first or explicitly use Replace.
- **Replace** uses the incoming library and default. A confirmation is required;
  old model IDs are not mapped to new categories. Referenced old definitions are
  captured before switching, and added definitions can supply display metadata
  for previously unresolved references.
- Matching-ID updates require acknowledgement. An identical catalog has no
  changes to apply. Stale previews/writes are rejected rather than overwriting a
  newer profile.

**Export JSON** downloads the complete active list, including disabled entries,
not a sanitized external-sharing package. **Use shipped defaults...** opens the
same explicit Replace preview rather than resetting immediately. Nothing writes
repository source JSON or contacts a service.

Finish or cancel an edit before changing operations. Escape cancels only the
topmost confirmation, import preview, read, or draft before closing the dialog.

## Runtime behavior

- New data uses the active library's `defaultId`, which must identify an enabled
  entry. At least one enabled type is required; an empty list, all-disabled
  list, absent default, or disabled default is rejected.
- New classification choices use only enabled entries in the active list.
  Existing saved/out-of-list/disabled values remain readable, but are not offered
  as new choices for other data items or policy rows.
- Saved diagram definitions take precedence for that diagram. A list cannot
  silently replace saved labels or reclassify existing data.
- The active list is authoritative for available definitions. Loading a profile
  does not implicitly union the shipped internal list into it. A valid ID without
  an active or saved definition remains unresolved.
- Native normalization is independent of profile preferences. Existing
  conservative malformed-input behavior is unchanged; a profile's authoring
  default is not an import migration rule.
- PMEXP source-schema aliases keep their canonical IDs even when the active list
  lacks those IDs. Unsupported source labels keep the existing explicit Other
  fallback/summary behavior. This does not broaden the PMEXP schema.
- Policy outcomes still match explicit IDs and wildcard rules, not display
  names, descriptions, or display priority.

## Versioned JSON contract

The editor and configuration tooling use this contract. This is not a native
model or the scenario/DFD JSON import format.

```json
{
  "format": "secure-design-studio-classification-catalog",
  "version": 1,
  "id": "example-classifications",
  "name": "Example classifications",
  "revision": "1",
  "defaultId": "ExamplePublic",
  "classifications": [
    {
      "id": "ExamplePublic",
      "label": "Example public",
      "description": "Synthetic category, not an approved public taxonomy.",
      "disabled": false
    }
  ]
}
```

| Field | Contract |
|---|---|
| `id` | Library identity; a valid bounded catalog reference ID. Not a verified publisher identity. |
| `name` | Nonblank display text, at most 120 UTF-16 code units. |
| `revision` | Nonblank opaque version text, at most 128 code units; independent of app and JSON-schema versions. |
| `defaultId` | Exact ID of an enabled entry in this library. |
| `guidanceUrl` | Optional absolute HTTP(S) help URL, at most 2,048 code units; no embedded credentials. No request occurs merely from loading it. Render-time URL checks remain in place. |
| `classifications` | 1-2,000 entries; case-insensitive duplicate IDs or labels are rejected. References remain case-sensitive and are never renamed to fix a collision. |
| Entry `id` | Stable opaque ID; uses the catalog-reference validation from model compatibility. |
| Entry `label` | Nonblank text, at most 160 code units. |
| Entry `description` | Optional text, at most 4,000 code units; blank text normalizes to omission. |
| Entry `disabled` | Optional boolean, default false. Existing references are preserved. |
| Entry `presentation` | Optional `color` and `foreground` as six-digit hex colors, and integer `priority` from 0-100. All three are required if present. Display metadata only, not a security/compliance score or policy rule. |

Unsupported fields, invalid types, reserved IDs, unsafe URLs and invalid
defaults reject the configuration in full. There are no scripts, service
endpoints, credentials, or executable capabilities in this format.

New entries without presentation metadata use neutral diagram styling. A flow
with any unranked/out-of-list classification also uses neutral styling rather
than inferring sensitivity from a name. The shipped presentation metadata now
lives with the classification data, not a parallel hard-coded canvas ID list.

## Profile storage and failure handling

The profile key is `secure-design-studio:classification-library:v1`.
Configuration is loaded at tab startup and updated by successful editor
transactions; changes made elsewhere require a reload. New/Open and
collaboration never replace the active library.
File origins, browser profiles, and application origins have separate storage.

Loading does not write the key. Missing configuration uses the shipped library.
Corrupt/denied profile storage produces a visible warning and uses the validated
shipped defaults without overwriting the stored value. The storage writer
validates before saving, compares the expected library with current storage to
reject stale-tab writes, and reports quota/access errors rather than committing
a partial update.

If stored configuration is corrupt but readable, **Download stored backup**
saves its raw text. Import a valid replacement or choose shipped defaults, then
acknowledge replacing the invalid stored value. Repair verifies that those exact
invalid bytes are still present; it cannot overwrite a newer valid repair from
another tab. Denied storage must be enabled/recovered before a write can succeed.

Library and diagram operations share Undo/Redo. A library transaction retains
the previous effective library and pins existing diagram/history definitions
before changing preferences. Profile persistence is attempted before committing
in-memory library/model/history changes; a failed write commits none of them.
Undo/Redo also reject stale profile writes. Undo restores effective values, not
raw corrupt bytes or absence of a profile key; restored shipped values may
remain a profile copy.

Authentication Library preferences are separate. The classification profile itself is not a `PsDocument` field or shared Yjs
collection. Optional `classificationHistory` in local autosave carries profile
history alongside matching document entries and follows the same trim limits.
Malformed profile-history entries are excluded with a diagnostic; they cannot
partially restore two profile libraries in one transaction.

## Snapshot and consumer rules

Browser consumers use `useStore().classificationLibrary` and
`classificationDefinitions`. Shared/pure helpers receive available classification
definitions explicitly; they must not read browser profile storage implicitly.
The legacy constants in `types.ts` represent shipped defaults, not an active
authoring list.

Snapshot capture, autosave/history, native export, node-catalog export, report
labels, comparison, the scoped Assistant context and collaboration use the active
definitions. Only referenced IDs/labels/descriptions and unverified library
ID/revision are copied to [document snapshots](catalog-snapshots.md). Disabled
flags, presentation, default selection, guidance URL and the complete profile
list are not included. Existing saved snapshots still win.

The Yjs reconciler receives the same available-definition context as the browser
hook so it cannot recapture excluded shipped defaults during synchronization.
Peers with different active lists retain each other's saved definitions without
changing either profile.

Use 0.1.28 or later for list-aware authoring. Older snapshot-capable readers may
preserve model definitions while still using their own older authoring defaults.
The private CLI retains its existing authoring validation; it does not acquire a
profile-library administration capability.

## Implementation ownership

- `src/classificationLibrary.ts`: validation, JSON codec, profile load/persist,
  enabled choices and snapshot projection.
- `src/data/classificationLibraryDefaults.json`: shipped library identity,
  default and guidance.
- `src/data/dataClassifications.json`: shipped entries and presentation.
- `src/store.tsx`: active profile binding, guarded authoring defaults and
  context-aware persistence.

The public/internal seed-data separation, internal acceptance of the complete
workflow, and release-content clearance remain later checkpoints. An
alternate active list is configuration, not model sanitization.
