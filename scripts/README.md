# Runtime and build helpers

These scripts support ordinary application development and explicit service
or library configuration:

- `custom-libraries.mjs`: bounded local library selection for Vite builds.
- `service-configuration.mjs`: explicit service-file selection and build receipt
  verification; it does not deploy.
- `distribution-license.mjs`: carries the distribution's explicitly selected
  root license into built/exported HTML.
- `configure-local-ai.mjs`: setup for the separately selected local AI workflow.
- `launcher-common.ps1`: shared Windows launcher prerequisite checks.
- `launch.mjs`: cross-platform launcher behind `npm run start`/`start:ai` and
  the POSIX `start-securedesignstudio*.sh` wrappers.

Use the [contributor guide](../docs/contributing.md) and
[advanced configuration](../docs/advanced-configuration.md). Model files do not
install scripts, services or libraries. Keep generated artifacts, credentials
and local configuration out of source control.
