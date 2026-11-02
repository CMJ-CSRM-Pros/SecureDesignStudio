import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { LaunchError, checkNode, configuredValue, descendantPids, descendantsFrom, findOnPath, main, parseArgs, parseProcStat, parsePsListing, portFree } from "../../scripts/launch.mjs";

// Synthetic dependencies, mirroring the mocks in ai-launcher.test.mjs.
function fakeDeps({ platform = "linux", ready = true, malformed = false, interactive = false, answers = ["2"],
  hasAz = true, signedIn = true, func = "/synthetic/func", modules = true, busy = [], env = {} } = {}) {
  const state = { lines: [], npm: [], preflights: 0, azCalls: 0, funcCalls: 0, probes: [] };
  const deps = {
    platform,
    env: { PATH: "/synthetic-cli:relative:", OPENAI_API_KEY: "PRIVATE_SYNTHETIC_SECRET", ...env },
    nodeVersion: "v24.15.0",
    print: line => state.lines.push(line),
    hasCommand: name => name === "npm" || (name === "az" && hasAz),
    exists: relative => relative === "package.json" || modules,
    portFree: async port => !busy.includes(port),
    interactive: () => interactive,
    ask: async () => answers.shift() ?? "",
    preflight: provider => {
      state.preflights++;
      if (malformed) return { exitCode: 2, readiness: null };
      return { exitCode: ready ? 0 : 1, readiness: { id: provider, label: provider, available: ready,
        message: ready ? "Synthetic isolated consumer CLI ready." : "Synthetic CLI unavailable or subscription sign-in missing.",
        diagnostics: [{ stage: "executable", message: "Selected native PATH executable." }] } };
    },
    resolveFuncPath: () => { state.funcCalls++; return func; },
    configuredValue: settings => settings.includes("MODEL_DEPLOYMENT_NAME") ? "synthetic-model" : "https://synthetic.openai.azure.com",
    az: () => { state.azCalls++; return signedIn ? { exitCode: 0, output: "synthetic-identity" } : { exitCode: 1, output: "" }; },
    probeEndpoint: async uri => { state.probes.push(uri); return 200; },
    npm: async (args, childEnv) => { state.npm.push({ args, env: childEnv }); return 0; },
  };
  return { deps, state, text: () => state.lines.join("\n") };
}

async function run(argv, options) {
  const fake = fakeDeps(options);
  try {
    return { ...fake, status: await main(argv, fake.deps) };
  } catch (error) {
    if (!(error instanceof LaunchError)) throw error;
    fake.state.lines.push(...error.lines);
    return { ...fake, status: error.exitCode };
  }
}

test("launcher: plain mode installs once and starts Vite without AI settings", async () => {
  const result = await run([], { modules: false });
  assert.equal(result.status, 0, result.text());
  assert.deepEqual(result.state.npm.map(call => call.args.join(" ")), ["ci", "run dev"]);
  assert.deepEqual(result.state.npm[1].env, {});
  assert.equal(result.state.preflights + result.state.azCalls + result.state.funcCalls, 0);
});

test("launcher: Claude and Codex start the local bridge without Functions or API installation", async () => {
  for (const provider of ["azure", "claude", "codex", ""]) {
    const result = await run(provider ? ["--ai", "--provider", provider] : ["--ai"], { interactive: !provider, modules: false });
    assert.equal(result.status, 0, result.text());
    const start = result.state.npm.at(-1);
    const expected = provider || "claude";
    assert.equal(start.env.SDS_AI_PROVIDER, expected);
    assert.equal(start.env.SDS_LOCAL_AI, "1");
    assert.equal(start.env.SDS_AI_DEBUG, "0");
    assert.equal(result.state.azCalls, expected === "azure" ? 2 : 0);
    assert.equal(result.state.funcCalls, expected === "azure" ? 1 : 0);
    assert.deepEqual(result.state.npm.slice(0, -1).map(call => call.args.join(" ")),
      expected === "azure" ? ["ci", "--prefix api ci"] : ["ci"]);
    assert.equal(start.args.join(" "), expected === "azure" ? "run dev:ai" : "run dev:ai:local");
    assert.equal(start.env.SDS_LOCAL_AI_CLI_ONLY, expected === "azure" ? undefined : "1");
    if (expected !== "azure") assert.match(result.text(), /No Azure Functions host or API package is needed/);
  }
});

