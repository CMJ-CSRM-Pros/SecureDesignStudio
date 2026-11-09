# SecureDesignStudio

**Spend less time preparing diagrams and more time improving designs.**

SecureDesignStudio is a **Windows application for simpler security and privacy
reviews**, running locally in **Microsoft Edge or Google Chrome**. It brings
diagrams, service context, analysis, and review decisions together so engineers,
service owners, and security/privacy reviewers can work from the same design.
For teams moving beyond Microsoft Threat Modeling Tool, existing **`.tm7`
import and export** support provides a starting point without redrawing every
model.

It is a browser-based workspace, not a native desktop installer. In the supported,
documented Windows setup, you start a local server and open the app in your browser.

**[Get started on Windows](#get-started-on-windows)**

No Azure account or AI service is needed for local modeling and analysis.

## From service context to a review-ready design

- **Start with what you have.** Import existing TM7 models, JSON in the
  documented scenario/DFD `scenarios` and `dfds` structure, or local PMEXP
  inventory data. JSON import replaces the model; PMEXP merges data and
  retention into mapped or created nodes and requires an existing scenario.
- **Make complex flows easier to explain.** Use the cloud node catalog,
  security/privacy boundaries, and shared components to build clear diagrams.
  Group workflows into scenarios, then switch between Diagram and Sequence
  views to walk through call order.
- **Keep security and privacy together.** Describe authentication, identity
  evidence, request/response data, classifications, and retention alongside
  the architecture. Customize authentication and classification libraries
  without editing source code.
- **Focus review effort.** Local **Analyze** checks flag missing information
  and inconsistencies across the document. Record findings, comments, and work
  items with the model. An optional, separately configured AI assistant offers
  suggestions for human review, not automatic approval.
- **Keep review context across revisions.** Save named `.tma` review snapshots
  and use **File > Compare to previous** and **Review > Changes** to compare
  without replacing current work. Native models preserve referenced catalog
  definitions and custom metadata.
- **Share the right output.** Export Visio or TM7 diagrams, HTML review
  reports, and PNG diagram images. Each format has limits; retain a native
  **`.tma`** as the editable backup. Visio export is not a Visio importer.
- **Work locally; connect only when configured.** Normal local mode needs no
  application backend or cloud credentials. Modeling and analysis run in the
  browser; after the first dependency installation and page load, editing,
  analysis, autosave, and local file operations work offline. Collaboration
  requires an explicitly configured deployed/standalone build and is not
  enabled by the normal local launcher.

The tool supports review decisions; it does not inspect live deployments or
certify security or privacy compliance. Missing definitions and rules still
need review: **Not re-evaluated** means a retained finding has not been refreshed,
not that the design passed. External help links and optional network features
require connectivity.

See the [user guide](docs/user-guide.md) for the review workflow and
[import/export limitations](docs/user-guide.md#7-import-and-export).

## Get started on Windows

### 1. Install Git and Node.js (includes npm)

Use a current Windows 10/11 computer and Edge or Chrome. **Windows PowerShell
is included with Windows**: open Start, type `PowerShell`, and open it.
You can also use a PowerShell tab in Windows Terminal. You do not need a
separate PowerShell installation to follow these steps.

Install **Git** to download the repository and **Node.js 24 LTS** to run the
local app toolchain. Node.js includes **npm**, the package manager that
downloads the app's dependencies and runs its startup commands; you do not
install npm separately.

If Windows Package Manager (`winget`) is available, run:

```powershell
winget install --id Git.Git --exact --source winget
winget install --id OpenJS.NodeJS.LTS --exact --source winget
```

If `winget` is unavailable or you prefer installers, use the official
[Git for Windows installer](https://git-scm.com/install/windows) and
[Node.js download page](https://nodejs.org/en/download). Choose **Node.js 24 LTS**
for Windows, keep npm selected, and let the installers add the tools to PATH
(the list of folders Windows searches for commands). Follow your organization's
software-installation process if administrator approval is required.

**Close and reopen PowerShell or Windows Terminal after installation**, then
verify all three tools:

```powershell
git --version
node --version
npm.cmd --version
```

Each command should print a version; Node should report `v24.x.x`. `npm.cmd`
is the Windows command for npm and avoids PowerShell's `npm.ps1` script wrapper.
If a command is not found or Node is a different major version, resolve that
before continuing; see [If setup gets stuck](#if-setup-gets-stuck).

### 2. Download and start the app

Run these lines in order in PowerShell. They create a `source` folder in your
user profile, clone the **public repository**, and start the root launcher.
No GitHub sign-in is required to clone it. Stop and read any error before
continuing to the next line.

```powershell
New-Item -ItemType Directory -Force "$HOME\source" | Out-Null
Set-Location "$HOME\source"
git clone https://github.com/microsoft/SecureDesignStudio.git
Set-Location .\SecureDesignStudio
.\Start-SecureDesignStudio.ps1
```

The launcher checks Node.js/npm and port 5173, installs dependencies with
`npm ci` when `node_modules` is absent or direct dependencies are missing or
incompatible, and starts the local server. The first
installation requires internet access and can take a few minutes. No Azure
sign-in or AI setup is part of this path.

### 3. Open the app and create a model

When startup completes, **open <http://localhost:5173/> yourself in Edge or
Chrome**. The launcher prints the address; it does not open a browser for you.
Keep the terminal open while using the app. Press **Ctrl+C in that terminal**
to stop the server.

Try a small, synthetic **Submit a support case** workflow:

1. In **Create your first scenario**, enter `Submit a support case` and choose
   **Create**. Use **Model > New scenario** if a model is already open.
2. Right-click blank canvas > **New Node** to add `Support web` and
   `Support API`. In **Properties > General / Security**, choose **App Service app**
   for each, then drag between node handles to connect them. Record known
   authentication; do not invent evidence for unknown details.
3. Use **Model > Data Elements > Add data item** to define `Case text` with
   synthetic or blank Sample data. Attach it to the flow under
   **Privacy > Data in request**. Choose **Review > Analyze**, review the
   receiving node's **Privacy** retention settings, and inspect **Review > Issues**.
4. Save through **File > Save as > SecureDesignStudio model (.tma)**.
   Use **File > Open** to reopen the file, and **View > Sequence** to walk
   through calls in order.

For a ready-made starting point, open a [synthetic sample model](samples/README.md)
with **File > Open**. The [user guide](docs/user-guide.md#3-simple-how-to)
extends this example with boundaries, retention, comments, and follow-up.

**Autosave is recovery, not backup.** Save `.tma` files regularly and before
replacing, importing, or sharing a model. Keep real personal information and
secrets out of practice models, and review model contents before sharing.

For later sessions, open PowerShell and run:

```powershell
Set-Location "$HOME\source\SecureDesignStudio"
.\Start-SecureDesignStudio.ps1
```

### If setup gets stuck

| Problem | What to do |
|---|---|
| `git`, `node`, or `npm` is not recognized | Reopen the terminal after installation. Check the installers' PATH options; reinstall Node.js with npm if npm is missing. Use `Get-Command git,node,npm.cmd` to see which commands Windows finds. |
| Node is too old or the wrong major version | Install Node.js 24 LTS, reopen the terminal, and check `node --version`. If you already use a Node version manager, select 24 through that manager rather than mixing installations. |
| `npm.ps1` cannot be loaded, or running scripts is disabled | Use the manual `npm.cmd` steps below instead of weakening PowerShell execution policy. These also avoid running the `.ps1` launcher. |
| Port 5173 is already in use | The app requires this exact port and will not silently choose another. If it is your own previous server, use that terminal's Ctrl+C. Otherwise inspect `Get-NetTCPConnection -LocalPort 5173 -State Listen` and coordinate with its owner; do not kill an unfamiliar process. |
| The browser cannot connect | Keep the startup terminal open, check it for errors, and use exactly `http://localhost:5173/`. Startup must finish successfully before the page can load. |
| Dependency installation fails | Check internet/proxy access and the error in the terminal. Use your organization's approved package access; do not bypass certificate or network controls. After resolving the cause, retry `npm.cmd ci` from the repository folder. |

If PowerShell blocks the launcher or npm's script wrapper, run these commands
from your downloaded repository instead. They perform the install and startup
directly, without the launcher's prerequisite checks:

```powershell
Set-Location "$HOME\source\SecureDesignStudio"
npm.cmd ci
npm.cmd run dev
```

Only run the final command after installation succeeds. Open the same local URL
manually and keep the terminal open. This does not change execution policy;
if organizational application controls block Node/npm themselves, ask your IT
administrator rather than bypassing them.

After an update that changes `package-lock.json`, stop your own server and run
`npm.cmd ci` before restarting to restore the exact locked versions. The launcher
reuses healthy direct dependencies and repairs missing or incompatible ones. See the
[safe update guidance](docs/user-guide.md#update-an-existing-clone-safely).

## Get started on macOS or Linux

Install Git and Node.js 24 LTS. A version manager such as
[nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm)
installs official Node builds. Clone the repository, then start the app from its
folder:

```sh
./start-securedesignstudio.sh
```

The launcher makes the same checks as the Windows launcher: Node version, a free
port 5173, and installed direct dependencies. It runs `npm ci` on first run or
when dependencies are missing or incompatible, then serves the app at
`http://localhost:5173/`. `npm run start` does the same from any shell,
Windows included. The checks are in `scripts/launch.mjs`.

For the optional AI assistant (see the next section), run
`./start-securedesignstudio-with-ai.sh --provider <azure|claude|codex>`, or
`npm run start:ai -- --provider <name>`. Use `--help` to list the options. They
match the PowerShell switches, for example `--diagnose-provider` for
`-DiagnoseProvider`. Claude and Codex readiness needs a Node build with
TypeScript type stripping. Some Linux distribution packages of Node (Debian,
Ubuntu, Kali) are built without it, even on Node 24. In that case the launcher
says so; install Node through a version manager instead.

Browser tests on macOS and Linux need `SDS_TEST_BROWSER_CHANNEL=chrome`.

## Start with AI (optional)

**Skip this section for normal local use.** The Design Assistant's Chat and AI
Analysis are separate from local **Analyze**. No AI model service, subscription,
or shared deployment is bundled with SecureDesignStudio.

To opt in, choose **Azure**, **Claude**, or **Codex** with
`.\Start-SecureDesignStudio-WithAI.ps1 -Provider <Azure|Claude|Codex>`.
Azure requires your authorized OpenAI/Foundry deployment, Azure CLI sign-in,
and Azure Functions Core Tools. Claude and Codex use their official CLI with
an eligible subscription; they use a local Vite bridge and do not require
Azure credentials or Functions. You or your organization must arrange provider
access and cover any applicable costs. Follow [bring your own AI](docs/bring-your-own-ai.md)
and [advanced configuration](docs/advanced-configuration.md) before enabling
it. AI requests send active-scenario context to the selected provider; review
the documented data handling first and assess suggestions before turning them
into review decisions.

**Collaboration and the Design Assistant are off by default.** Normal local
mode keeps both disabled; the separate local AI workflow enables only the
Assistant. **About** shows the effective service configuration.
Custom Libraries can add catalogs, metadata, checks, and help, but **do not
enable services or grant access**.

## References

- [User guide](docs/user-guide.md) and [sample models](samples/README.md)
- [Authentication Library](docs/authentication-library.md) and
  [Classification Library](docs/classification-library.md)
- [Custom Libraries](docs/custom-libraries.md) and
  [cloud node catalog](docs/microsoft-cloud-node-catalog.md)
- [Saved-model compatibility](docs/model-compatibility.md) and
  [portable catalog definitions](docs/catalog-snapshots.md)
- [Bring your own AI](docs/bring-your-own-ai.md) and
  [advanced configuration](docs/advanced-configuration.md)

## Contributing

Contributions to code, documentation, and synthetic examples are welcome.
Start with [contributing and validation](docs/contributing.md) and the
[browser test guide](tests/browser/README.md). **Builds and tests are contributor
tasks, not first-run requirements.** Preserve stable IDs, imports/exports, and
Undo, and keep real data out of test fixtures. Report vulnerabilities according
to [the security policy](https://github.com/microsoft/SecureDesignStudio/security/policy).

Project-authored public source is licensed under [MIT](LICENSE), copyright
Microsoft Corporation. Third-party code and Microsoft product icons retain
their own licenses and terms; see [third-party notices](docs/third-party-notices.md).
The project license does not relicense those components or grant trademark rights.

## Recent changes

- Windows root launchers provide prerequisite checks and a separate opt-in AI path.
- Custom Libraries add optional catalogs, metadata, checks, and help without granting access.
- Authentication and Classification Library editors support reusable, customizable vocabularies.
- Inventory ID accepts ordinary text; stored node metadata is preserved unless explicitly changed.
- Saved catalog definitions and custom metadata travel with native models and appear in comparisons.
- Scenario/DFD JSON and local PMEXP imports expand model reuse.
- Compare to previous supports review of saved model snapshots without replacing current work.
- Unavailable rules retain findings as **Not re-evaluated** rather than implying a clean review.
- Collaboration and AI services require explicit configuration and remain off by default.
