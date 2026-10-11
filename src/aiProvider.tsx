import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isAiProviderId, parseAiProviderCapabilities, type AiProviderCapabilities, type AiProviderId } from "../shared/aiProviders";
import { SERVICES } from "./services";

const PREFERENCE_KEY = "secure-design-studio:ai-provider:v1";
const localSelection = __PS_LOCAL_AI__ && SERVICES.assistant.enabled;

const AiProviderContext = createContext<{
  provider: AiProviderId | undefined;
  capabilities: AiProviderCapabilities | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  pending: number;
  select: (provider: AiProviderId) => void;
  refresh: () => void;
  beginRequest: () => () => void;
} | null>(null);

export function AiProviderProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<AiProviderId>();
  const [capabilities, setCapabilities] = useState<AiProviderCapabilities | null>(null);
  const [loading, setLoading] = useState(localSelection);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  const initialized = useRef(false);

  useEffect(() => {
    if (!localSelection) return;
    const controller = new AbortController();
    let timerExpired = false;
    const timer = window.setTimeout(() => { timerExpired = true; controller.abort(); }, 15_000);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(SERVICES.assistant.endpoint, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`AI provider readiness check failed (${response.status}). Restart the AI launcher and retry.`);
        const result = parseAiProviderCapabilities(await response.json());
        if (controller.signal.aborted) return;
        setCapabilities(result);
        if (!initialized.current) {
          let initial = result.defaultProvider;
          try {
            const saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "null");
            if (saved !== null && (!isAiProviderId(saved.defaultProvider) || !isAiProviderId(saved.provider))) {
              throw new Error("Invalid AI preference.");
            }
            if (saved?.defaultProvider === result.defaultProvider && isAiProviderId(saved.provider)) initial = saved.provider;
          } catch {
            setError("The saved AI preference could not be read. Using the launcher's initial provider.");
          }
          setProvider(initial);
          initialized.current = true;
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setCapabilities(null);
          setError(cause instanceof Error ? cause.message : "AI provider readiness check failed.");
        } else if (timerExpired) {
          setCapabilities(null);
          setError("AI provider readiness check timed out. Restart the AI launcher and retry.");
        }
      } finally {
        window.clearTimeout(timer);
        if (!controller.signal.aborted || timerExpired) setLoading(false);
      }
    })();
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [revision]);

  const select = (next: AiProviderId) => {
    if (pendingRef.current || !capabilities?.providers.some(item => item.id === next && item.available)) return;
    setProvider(next);
    setError(null);
    try {
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ provider: next, defaultProvider: capabilities.defaultProvider }));
    } catch {
      setError("The AI preference could not be saved. This selection applies only while the app stays open.");
    }
  };
  const beginRequest = () => {
    if (localSelection && (!provider || loading || !capabilities?.providers.some(item => item.id === provider && item.available))) {
      throw new Error("The selected AI provider is not ready. Check its setup and refresh providers.");
    }
    pendingRef.current++;
    setPending(pendingRef.current);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      pendingRef.current--;
      setPending(pendingRef.current);
    };
  };
  return <AiProviderContext.Provider value={{
    provider: localSelection ? provider : undefined, capabilities, loading, error, pending,
    ready: SERVICES.assistant.enabled && (!localSelection || (!loading && Boolean(capabilities?.providers.some(item => item.id === provider && item.available)))),
    select, refresh: () => { if (!pendingRef.current) setRevision(current => current + 1); }, beginRequest,
  }}>{children}</AiProviderContext.Provider>;
}

export function useAiProvider() {
  const value = useContext(AiProviderContext);
  if (!value) throw new Error("AI provider controls require AiProviderProvider.");
  return value;
}