test("launcher: debug switches explicitly enable diagnostics and warn about content logging", async () => {
  const debug = await run(["--ai", "--provider", "codex", "--debug-ai"]);
  assert.equal(debug.state.npm.at(-1).env.SDS_AI_DEBUG, "1");
  assert.equal(debug.state.npm.at(-1).env.SDS_AI_DEBUG_CONTENT, "0");
  assert.match(debug.text(), /AI interaction diagnostics enabled/);
  const content = await run(["--ai", "--provider", "codex", "--debug-ai-content"]);
  assert.equal(content.state.npm.at(-1).env.SDS_AI_DEBUG_CONTENT, "1");
  assert.match(content.text(), /WARNING: AI content logging/);
});

test("launcher: unavailable CLIs and unattended missing selection never start", async () => {
  for (const provider of ["claude", "codex"]) {
    const result = await run(["--ai", "--provider", provider], { ready: false });
    assert.equal(result.status, 1);
    assert.equal(result.state.npm.length, 0);
    assert.match(result.text(), /unavailable/);
    assert.match(result.text(), /No provider fallback was attempted/);
  }
  const unattended = await run(["--ai"]);
  assert.equal(unattended.status, 1);
  assert.match(unattended.text(), /Specify --provider/);
});

test("launcher: Azure-only switches cannot bypass subscription authentication", async () => {
  for (const flag of ["--skip-auth-check", "--verify-endpoint"]) {
    const result = await run(["--ai", "--provider", "claude", flag]);
    assert.equal(result.status, 1);
    assert.equal(result.state.preflights + result.state.npm.length, 0);
  }
  const azure = await run(["--ai", "--provider", "azure", "--diagnose-provider"]);
  assert.equal(azure.status, 1);
  assert.match(azure.text(), /applies to Claude and Codex/);
});

test("launcher: diagnostic-only readiness exits before dependencies and servers", async () => {
  const result = await run(["--ai", "--provider", "codex", "--diagnose-provider"], { modules: false });
  assert.equal(result.status, 0, result.text());
  assert.match(result.text(), /Diagnostics complete\. No servers started/);
  assert.match(result.text(), /valid readiness response: true/);
  assert.match(result.text(), /PATH entries ignored: 2/);
  assert.match(result.text(), /\[executable\] Selected native PATH executable/);
  assert.equal(result.state.npm.length, 0);
  assert.doesNotMatch(result.text(), /PRIVATE_SYNTHETIC_SECRET/);
});

test("launcher: malformed preflight output reports exit status without starting", async () => {
  const result = await run(["--ai", "--provider", "claude"], { malformed: true });
  assert.equal(result.status, 1);
  assert.match(result.text(), /Preflight exit code: 2; valid readiness response: false/);
  assert.match(result.text(), /readiness helper did not return a valid response/);
  assert.equal(result.state.npm.length, 0);
});

test("launcher: Node builds without type stripping are named before the readiness check runs", async () => {
  for (const [overrides, pattern] of [[{ typescriptFeature: false }, /type stripping disabled[\s\S]*distribution packages/],
    [{ nodeVersion: "v22.17.0" }, /needs 22\.18\.0 or later/]]) {
    const fake = fakeDeps();
    Object.assign(fake.deps, overrides);
    await assert.rejects(main(["--ai", "--provider", "claude"], fake.deps), error => pattern.test(error.lines.join("\n")));
    assert.equal(fake.state.preflights + fake.state.npm.length, 0);
  }
  // Azure does not use the TypeScript readiness helper.
  const azure = fakeDeps();
  azure.deps.typescriptFeature = false;
  assert.equal(await main(["--ai", "--provider", "azure"], azure.deps), 0);
});

