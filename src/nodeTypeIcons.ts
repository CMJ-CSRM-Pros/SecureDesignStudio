import { resolveNodeTypeDef, type NodeTypeRef } from "./types";

const iconAssets = import.meta.glob<string>(
  "./assets/node-icons/**/*.svg",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

const GENERIC_ICON_KEY = "generic/component.svg";

export function nodeTypeIconUrlForKey(iconKey: string): string | undefined {
  return (
    iconAssets[`./assets/node-icons/${iconKey}`] ??
    iconAssets[`./assets/node-icons/${GENERIC_ICON_KEY}`]
  );
}

export function nodeTypeIconUrl(
  typeId: string,
  docNodeTypes?: readonly NodeTypeRef[],
): string | undefined {
  const iconKey =
    resolveNodeTypeDef(typeId, docNodeTypes)?.icon ?? GENERIC_ICON_KEY;
  return nodeTypeIconUrlForKey(iconKey);
}
