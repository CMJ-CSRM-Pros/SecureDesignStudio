// The local-AI bridge starts the claude/codex CLI with a minimal environment.
// On macOS/Linux an npm-installed CLI is a `#!/usr/bin/env node` script, so the
// child needs a PATH that finds the Node running the bridge, and nothing more.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Compile the real module to CommonJS with real Node built-ins (no mocks).
const file = new URL("../../api/design-assistant/localProviders.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(createRequire(file), module, module.exports);
const { childEnvironment, runProcess } = module.exports;

const posix = { skip: process.platform === "win32" };

test("local CLI environment: POSIX PATH holds only the running Node and the CLI directories", posix, () => {
  const saved = { ...process.env };
  try {
    process.env.PATH = "/caller/private/bin:/usr/local/sbin";
    process.env.OPENAI_API_KEY = "PRIVATE_SYNTHETIC_SECRET";
    process.env.NODE_OPTIONS = "--require /tmp/injected.js";
    process.env.TMPDIR = "/synthetic/tmp";
    const env = childEnvironment("/opt/synthetic-cli/lib/cli.js");
    const entries = (env.PATH ?? "").split(path.delimiter);
    // The running Node comes first, so `env node` cannot pick up a file named
    // `node` from the CLI's own package directory.
    assert.deepEqual(entries, [path.dirname(process.execPath), "/opt/synthetic-cli/lib"]);
    assert.equal(env.TMPDIR, "/synthetic/tmp");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(childEnvironment().PATH, path.dirname(process.execPath));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("local CLI environment: an npm-style `env node` CLI runs under the bridge's environment", posix, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sds-cli-"));
  try {
    const cli = path.join(directory, "cli.js");
    await writeFile(cli, "#!/usr/bin/env node\nprocess.stdin.pipe(process.stdout);\n");
    await chmod(cli, 0o755);
    const output = await runProcess(cli, [], directory, "synthetic answer", 10_000);
    assert.equal(output, "synthetic answer");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
