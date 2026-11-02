# Threat model of SecureDesignStudio itself

*Updated: 2026-11-02 - First version, based on the 2026-10 cross-platform and security audit.*

This page models the tool, not the systems you model with it. It is meant for
maintainers and for anyone who deploys or hosts SecureDesignStudio (SDS).
Finding IDs such as **S1** refer to the audit report (`audit/REPORT.md`, §6).
Report vulnerabilities through [SECURITY.md](../SECURITY.md), not through issues.

## System at a glance

SDS is a React single-page app that runs in a Chromium browser. There is no
Electron shell, no native installer and no IPC surface. It runs in one of
three ways:

- **Local:** `npm run dev` or a launcher starts the Vite dev server on
  `http://localhost:5173` (bound to `localhost`, `strictPort`). Models persist
  in browser storage only.
- **Standalone:** one self-contained HTML file (`dist-single/index.html`, or a
  model exported as application HTML) opened from disk.
- **Hosted (optional):** an Azure Static Web App (SWA) with two Azure Functions,
  `api/collab-token` and `api/design-assistant`.

Two features are off by default and need explicit configuration:
collaboration (Yjs over Azure Web PubSub) and the AI Design Assistant (Azure
OpenAI when hosted; Azure, Claude Code or Codex CLI when local).

## Assets

| Asset | Why it matters |
|---|---|
| Threat models (`.tma` and autosave) | Describe a system's architecture, weaknesses and open issues. Disclosure helps an attacker; tampering hides risk |
| Collaboration room key | Anyone holding the `#key=` URL fragment can read and edit the shared model |
| User's AI subscription or Azure deployment | Paid capacity; misuse costs money and sends model content to a provider |
| The user's machine (files, shell, credentials) | Reachable only if the local AI bridge or a CLI escapes its isolation |
| Integrity of exported artifacts | Reports and TM7/VSDX files are shared with reviewers who trust them |
| Hosted Azure resources and identities | Web PubSub, Azure OpenAI and the SWA managed identity |
| Build output and dependencies | What users actually run; the dev server is the end-user runtime |

## Trust boundaries

| ID | Boundary | Untrusted side |
|---|---|---|
| TB1 | Browser app ↔ model files and libraries | Any imported file: `.tma`, `.tm7`, `.tmc`, `.pmexp`, scenario JSON, custom libraries |
| TB2 | Browser app ↔ collaboration peers via Azure Web PubSub | Other room members and the relay service |
| TB3 | Local AI bridge on the Vite dev server ↔ browser pages and the `claude`/`codex` CLIs | Other web origins, other local processes, model text acting as a prompt, CLI output |
| TB4 | Hosted SWA and its API ↔ the internet | Anonymous and signed-in callers |
| TB5 | SDS ↔ readers of exported artifacts | Wherever a report, standalone HTML, `.tm7` or `.vsdx` ends up |
| TB6 | Source and dependencies ↔ the build | npm packages, GitHub Actions, contributors |

## Entry points

| Entry point | Boundary | Reached by |
|---|---|---|
| File open and import dialogs | TB1 | A user opening a file someone sent |
| Autosave and collaboration cache in browser storage | TB1, TB2 | Reloading the app |
| `SDS_LIBRARY_PATHS` library manifests | TB1 | Deployment configuration, read at dev-server start or build |
| Encrypted Yjs updates from the room | TB2 | Room members |
| `POST`/`GET /api/design-assistant` on the dev server (AI mode only) | TB3 | Browser pages and local processes |
| CLI stdout and event stream | TB3 | The provider's model response |
| `GET /api/collab-token` | TB4 | Anyone on the internet (anonymous) |
| `POST /api/design-assistant` (hosted) | TB4 | SWA-authenticated users |
| Exported HTML report, standalone HTML, `.tm7`, `.vsdx`, PNG | TB5 | Recipients opening them |
| `npm ci` and the CI workflow | TB6 | Package registry and Actions marketplace |

## Threats and mitigations

### TB1: model files and libraries

A malicious file can inject exactly what a collaboration peer can: both go
through `normalizeDoc` in `src/store.tsx`.

