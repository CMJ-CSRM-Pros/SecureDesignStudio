import { useLibraries } from "../libraries/LibraryProvider";
import { metadataFieldsFor } from "../libraries/document";
import { useStore } from "../store";
import type { PsNode, PsEdge } from "../types";

export function LibraryMetadataFields({ entity, target }: { entity: PsNode | PsEdge; target: "node" | "edge" }) {
  const libraries = useLibraries();
  const { updateNode, updateEdge } = useStore();
  const fields = metadataFieldsFor(entity, target, libraries).filter(field => field.storage === "metadata");
  if (!fields.length) return null;
  return <fieldset className="ps-library-metadata">
    <legend>Custom metadata</legend>
    {fields.map(field => <label key={field.id}>
      {field.label}
      <input type="text" maxLength={4000} value={entity.metadata?.[field.id] ?? ""}
        onChange={event => {
          const patch = { metadata: { ...entity.metadata, [field.id]: event.target.value },
            metadataFields: fields.filter(candidate => candidate.id === field.id || Object.hasOwn(entity.metadata ?? {}, candidate.id)) };
          if (target === "node") updateNode(entity.id, patch);
          else updateEdge(entity.id, patch);
        }} />
      {field.description && <span className="ps-description-below">{field.description}</span>}
      {field.library && <span className="ps-description-below">
        {libraries.statuses.some(status => status.state === "loaded" && status.identity?.id === field.library?.id
          && status.identity?.version === field.library?.version)
          ? "Library" : "Saved definition; matching library unavailable"}: {field.library.id} @ {field.library.version}
      </span>}
    </label>)}
  </fieldset>;
}
