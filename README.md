# SecureDesignStudio

**Public-source candidate documentation.** Publication and release clearance
are pending; this file does not announce an available release.

SecureDesignStudio is a browser-based workspace for privacy and security
data-flow modeling. Draw processes, flows and boundaries, organize scenarios,
record data/authentication/retention, review findings and compare saved models.

Core modeling and deterministic analysis work without cloud credentials.
Collaboration and the bring-your-own-AI Design Assistant are disabled unless a
deployer explicitly configures them. Custom Libraries can provide catalogs,
metadata, rules and help; selecting one does not enable services or grant
access.

## Run from a source checkout

Use Node 24 LTS and npm:

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173/`. Development runs only the local frontend and
requires that port to be free. On Windows, `.\Start-SecureDesignStudio.ps1`
also checks prerequisites and explains missing setup. Optional AI setup is
separate; see [bring your own AI](docs/bring-your-own-ai.md).

```powershell
npm run build
npm run test:runtime
npm run test:browser
```

The build produces normal `dist` and browser-openable `dist-single` output.
Browser checks need an installed Edge browser and use isolated synthetic
fixtures, not a personal profile. No build or test deploys the application.

## Model and interchange

Save `.tma` files for editable native models. **Import JSON format...** accepts
the documented scenario/DFD structure, not arbitrary JSON. **PMEXP import...**
reads a local inventory. TM7 and Visio exports are interchange formats with
documented losses; keep a native backup.

Read the [user guide](docs/user-guide.md), [advanced configuration](docs/advanced-configuration.md),
[Authentication Library](docs/authentication-library.md),
[Classification Library](docs/classification-library.md), and
[Custom Libraries](docs/custom-libraries.md) contracts.

## Contribute and review

Follow [contributing and validation](docs/contributing.md) and the
[browser test guide](tests/browser/README.md). Keep synthetic fixtures and
preserve stable IDs, imports/exports and Undo. Companion agent integrations
are not prerequisites for building or testing the shared application.

Project-authored public source is licensed under [MIT](LICENSE), copyright
Microsoft Corporation. Third-party code and Microsoft product icons retain
their own licenses and terms; see [third-party notices](docs/third-party-notices.md).
The project license does not relicense those components or grant trademark rights.
The tool supports review decisions; it does not certify a model's security,
privacy compliance or deployment state.
