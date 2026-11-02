# Verifying a release download

Each release on the
[Releases page](https://github.com/microsoft/SecureDesignStudio/releases) is
built from its version tag by the `release` GitHub Actions workflow
(`.github/workflows/release.yml`). A maintainer reviews the draft before
publishing it. Nothing in a release is an installer or OS executable, so there
is no Windows or macOS code signature to check. Integrity comes from two
independent checks: a checksum file and a GitHub build-provenance attestation.

| File | Contents |
|---|---|
| `SecureDesignStudio-<version>-standalone.html` | The whole app in one HTML file. Opens offline in a Chromium-based browser. |
| `SecureDesignStudio-<version>-web.zip` | The multi-file build (`dist/`) for hosting on a static web server. |
| `SecureDesignStudio-<version>-sbom.cdx.json` | CycloneDX software bill of materials for the runtime dependencies. |
| `SHA256SUMS` | SHA-256 checksums of the three files above. |

Download the files you need and `SHA256SUMS` into the same folder, then run
the checks from that folder.

## 1. Check the checksums

Every file you downloaded must report `OK`. If you downloaded only some of
the files, add `--ignore-missing` to the Linux or macOS command so that the
others are skipped instead of reported as missing.

**Linux:**

```sh
sha256sum -c SHA256SUMS
```

**macOS:**

```sh
shasum -a 256 -c SHA256SUMS
```

**Windows (PowerShell):**

```powershell
Get-Content SHA256SUMS | ForEach-Object {
    $expected, $name = $_ -split '\s+', 2
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $name).Hash
    if ($actual -eq $expected) { "${name}: OK" } else { "${name}: FAILED" }
}
```

For a single file, `Get-FileHash -Algorithm SHA256 .\<file>` prints the hash
to compare with its line in `SHA256SUMS` (the comparison is not
case-sensitive).

A checksum match proves the file is the one listed in `SHA256SUMS`. It does not
prove who produced `SHA256SUMS`, because both came from the same download page.
The attestation covers that.

## 2. Check the build provenance

The release workflow records a signed
[build-provenance attestation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations)
for every file. It binds the file's SHA-256 to this repository, the release
workflow, and the commit it ran on. Verify it with the
[GitHub CLI](https://cli.github.com/), signed in with `gh auth login`:

```sh
gh attestation verify SecureDesignStudio-<version>-standalone.html \
  --repo microsoft/SecureDesignStudio
```

The command must end with a success message. To also require that the file
came from the release workflow and the expected tag, add:

```sh
  --signer-workflow microsoft/SecureDesignStudio/.github/workflows/release.yml \
  --source-ref refs/tags/v<version>
```

Repeat for each file you downloaded. If a fork publishes its own releases,
replace `microsoft/SecureDesignStudio` with that fork's `owner/repo`; an
attestation only speaks for the repository that produced it.

**If either check fails, do not open the file.** Delete it, download it again
from the Releases page, and report a persistent mismatch according to
[the security policy](https://github.com/microsoft/SecureDesignStudio/security/policy).

## What the SBOM is for

The `.cdx.json` file lists the third-party npm packages, with versions,
package URLs and declared licenses, that the release depends on at runtime. It
is a machine-readable [CycloneDX](https://cyclonedx.org/) document. Use it to:

- check the release against new vulnerability advisories with an SBOM-aware
  scanner, without rebuilding it;
- review third-party licenses for your organization's approval process;
- record which components you deployed.

The SBOM describes the release; it is not a security verdict. Build tools
(`devDependencies`) are not included. Source checkouts that run `npm run dev`
also use those, and `npm audit` covers them there.

## Standalone HTML files run code

A standalone HTML file contains the complete application, and an exported
standalone file also contains a model. **Opening one runs its code** in your
browser, with the same access as any web page you open from disk. A file that
looks like a SecureDesignStudio export can contain modified code.

- Only open standalone HTML files from a release you verified above, or that
  you built yourself from a trusted clone.
- To share or receive a model, especially from someone outside your
  organization, exchange the native `.tma` file and open it in your own
  verified copy of the app. A `.tma` file is model data that the app
  validates on import, not a page that runs its own code.
