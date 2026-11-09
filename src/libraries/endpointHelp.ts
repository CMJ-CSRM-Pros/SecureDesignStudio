import type { LibraryHelp, LibraryRegistry } from "./contracts";

export const ENDPOINT_HELP_IDS = {
  instructions: "endpoint-import.instructions",
  example: "endpoint-import.example",
} as const;

interface SourcedHelp extends LibraryHelp {
  source: string;
}

export function endpointImportHelp(registry: LibraryRegistry): {
  instructions?: SourcedHelp;
  example?: SourcedHelp;
} {
  const resolve = (id: string): SourcedHelp | undefined => {
    const help = registry.help.find(item => item.id === id);
    if (!help) return undefined;
    const owner = registry.provenance[`help/${id}`];
    const status = registry.statuses.find(item => item.state === "loaded" && item.identity?.id === owner);
    if (!status?.identity) return undefined;
    return { ...help, source: `${status.identity.name} (${status.identity.id} @ ${status.identity.version})` };
  };
  return {
    instructions: resolve(ENDPOINT_HELP_IDS.instructions),
    example: resolve(ENDPOINT_HELP_IDS.example),
  };
}
