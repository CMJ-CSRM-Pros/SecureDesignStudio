import React from "react";
import { clearAutosave, loadAutosaveRaw } from "../autosave";

// Last line of defence for render errors (audit S4). Without it React unmounts
// the whole tree and leaves a blank page, and a crafted model that reached
// autosave would crash the app again on every reload. The fallback never
// echoes the error text, which can carry model content.

interface State {
  failed: boolean;
  confirmingDiscard: boolean;
}

const box: React.CSSProperties = {
  maxWidth: "40rem", margin: "4rem auto", padding: "1.5rem", fontFamily: "system-ui, sans-serif",
  lineHeight: 1.5, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", color: "#0f172a",
};
const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" };

export class AppErrorBoundary extends React.Component<{ children?: React.ReactNode }, State> {
  state: State = { failed: false, confirmingDiscard: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Deliberately no logging of the error or component stack: both can
    // include model text, and the console may be captured by extensions.
  }

  reload = (): void => {
    window.location.reload();
  };

  downloadAutosave = (): void => {
    const bundle = loadAutosaveRaw();
    if (!bundle) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "secure-design-studio-autosave.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  requestDiscard = (): void => {
    this.setState({ confirmingDiscard: true });
  };

  confirmDiscard = (): void => {
    clearAutosave();
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={box}>
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>SecureDesignStudio stopped because of an error</h1>
        <p>
          Reload to try again. If the error comes back after every reload, the automatically saved model
          may be damaged. Download it first if you want to keep it, then discard it.
        </p>
        <div style={row}>
          <button type="button" onClick={this.reload}>Reload</button>
          <button type="button" onClick={this.downloadAutosave}>Download the autosaved model</button>
          {this.state.confirmingDiscard ? (
            <button type="button" onClick={this.confirmDiscard}>Confirm discard and reload</button>
          ) : (
            <button type="button" onClick={this.requestDiscard}>Discard the autosaved model</button>
          )}
        </div>
        {this.state.confirmingDiscard && (
          <p>This removes the autosaved model and its undo history from this browser. It cannot be undone.</p>
        )}
      </div>
    );
  }
}
