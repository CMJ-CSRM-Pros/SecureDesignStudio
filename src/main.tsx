import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { capturePristineHtml } from "./embeddedDoc";
import { bootstrapLibraries } from "./libraries/bootstrap";
import { LibraryProvider } from "./libraries/LibraryProvider";

// Capture the HTML as the browser parsed it, BEFORE React mounts. The
// "Export as standalone HTML" file operation reuses this snapshot so
// the exported file isn't polluted with React's runtime DOM mutations
// (data attributes, dynamic classes, in-flight portals, etc.).
capturePristineHtml(document.documentElement.outerHTML);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

bootstrapLibraries(__SDS_LIBRARY_DELIVERY__, __PS_LOCAL_ONLY__, location.href).then(registry => {
  createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <LibraryProvider registry={registry}>
          <App />
        </LibraryProvider>
      </AppErrorBoundary>
    </React.StrictMode>
  );
});