| STRIDE | Threat | Mitigation in place | Residual |
|---|---|---|---|
| Tampering, EoP | Script injection through text fields | React renders model text as text; no `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `window.open` in `src/` and `shared/` | None known |
| Tampering, EoP | `javascript:` or `data:` links in work items and references | `src/urlSafety.ts` allows only absolute `http`, `https` and `mailto` URLs; link render sites use it or an equivalent `http(s)` check. Import also drops dangerous schemes after removing control characters | None known (S1 fixed) |
| Info disclosure, DoS | XXE or entity expansion in `.tm7` | `<!DOCTYPE` and `<!ENTITY` are rejected before `DOMParser` runs (`src/tm7Import.ts`) | None known |
| Tampering | Zip slip or zip bomb | No user archive is ever extracted; `unzipSync` reads only the bundled Visio template | None |
| DoS | A non-string field (`"title": {}`) crashes rendering, and autosave keeps the bad model | `normalizeDoc` accepts only strings for rendered text (names, descriptions, comment and issue text, edge handles and notes) and only finite numbers for positions, waypoints, boundary sizes, edge numbers and timestamps (`src/store.tsx`). A top-level error boundary (`src/components/AppErrorBoundary.tsx`) replaces a blank page with Reload, Download autosave and a confirmed Discard | Fields outside `normalizeDoc`'s text and position checks rely on the error boundary (S4 fixed) |
| DoS | Catastrophic regex in a node type's `endpointRegex` (length-capped at 1000, compiled, then run on pasted text) | Length cap only | **S5, open**; reachability from document data unconfirmed |
| DoS, Tampering | Very large imports; `__proto__` keys | Prototype changes stay on a local object (no global pollution) | **S9, open** (Info; self-DoS only) |
| EoP | Custom library carries code | Libraries are declarative JSON only. Selected by deployment config, at most 16 paths, 1 MiB per manifest, 4 MiB total, resolved with `realpath` | Confidential libraries are baked into builds; see TB5 |

### TB2: collaboration peers

| STRIDE | Threat | Mitigation in place | Residual |
|---|---|---|---|
| Info disclosure | The relay or an eavesdropper reads the model | AES-256-GCM per message (`src/collab/crypto.ts`). The 32-byte key lives in the URL fragment, which browsers never send to a server; the key length is enforced on import | The service sees room IDs, timing and message sizes. A link pasted into chat or a ticket leaks the key |
| Spoofing, Repudiation | A key holder edits without attribution | None. Every key holder is a full, equal peer | Owner decision (S8) |
| Tampering | A peer sends a malformed model | Remote state goes through `normalizeDoc` (`src/collab/reconcile.ts`), so TB1 controls apply; undecryptable messages are dropped | The error boundary does not clear the room's IndexedDB cache; leaving the room link is the recovery |
| DoS | Outsiders flood a room | Messages without the key are dropped | No rate limit (S8) |
| Tampering | A local build is pointed at a third-party relay | Local Vite refuses a collaboration token endpoint or assistant endpoint override (`vite.config.ts`) | None |

### TB3: local AI bridge and CLIs

The bridge exists only in AI mode. It is Vite middleware on
`/api/design-assistant` that loads `api/design-assistant/index.ts` and spawns
the selected CLI through `api/design-assistant/localProviders.ts`.

| STRIDE | Threat | Mitigation in place | Residual |
|---|---|---|---|
| Spoofing (CSRF) | A web page makes the bridge spend the user's subscription | Every `POST` must carry `Origin: http://localhost:5173`; any other Origin is refused with 403. No wildcard CORS. The server binds `localhost`, and Vite's host check blocks DNS-rebinding hosts | A local non-browser process can send that Origin header. The bridge does not authenticate local processes |
| EoP | Prompt injection in model text makes the CLI run commands or read files | Claude: `--tools ""`, `--strict-mcp-config` with no servers, `--setting-sources ""`, hooks and connectors disabled, `--safe-mode`, `--restricted`. Codex: `shell_tool` and hooks disabled, `--sandbox read-only`, `--ephemeral`, user config and rules ignored. Any tool item in Codex's event stream voids the answer | Depends on the CLIs honouring their own flags |
| EoP | An old or policy-managed CLI ignores the isolation flags | The CLI's help output must list the required flags. Host-managed settings or policy abort the run instead of being overridden | None known |
| EoP | A planted `claude`/`codex` in the repository runs | Executables inside the repository are refused; `spawn` uses an absolute path and `shell: false` | A malicious binary elsewhere on PATH is out of scope |
| Info disclosure | The CLI picks up secrets or repository instructions | The child gets an allow-listed environment (no API keys, `NODE_OPTIONS`, proxies or config overrides) and runs in a fresh `mkdtemp` directory outside the repository. On macOS and Linux its `PATH` holds only the running Node's directory and the CLI's own directory | Model content goes to the chosen provider by design |
| Tampering | A crafted response changes the model | Responses are parsed against a strict schema and rendered as text; a failed validation applies nothing | Plausible but wrong suggestions; users review them |
| DoS | Oversized requests | 500,000-byte request cap in `scripts/local-ai-vite.mjs` | None |
| Info disclosure | Debug logs keep model content | Off by default. `SDS_AI_DEBUG=1` writes a temp file with mode `0600`; content is logged only with `SDS_AI_DEBUG_CONTENT=1` | The bridge does not delete the log file |
| Tampering, EoP | Vite dev-server advisories | Vite 8.3.5 (#22); CI audits all app dependencies | None known (S2 fixed) |

### TB4: hosted Static Web App and API

| STRIDE | Threat | Mitigation in place | Residual |
|---|---|---|---|
| Spoofing, EoP | Anyone uses the hosted assistant | SWA route allows only the `authenticated` role. The function calls Azure OpenAI with `DefaultAzureCredential`, so no key reaches the browser. Hosted requests may use only the `azure` provider | Function `authLevel` is `anonymous`; protection relies on the SWA route rule |
| Spoofing, DoS | Anyone gets a collaboration token | Room IDs must match `^[A-Za-z0-9_-]{6,64}$`; tokens grant join and send for one group and expire after 60 minutes | Anonymous, CORS `*`, no rate limit, `err.message` returned to the caller (S8) |
| Tampering, Info disclosure | Clickjacking, MIME sniffing, injected script on the hosted app | `staticwebapp.config.json` sends a CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src`/`base-uri 'none'`), `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The standalone build carries a meta CSP that pins its inline script by SHA-256 | `connect-src` allows any `https:`/`wss:` because endpoints are configured per deployment. The Vite dev server used by `npm run dev` has no CSP (S6 fixed for hosted and standalone) |
| EoP | Vulnerable API dependency | `@azure/identity` 4.14.1 (#24) brings a fixed `@azure/msal-node` (GHSA-xcx6-jx8p-x3h5). CI audits API production dependencies | None known (S3 fixed) |
| Info disclosure | Secrets committed | `api/local.settings.json` and `.env*` are ignored; only a template is tracked. The audit's gitleaks scan of all refs found nothing | None known |

### TB5: exported artifacts

| STRIDE | Threat | Mitigation in place | Residual |
|---|---|---|---|
| EoP | Stored XSS in the HTML review report when it is hosted on an intranet page | Model text is escaped with `escapeHtml`; work-item links are allow-listed; the report sets `default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'` | None known (S1 fixed) |
| EoP | Opening a standalone HTML file runs whatever code it contains | The user guide says to open only trusted standalone files | Inherent (S10). Exchange untrusted models as `.tma` |
| Tampering, DoS | A description containing `<!--<script>` makes an exported standalone file open without its model | The embedded JSON escapes every `<` and U+2028/U+2029 as unicode escapes (`src/embeddedDoc.ts`); a regression test covers it | None known (S7 fixed) |
| Tampering | Unescaped numbers in PNG-export SVG | The SVG renders through `<img>`, so it cannot run script | **S9, open** (Info) |
| Info disclosure | Exports carry more than intended | Exports hold the full model, including notes and justification. Builds and standalone files include every selected custom library | Users and deployers decide what to share |

### TB6: supply chain and build

| STRIDE | Threat | Mitigation in place | Residual |
|---|---|---|---|
| Tampering | A malicious or vulnerable npm package | Exact lockfile; CI runs `npm ci --ignore-scripts` and fails on high-severity advisories in all app dependencies (dev dependencies are runtime here) and in API production dependencies. The standalone inliner is repository code, not a plugin | The launchers run plain `npm ci` on users' machines, so install scripts run there |
| Tampering | A compromised GitHub Action | Every `uses:` is pinned to a commit SHA; the token has `contents: read`; checkout does not persist credentials | SHA pins need deliberate updates |
| Spoofing, Tampering | A user downloads a modified build | The release workflow builds from the version tag, publishes `SHA256SUMS`, a CycloneDX SBOM and a GitHub build-provenance attestation, and stops at a draft a maintainer reviews. [Verifying a release download](release-verification.md) explains the checks | Protects only users who run the checks. The workflow has not produced a release yet |
| Tampering | Line endings break shell scripts | `.gitattributes` keeps `*.sh` LF | None |

## Assumptions and out of scope

- The user's machine, browser and OS account are not compromised. Anything
  running as the user can already read browser storage.
- AI providers and their CLIs behave as documented. SDS limits what a CLI may
  do; it cannot verify the provider's own handling of the data sent to it.
- The content of models is the user's responsibility. SDS findings are review
  aids, not proof that a mitigation exists.
- Native installers, Electron and Tauri are not used. If that changes, this
  model needs a new boundary for the shell and its update channel.

## Open items

| ID | Severity | Status (2026-11-02 working tree) |
|---|---|---|
| S1 | Medium | Fixed: report link allow-list, import normalization, report CSP, regression test |
| S2 | High (advisory) | Fixed on `main` (#22): Vite 8.3.5; `npm audit` reports no advisories |
| S3 | Low | Fixed on `main` (#24): `@azure/identity` 4.14.1 |
| S4 | Low | Fixed: string and number checks across `normalizeDoc`, top-level error boundary; regression tests. In a standalone file the embedded model loads before autosave, so Discard can't remove a bad embedded model |
| S5 | Low | Open |
| S6 | Low | Fixed for hosted SWA (headers) and standalone (hashed meta CSP); dev server has none |
| S7 | Low | Fixed: every `<` in the embedded model is escaped; regression test |
| S8 | Low | Open, **owner decision** (below) |
| S9 | Info | Partly fixed: positions, sizes and timestamps must be finite numbers (with S4). Prototype keys and import size cap open |
| S10 | Info | Accepted and documented |

## Owner decision: hosted collaboration

Whether hosted collaboration is part of a public release, who operates the
Web PubSub resource, and whether anonymous token issuance is intended are
open questions for the project owner. Until they are answered, S8 stays open
and this page proposes no design. A deployment that enables collaboration
today accepts the TB2 and TB4 residuals above.