test("launcher: Azure prerequisites fail with OS-specific guidance", async () => {
  const noFunc = await run(["--ai", "--provider", "azure"], { func: null, platform: "darwin" });
  assert.equal(noFunc.status, 1);
  assert.match(noFunc.text(), /brew install azure-functions-core-tools@4/);
  assert.doesNotMatch(noFunc.text(), /winget/);
  const noAz = await run(["--ai", "--provider", "azure"], { hasAz: false });
  assert.match(noAz.text(), /MISSING PREREQUISITE: Azure CLI/);
  const signedOut = await run(["--ai", "--provider", "azure"], { signedIn: false });
  assert.match(signedOut.text(), /NOT SIGNED IN TO AZURE/);
  const skipped = await run(["--ai", "--provider", "azure", "--skip-auth-check"], { hasAz: false });
  assert.equal(skipped.status, 0, skipped.text());
  assert.equal(skipped.state.azCalls, 0);
  const verified = await run(["--ai", "--provider", "azure", "--verify-endpoint"]);
  assert.match(verified.state.probes[0], /^https:\/\/synthetic\.openai\.azure\.com\/openai\/deployments\/synthetic-model\/chat\/completions\?/);
  assert.match(verified.text(), /Endpoint reachable/);
});

test("launcher: busy ports stop startup and name the per-OS inspection command", async () => {
  const cases = [["linux", /ss -ltnp 'sport = :5173'/], ["darwin", /lsof -nP -iTCP:5173/], ["win32", /Get-NetTCPConnection -LocalPort 5173/]];
  for (const [platform, hint] of cases) {
    const result = await run([], { platform, busy: [5173] });
    assert.equal(result.status, 1);
    assert.match(result.text(), hint);
    assert.match(result.text(), /DO NOT stop it/);
    assert.equal(result.state.npm.length, 0);
  }
  const api = await run(["--ai", "--provider", "azure"], { busy: [7071] });
  assert.match(api.text(), /PORT 7071 IS ALREADY IN USE/);
});

test("launcher: argument parsing rejects unknown options and AI flags without --ai", () => {
  assert.equal(parseArgs(["--ai", "--provider=Codex"]).provider, "codex");
  for (const argv of [["--bogus"], ["--provider", "claude"], ["--ai", "--provider", "gemini"], ["--ai", "--provider"]]) {
    assert.throws(() => parseArgs(argv), error => error instanceof LaunchError && error.exitCode === 2);
  }
});

test("launcher: Node versions below the toolchain minimum are refused with version-manager advice", () => {
  assert.deepEqual(checkNode("v24.15.0", "linux").version, [24, 15, 0]);
  assert.equal(checkNode("garbage", "linux").warning, true);
  assert.throws(() => checkNode("v22.11.9", "linux"), error => /nvm install 24/.test(error.lines.join("\n")));
  assert.throws(() => checkNode("v20.0.0", "win32"), error => /winget/.test(error.lines.join("\n")));
});

