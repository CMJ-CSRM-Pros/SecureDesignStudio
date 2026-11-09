export const SECURE_DESIGN_STUDIO_DOCUMENT_FORMAT =
  "secure-design-studio-diagram" as const;
export const SECURE_DESIGN_STUDIO_NODE_CATALOG_FORMAT =
  "secure-design-studio-node-catalog" as const;

// Existing .tma and node-catalog files remain importable. Importers are
// intentionally shape-tolerant, so these aliases document the compatibility
// contract without requiring users to rewrite saved artifacts.
export const LEGACY_DOCUMENT_FORMAT = "privsec-diagram" as const;
export const LEGACY_NODE_CATALOG_FORMAT = "privsec-node-catalog" as const;
