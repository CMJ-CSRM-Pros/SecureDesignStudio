export const AI_PROVIDER_IDS = ["azure", "claude", "codex"] as const;
export type AiProviderId = typeof AI_PROVIDER_IDS[number];

export interface AiProviderStatus {
  id: AiProviderId;
  label: string;
  available: boolean;
  message: string;
}

export interface AiProviderCapabilities {
  defaultProvider: AiProviderId;
  providers: AiProviderStatus[];
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && AI_PROVIDER_IDS.some(id => id === value);
}

export function parseAiProviderCapabilities(value: unknown): AiProviderCapabilities {
  const record = (input: unknown, keys: string[]): Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).length !== keys.length ||
        keys.some(key => !Object.prototype.hasOwnProperty.call(input, key))) {
      throw new Error("Invalid AI provider capabilities.");
    }
    return input as Record<string, unknown>;
  };
  const candidate = record(value, ["defaultProvider", "providers"]);
  if (!isAiProviderId(candidate.defaultProvider) || !Array.isArray(candidate.providers) ||
      candidate.providers.length !== AI_PROVIDER_IDS.length) {
    throw new Error("Invalid AI provider capabilities.");
  }
  const seen = new Set<AiProviderId>();
  const providers = candidate.providers.map(value => {
    const provider = record(value, ["id", "label", "available", "message"]);
    if (!isAiProviderId(provider.id) || seen.has(provider.id) ||
        typeof provider.available !== "boolean" ||
        typeof provider.label !== "string" || !provider.label.trim() || provider.label.length > 120 ||
        typeof provider.message !== "string" || !provider.message.trim() || provider.message.length > 1000) {
      throw new Error("Invalid AI provider capabilities.");
    }
    seen.add(provider.id);
    return { id: provider.id, label: provider.label, available: provider.available, message: provider.message };
  });
  return { defaultProvider: candidate.defaultProvider, providers };
}
