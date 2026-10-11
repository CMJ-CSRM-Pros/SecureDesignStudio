import { useId } from "react";
import { isAiProviderId } from "../../shared/aiProviders";
import { useAiProvider } from "../aiProvider";

export function AiProviderSelector() {
  const id = useId();
  const { provider, capabilities, loading, error, pending, select, refresh } = useAiProvider();
  if (!__PS_LOCAL_AI__) return null;
  const selected = capabilities?.providers.find(item => item.id === provider);
  return <div className="ps-ai-provider">
    <label htmlFor={id}>AI provider</label>
    <div className="ps-ai-provider-controls">
      <select id={id} aria-describedby={`${id}-notice`} value={provider ?? ""}
        disabled={loading || pending > 0 || !capabilities}
        onChange={event => { if (isAiProviderId(event.target.value)) select(event.target.value); }}>
        {!provider && <option value="">Checking providers...</option>}
        {capabilities?.providers.map(item => <option key={item.id} value={item.id} disabled={!item.available}>
          {item.label}{!item.available ? " (unavailable)" : ""}
        </option>)}
      </select>
      <button type="button" disabled={loading || pending > 0} onClick={refresh}>Refresh providers</button>
    </div>
    <p id={`${id}-notice`} role="status">{loading ? "Checking installed providers and sign-in..." : selected?.message}</p>
    {capabilities?.providers.filter(item => !item.available && item.id !== provider).map(item =>
      <p key={item.id}>{item.label}: {item.message}</p>)}
    <p>Prompts and included model context go to the selected provider. Claude and Codex use your subscription allowance.
      Switching providers starts a new conversation; it does not change the diagram.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
