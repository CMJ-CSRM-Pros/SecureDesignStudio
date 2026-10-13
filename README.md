# SecureDesignStudio

**Spend less time preparing diagrams and more time improving designs.**

SecureDesignStudio is a **Windows application**, to
make security and privacy reviews simpler. It runs locally in **Microsoft Edge
or Google Chrome**, bringing clear diagrams, service context, analysis, and
review decisions together in one browser workspace.
For teams considering a move beyond Microsoft Threat Modeling Tool, it offers
a modern replacement option with import and export support for existing
`.tm7` diagrams.

**[Get started on Windows](#get-started-on-windows)** to install the tools and
create your first model. No Azure account or AI service is needed for local
modeling and analysis.

## From service context to a review-ready design

- **Start with what you already know.** Import existing `.tm7` models,
  documented scenario/DFD JSON, or local PMEXP inventory data instead of
  re-entering it. JSON import replaces the model; PMEXP merges data and
  retention into an existing scenario. See the import/export limits below.
- **Create clean, easy-to-follow designs.** Use the Microsoft cloud node
  catalog, show security and privacy boundaries, and organize a complex system
  into focused scenarios. Switch between the diagram and sequence view to
  explain both the architecture and the order of its calls.
- **Keep security and privacy in the same conversation.** Capture
  authentication, data classifications, and retention alongside each flow.
  Record findings, comments, decisions, and follow-up work in the model.
- **Analyze as you review.** Built-in local checks highlight missing
  information and policy inconsistencies. An optional, bring-your-own-AI
  Design Assistant helps explore the design and suggests findings for you to
  assess, not automatically accept.
- **See what changed over time.** Save review snapshots and compare the
  current model with a previous version, so the next review can focus on what
  changed rather than start from scratch.
- **Share the output your review needs.** Export Visio diagrams, `.tm7` diagrams for Threat Modeling Tool, HTML review
  reports, or PNG images. Keep the native `.tma` model for future edits and
  reviews. Formats have different limits; Visio export is not an importer,
  and TM7 does not preserve all native privacy and access-rights details.
- **Start small, work together when needed.** Core modeling and analysis run
  locally without an Azure account or AI service. Collaboration-enabled
  builds let reviewers work on the same model together.


**[Read the user guide](docs/user-guide.md)** for the complete journey from a
first model to analysis, sequence view, and importing or exporting work.
See [import/export limitations](docs/user-guide.md#7-import-and-export).
The tool supports review decisions; it does not inspect live deployments or
certify security, privacy or regulatory compliance.

## Get started on Windows

### 1. Install Git and Node.js (includes npm)

Open the Windows Start menu, type **PowerShell**, and open it. Windows
PowerShell is included with Windows; a PowerShell tab in Windows Terminal
also works.

You need **Git** to download the app and **Node.js 24 LTS** to run it.
**npm comes with Node.js**: it downloads the app's dependencies and runs the
startup commands. Do not install npm separately.

If Windows Package Manager (`winget`) is available, run:

```powershell
winget install --id Git.Git --exact --source winget
winget install --id OpenJS.NodeJS.LTS --exact --source winget
```

Otherwise, download the official [Git for Windows installer](https://git-scm.com/install/windows)
and [Node.js 24 LTS installer](https://nodejs.org/en/download). Keep npm
selected and let the installers add the tools to PATH, so Windows can find
their commands. Follow your organization's installation process if approval
is required.

Close and reopen PowerShell after installation, then check:

```powershell
git --version
node --version
npm.cmd --version
```

Each command should print a version; Node should show `v24.x.x`. `npm.cmd`
is the Windows npm command and avoids PowerShell's script wrapper.

### 2. Download and start the app

Run these lines in order. Stop and read any error before continuing.
The public repository can be cloned without a GitHub sign-in.

```powershell
New-Item -ItemType Directory -Force "$HOME\source" | Out-Null
Set-Location "$HOME\source"
git clone https://github.com/microsoft/SecureDesignStudio.git
Set-Location .\SecureDesignStudio
.\Start-SecureDesignStudio.ps1
```

The launcher checks Node.js/npm and port 5173, installs dependencies on first
run, and starts the local server. The first installation needs internet access
and can take a few minutes.

### 3. Open the app and create a model

Open **<http://localhost:5173/>** in Edge or Chrome once startup completes.
The launcher prints the address; it does not open the browser for you.
Keep the terminal open while working. Press **Ctrl+C in that terminal** to
stop the server.

1. Enter a name in **Create your first scenario** and choose **Create**.
2. Right-click the canvas > **New Node** to add services. Drag between node
   handles to connect them, then use the inspector to describe each flow.
3. Choose **Review > Analyze** to find missing information and inconsistencies.
4. Choose **File > Save as > SecureDesignStudio model (.tma)** to save an
   editable model. **Autosave is recovery, not backup.**

Follow the [first-model walkthrough](docs/user-guide.md#3-simple-how-to) for
a complete example, or open a [synthetic sample model](samples/README.md).

This mode needs no Azure account, application credentials, API, MCP server,
or deployment. Collaboration and Design Assistant stay disabled. After the
initial install and page load, editing, analysis, autosave, and local file
operations work offline; external help links still need a connection.

Next time, open PowerShell and run:

```powershell
Set-Location "$HOME\source\SecureDesignStudio"
.\Start-SecureDesignStudio.ps1
```

### If setup gets stuck

| Problem | What to do |
|---|---|
| Git, Node, or npm is not recognized | Reopen the terminal after installation. Check that the installers added the tools to PATH and that npm was included with Node.js. |
| PowerShell blocks the launcher or `npm.ps1` | Use the `npm.cmd` commands below; do not weaken execution policy. |
| Port 5173 is busy | Stop your own previous server with Ctrl+C in its terminal. Otherwise coordinate with the process owner; do not kill an unfamiliar process. The app will not silently use another port. |
| The browser cannot connect | Check the terminal for startup errors, leave it open, and use exactly `http://localhost:5173/`. |
| Dependency installation fails | Check the reported error and your organization's approved internet/proxy access. Do not bypass certificate or network controls. |

If PowerShell blocks scripts, install and start directly from the downloaded
repository instead of using the launcher:

```powershell
Set-Location "$HOME\source\SecureDesignStudio"
npm.cmd ci
npm.cmd run dev
```

Run the last line only after installation succeeds. This leaves execution
policy unchanged but skips the launcher's prerequisite checks. If your
organization blocks Node/npm themselves, ask your IT administrator.

After an update that changes `package-lock.json`, stop your own server and
run `npm.cmd ci` before restarting. The launcher installs dependencies only
when `node_modules` is absent. See the
[safe update and standalone HTML guidance](docs/user-guide.md#2-how-to-install-and-run).

## Start with AI (optional)

The AI Design Assistant is **bring your own AI**: no model service ships with
this app, and none is provided for you. Use an authorized Azure deployment,
Claude Code with your Claude subscription, or Codex CLI with your ChatGPT
subscription. Claude and Codex use a local Vite bridge and need no Azure
Functions installation; Azure uses Azure Functions Core Tools plus an Azure
identity and deployment.

```powershell
.\Start-SecureDesignStudio-WithAI.ps1                 # interactive provider menu
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Claude
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Codex
```

Install and sign into the official CLI first: `claude auth login` for Claude,
or `codex login` with ChatGPT for Codex. Subscription access is not general API
access. API-key billing and another provider are never substituted. Startup
checks sign-in without inference. Missing tools/sign-in produce setup guidance.
The **AI provider** selector in both AI surfaces is shared; **Refresh providers**
rechecks availability after setup. Switching starts a new conversation without
changing the diagram. A remembered UI choice is reused with the same launcher
default; choosing a different launcher default resets it.

For Azure, configure your own deployment and sign in:

```powershell
$env:AZURE_OPENAI_ENDPOINT = "https://<your-resource>.openai.azure.com"
$env:MODEL_DEPLOYMENT_NAME = "<your-model-deployment-name>"
az login
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Azure
```

To check your AI connection before starting, use this command instead:

```powershell
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Azure -VerifyEndpoint
```

Look for **`Endpoint reachable.`** in the terminal: the configured deployment
accepted a small test request using your Azure CLI sign-in. If the probe fails,
the launcher warns about the connection problem but still starts the app;
startup alone does not mean AI is connected. A passing probe confirms endpoint
access, not full compatibility with every Design Assistant feature. See
[Verify and troubleshoot](docs/bring-your-own-ai.md#7-verify-and-troubleshoot)
if the probe or assistant fails.

**[Bring your own AI](docs/bring-your-own-ai.md)** walks through creating that
Azure OpenAI instance and securing it properly — disabling key authentication
with `disableLocalAuth`, restricting network access, and assigning the
data-plane role the app needs.
AI requests send active-scenario context to the configured service; review the
[data handling guidance](docs/advanced-configuration.md) before using it.

| Script | What you need |
|---|---|
| `.\Start-SecureDesignStudio.ps1` | Git and Node.js. No cloud account. |
| `.\Start-SecureDesignStudio-WithAI.ps1` | The above plus your selected provider. Claude/Codex need an installed, subscription-authenticated CLI. Azure additionally needs Azure Functions Core Tools, Azure CLI, and an authorized deployment. |

## References

- [Authentication Library](docs/authentication-library.md): shared profile
  library, portable definitions, JSON contract, and older-file compatibility.
- [Classification Library](docs/classification-library.md): customize data
  categories and move them between browser profiles.
- [Custom Libraries](docs/custom-libraries.md): optional catalogs, metadata,
  checks, and help. Selecting a library does not enable services or grant access.
- [Microsoft cloud node catalog](docs/microsoft-cloud-node-catalog.md):
  service types, policy limitations, official sources, and icons.
- [Bring your own AI](docs/bring-your-own-ai.md): create and secure the Azure
  OpenAI instance the optional Design Assistant needs.
- [Advanced configuration](docs/advanced-configuration.md): optional AI,
  collaboration, browser recovery, and the implementation map.

## Contributing

This is an open-source project, and contributions are welcome: improve a workflow, add a service
type, sharpen a review rule, fix a bug, or make the docs easier to follow.
Share what would make your next review simpler, or open a pull request.

Use the [contributor guide](docs/contributing.md) for local validation and
[SECURITY policy](SECURITY.md) for reporting vulnerabilities. Public
first-party source is licensed under [MIT](LICENSE), copyright Microsoft
Corporation. [Third-party components, Microsoft icons and the Visio template](docs/third-party-notices.md)
retain their separate terms; the project license grants no trademark rights.


## Recent changes

- Version 1.0.31 scopes Design with AI requests with two-phase component planning, so large libraries no longer exceed Azure token-per-minute limits.
- Designer recovers valid edits when a model returns an empty flow order, and -DebugAI reports request sizing.
- The local Azure proxy reports a clear diagnostic while the Functions API is still starting.

- Version 1.0.27 adds shared Azure/Claude/Codex selection through the local AI launcher.
- AI design authoring, refinement, deletion/rerouting and flow ordering apply as complete undoable edits.
- Editable node-type AI guidance and restored Power Platform catalog types support both AI surfaces.
- Boundary dragging is perimeter-only, and custom metadata follows issues in Properties.

- Version 1.0.15 refreshes five fictional reference models and all 11 scenarios
  with concrete services, operation-scoped authorization and classified data.
- DFD roles distinguish Processes, Data Stores and External Interactors,
  including Azure SQL's Data Store default and scenario-scoped review reasons.
- Authored review concerns, flow access-rights fields and network-boundary
  intent retain the distinction between requirements and verified controls.
- Windows launchers check prerequisites and provide a separate optional AI path.
- Custom Libraries add catalogs, metadata, checks, and help without granting access.
- Authentication and Classification Library editors make model vocabulary reusable.
- Saved node metadata is preserved; applying type defaults is explicit and undoable.
- Native models carry saved catalog definitions and custom metadata into later reviews.
- Scenario/DFD JSON and PMEXP inventory imports make existing work easier to reuse.
- Compare to previous highlights changes without replacing the current model.
- Collaboration and AI remain off unless explicitly configured.
