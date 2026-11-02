/// <reference types="vite/client" />

// Ambient declarations for build-time defines injected by vite.config.ts.
// These constants are inlined as literals by Vite, so dead branches are
// tree-shaken from the bundle.

// `true` only in the BUILD_SINGLE_FILE=1 build (dist-single/); `false`
// during `npm run dev` and the normal multi-file build. Used to gate
// features that only make sense in the self-contained distribution
// (e.g. the "Export as standalone HTML" file operation).
declare const __PS_SINGLE_FILE__: boolean;

// `true` only while Vite is serving the app for local development. Local-only
// mode is credential-free and deliberately disables every collaboration path.
declare const __PS_LOCAL_ONLY__: boolean;

// `true` only for the explicit `npm run dev:ai` workflow. Collaboration stays
// disabled, while Design Assistant may call the fixed localhost Functions API.
declare const __PS_LOCAL_AI__: boolean;

// Absolute URL of the Azure Function endpoint that mints short-lived,
// group-scoped Web Pub/Sub client access tokens. Empty disables collaboration.
// Always empty while Vite serves the local-only app.
declare const __PS_TOKEN_ENDPOINT__: string;

// Server-side Design Assistant URL (or same-origin path in hosted builds).
// Empty disables requests, including in credential-free local development.
declare const __PS_ASSISTANT_ENDPOINT__: string;

// Absolute URL of the deployment's hosted version of the diagrammer.
// Used by the Share button in the single-file build to construct
// share links that are usable by recipients (file:// URLs aren't —
// they only resolve on the sender's machine). Local-only serving fixes this to
// http://localhost:5173/, although sharing is disabled in that mode.
declare const __PS_PUBLIC_APP_URL__: string;

// Application version sourced from package.json by vite.config.ts.
declare const __PS_VERSION__: string;

declare const __SDS_LIBRARY_DELIVERY__: import("./libraries/contracts").LibraryDelivery;
declare const __SDS_SERVICE_SELECTION__: { source: string; error?: string };
