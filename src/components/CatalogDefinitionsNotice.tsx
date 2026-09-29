import { catalogDefinitionsFor } from "../types";
import { catalogDefinitionKey } from "../catalogDefinitions";
import { useStore } from "../store";

export function CatalogDefinitionsNotice() {
  const { doc, catalogSnapshotError, documentRecoveryError, classificationDefinitions } = useStore();
  const saved = doc.catalogDefinitions ?? [];
  if (documentRecoveryError) return <p className="ps-catalog-error" role="alert">{documentRecoveryError}</p>;
  if (catalogSnapshotError) return <p className="ps-catalog-error" role="alert">{catalogSnapshotError}</p>;
  if (!saved.length) return null;
  return (
    <details className="ps-catalog-snapshots">
      <summary>Saved catalog definitions ({saved.length})</summary>
      <p>
        Saved definitions apply only to this diagram and take precedence over
        installed labels. They do not install a library or verify security,
        compliance, or publisher identity. Unavailable IDs without a snapshot
        remain unresolved. Readers before 0.1.26 may discard these definitions.
      </p>
      <ul>
        {saved.map((definition) => {
          const installed = catalogDefinitionsFor(definition.kind, undefined, classificationDefinitions)
            .find((def) => def.id === definition.id);
          const conflict = installed && (installed.label !== definition.label
            || installed.description !== definition.description);
          return (
            <li key={catalogDefinitionKey(definition)}>
              <strong>{definition.label}</strong> ({definition.kind}: {definition.id})
              {" — "}{conflict ? "Differs from installed definition; saved definition retained."
                : installed ? "Saved in diagram." : "Document-only definition."}
              {definition.library && <span> Library metadata: {definition.library.id} @ {definition.library.version} (unverified).</span>}
              {definition.description && <p>{definition.description}</p>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