test("launcher: PATH lookup ignores relative entries and non-executable files", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sds-launch-"));
  try {
    await writeFile(path.join(directory, "claude"), "#!/bin/sh\n");
    await writeFile(path.join(directory, "codex"), "#!/bin/sh\n");
    await chmod(path.join(directory, "claude"), 0o755);
    const env = { PATH: `relative${path.delimiter}${directory}${path.delimiter}` };
    assert.deepEqual(findOnPath("claude", env, "linux"), { found: [path.join(directory, "claude")], ignored: 2 });
    assert.deepEqual(findOnPath("codex", env, "linux").found, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("launcher: configured values prefer the environment over local settings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sds-launch-"));
  try {
    const settings = path.join(directory, "local.settings.json");
    await writeFile(settings, JSON.stringify({ Values: { MODEL_DEPLOYMENT_NAME: "from-file" } }));
    assert.equal(configuredValue(["MODEL_DEPLOYMENT_NAME"], ["MODEL_DEPLOYMENT_NAME"], {}, settings), "from-file");
    assert.equal(configuredValue(["MODEL_DEPLOYMENT_NAME"], ["MODEL_DEPLOYMENT_NAME"], { MODEL_DEPLOYMENT_NAME: " env " }, settings), "env");
    assert.equal(configuredValue(["MISSING"], ["MISSING"], {}, path.join(directory, "absent.json")), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("launcher: the port probe detects a real listener", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const { port } = server.address();
  try {
    assert.equal(await portFree(port), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal(await portFree(port), true);
});

// A real process tree: wrapper (runInherited) -> sh -> long-lived server. Stopping
// the launcher with SIGTERM or SIGHUP (kill, a closed terminal) must stop the
// dev server too, or it keeps holding port 5173 after the launcher is gone.
// The "no ps" variant empties PATH so the launcher must read /proc (as on BusyBox).
for (const [signal, noPs] of [["SIGTERM", false], ["SIGHUP", false], ["SIGTERM", true]]) {
  const name = `launcher: ${signal} stops the started child instead of orphaning it${noPs ? " (no ps: /proc fallback)" : ""}`;
  test(name, { skip: noPs ? process.platform !== "linux" : process.platform === "win32" }, async () => {
    const { spawn } = await import("node:child_process");
    const launcher = new URL("../../scripts/launch.mjs", import.meta.url).href;
    const wrapper = spawn(process.execPath, ["--input-type=module", "-e", `
      import { runInherited } from ${JSON.stringify(launcher)};
      // Like 'npm run dev': an intermediate shell that forks the server and
      // dies on SIGTERM without passing it on.
      const server = JSON.stringify(process.execPath) +
        " -e \\"console.log('child ' + process.pid); setInterval(() => {}, 1000)\\"; true";
      const code = await runInherited("/bin/sh", ["-c", server], process.env);
      console.log("exit " + code);
      process.exit(code);`], { stdio: ["ignore", "pipe", "inherit"], env: noPs ? { ...process.env, PATH: "" } : process.env });
    let output = "";
    wrapper.stdout.on("data", data => { output += data; });
    const deadline = Date.now() + 10_000;
    while (!/child (\d+)/.test(output) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    const childPid = Number(/child (\d+)/.exec(output)?.[1]);
    assert.ok(childPid > 0, `child did not start: ${output}`);
    wrapper.kill(signal);
    const wrapperExit = await new Promise(resolve => wrapper.on("exit", (code, sig) => resolve(code ?? sig)));
    const alive = () => { try { process.kill(childPid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 100 && alive(); i++) await new Promise(r => setTimeout(r, 20));
    const leaked = alive();
    if (leaked) process.kill(childPid, "SIGKILL");
    assert.equal(leaked, false, `child ${childPid} outlived the launcher`);
    assert.equal(wrapperExit, signal === "SIGTERM" ? 143 : 129);
  });
}

// The process table comes from `ps` (Linux, macOS) or, where ps lacks -A/-o
// (BusyBox), from /proc/<pid>/stat. Both must yield the same tree.
test("launcher: ps output parses into pid/ppid pairs", () => {
  assert.deepEqual(parsePsListing("    1     0\n  200     1\n  201   200\n\n garbage\n"),
    [[1, 0], [200, 1], [201, 200]]);
});

test("launcher: /proc stat lines parse ppid after the last ')' even when comm has spaces and parentheses", () => {
  assert.deepEqual(parseProcStat("4242 (node) S 4241 4242 4242 0 -1 4194560"), [4242, 4241]);
  assert.deepEqual(parseProcStat("77 (evil) (x 9) S 1) R 76 77 77 0 -1"), [77, 76]);
  assert.deepEqual(parseProcStat("78 (a ) (b) S 3 78"), [78, 3]);
  assert.equal(parseProcStat(""), null);
  assert.equal(parseProcStat("not a stat line"), null);
});

test("launcher: descendants are listed deepest first and cycles cannot loop", () => {
  const pairs = [[10, 1], [11, 10], [12, 11], [13, 10], [99, 1], [20, 21], [21, 20], [21, 12]];
  const found = descendantsFrom(pairs, 10);
  assert.deepEqual(new Set(found), new Set([11, 12, 13, 21, 20]));
  assert.ok(found.indexOf(12) < found.indexOf(11), "grandchild before child");
  assert.ok(found.indexOf(20) < found.indexOf(21) && found.indexOf(21) < found.indexOf(12), "deepest first");
  assert.equal(found.includes(10), false, "root excluded");
  assert.deepEqual(descendantsFrom([[5, 5], [6, 5], [5, 6]], 5), [6], "self-parent and back-edge to root");
});

test("launcher: descendantPids walks an injected process table", () => {
  assert.deepEqual(descendantPids(300, () => [[301, 300], [302, 301], [400, 1]]), [302, 301]);
  assert.deepEqual(descendantPids(300, () => []), []);
});
