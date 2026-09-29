# Third-party provenance and notices

The prepared public first-party source uses the owner-approved MIT license,
copyright Microsoft Corporation. That license does not replace the separate
terms below or grant trademark rights. Publication approval is separate from
license selection; the private companion's licensing is not changed by the
public candidate.

## Runtime dependency notices

[`src/data/runtimeDependencyNotices.json`](../src/data/runtimeDependencyNotices.json)
records the complete license/notice texts for the locked frontend and API
runtime dependencies and their transitive packages. Names, exact versions,
scopes, package-source URLs and integrity values identify each component.
The record travels in normal and standalone builds under **About > Dependency
notices**. It does not claim that API-only dependencies are bundled into the
browser or that development tools are redistributed with the app.

The installed `@azure/web-pubsub` 1.2.0 package lacks its declared LICENSE file;
its notice was recovered from the
[exact upstream release revision](https://github.com/Azure/azure-sdk-for-js/blob/de7859e49d7d941103c918bf8d1f8d14d214899b/LICENSE).
Other texts are retained from their locked installed packages. Component
licenses are MIT, ISC, BSD-3-Clause, Apache-2.0 or 0BSD; they are not all
relicensed to MIT by the project's license.

## Embedded Visio template

SecureDesignStudio embeds `vsdx/media/media.vsdx` from the
[vsdx project at revision 934a1b5dc68cbc7dab2d34509221741a1d97d2dd](https://github.com/dave-howard/vsdx/blob/934a1b5dc68cbc7dab2d34509221741a1d97d2dd/vsdx/media/media.vsdx).
Its [upstream license at that revision](https://github.com/dave-howard/vsdx/blob/934a1b5dc68cbc7dab2d34509221741a1d97d2dd/LICENSE)
is **BSD-3-Clause**, not MIT. The embedded 20,056-byte template matches the
upstream bytes, SHA-256:

`f5ead22055be37b867a858cf94f1ecca4fe06d954c7c39f44cca72958a4410af`

The canonical complete copyright, conditions and disclaimer are retained in
[`src/data/vsdxTemplateNotice.json`](../src/data/vsdxTemplateNotice.json).
Keep that record with source distributions. It is also embedded in normal and
standalone applications under **About > Visio template notice**, and in newly
generated VSDX document properties so the export carries the notice.
The notice applies to the template component, not all SecureDesignStudio code.

Export keeps the template's style/master parts and the generated diagram
pages. It generates new document properties instead of copying the template's
author, company, timestamps, custom properties or stale thumbnail. The retained
copyright in the license notice is attribution, not the diagram's author.
These changes do not modify the original embedded template bytes.

## Microsoft cloud icons

The [icon source inventory](../src/assets/node-icons/README.md) records the
official packs. Their published terms restrict use; they are not automatically
covered by a future license chosen for the application. For example, the
[Azure architecture icon terms](https://learn.microsoft.com/azure/architecture/icons/)
permit copying, distribution and display for architectural diagrams, training
materials or documentation, with additional usage restrictions and other
rights reserved. Do not infer blanket redistribution, trademark endorsement
or permission to use a product icon as this application's logo.

The owner approved retaining the existing Microsoft product icons under
their original terms. All 151 bundled SVGs were matched to the official packs
(with only BOM/line-ending differences where not byte-identical); see the
source inventory. These assets remain restricted to the permitted use.
This decision is not publication approval or endorsement of every possible
downstream use.
