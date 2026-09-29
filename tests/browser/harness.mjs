import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { chromium } from "playwright-core";
import { modelFixture } from "./fixture.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const origin = "http://localhost:5173";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function allowsRequest(address, websocket = false) {
  const url = new URL(address);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    if (error instanceof URIError) return false;
    throw error;
  }
  return url.origin === (websocket ? "ws://localhost:5173" : origin) &&
    !url.username && !url.password && !/^\/api(?:\/|$)/i.test(pathname);
}

export function hasLocalReadyMessage(output) {
  return /Local:\s+http:\/\/localhost:5173\//.test(stripVTControlCharacters(output));
}

export async function requireFreePort(port = 5173, host = "localhost") {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", error => reject(new Error(
      `Browser checks require a free ${host}:${port}; no existing process will be stopped. ${error.code}`,
    )));
    probe.listen({ host, port, exclusive: true }, () => probe.close(resolve));
  });
}

export async function until(check, label, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(50);
  }
  assert.fail(`Timed out: ${label}`);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot identify test source: ${result.error?.message || result.stderr}`);
  }
  return result.stdout;
}

function sourceIdentity() {
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  const hash = createHash("sha256").update(git(["diff", "--binary", "HEAD"]));
  for (const file of untracked.sort()) {
    hash.update(file).update("\0").update(createHash("sha256").update(readFileSync(path.join(root, file))).digest());
  }
  return {
    commit: git(["rev-parse", "HEAD"]).trim(),
    workingTreeDigest: hash.digest("hex"),
    dirty: Boolean(git(["status", "--porcelain"]).trim()),
    version: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version,
  };
}

const describeError = error => error instanceof Error ? error.stack || error.message : String(error);

export function summarizeOutcome(results, { sourceUnchanged = true, lifecycleErrors = [] } = {}) {
  if (!sourceUnchanged || lifecycleErrors.length ||
      results.some(result => !["passed", "blocked"].includes(result.status) || result.faults?.length)) return "failed";
  if (results.some(result => result.status === "blocked")) return "blocked";
  return results.length ? "passed" : "not-run";
}

export async function runRecordedCase({ results, name, createContext, exercise, captureFailure }) {
  const result = { name, status: "running", startedUtc: new Date().toISOString(), faults: [], observations: {} };
  results.push(result);
  let context;
  let failure;
  const capture = async () => {
    try {
      await captureFailure?.(result);
    } catch (error) {
      result.screenshotError = describeError(error);
    }
  };
  try {
    context = await createContext();
    if (!context || typeof context.close !== "function") throw new Error("Setup must return a closable context");
    await exercise(context, result);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    result.status = "failed";
    result.error = describeError(error);
    await capture();
  } finally {
    try {
      if (context) await context.close();
    } catch (error) {
      result.status = "failed";
      result.cleanupError = describeError(error);
      if (failure) failure = new AggregateError([failure, error], "Case and cleanup failed");
      else {
        failure = error instanceof Error ? error : new Error(String(error));
        result.error = describeError(error);
        await capture();
      }
    }
    if (!failure && result.faults.length) {
      failure = new Error(`Unexpected case faults: ${result.faults.join("; ")}`);
      result.error = describeError(failure);
    }
    result.status = failure ? "failed" : "passed";
    result.finishedUtc = new Date().toISOString();
  }
  if (failure) throw failure;
  return result;
}

export async function startHarness() {
  await requireFreePort();
  await requireFreePort(5173, "127.0.0.1");
  await requireFreePort(5173, "::1");
  const output = process.env.SDS_TEST_OUTPUT_DIR
    ? path.resolve(process.env.SDS_TEST_OUTPUT_DIR)
    : mkdtempSync(path.join(os.tmpdir(), "sds-browser-"));
  const relative = path.relative(root, output);
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    throw new Error("SDS_TEST_OUTPUT_DIR must be outside the source worktree.");
  }
  if (process.env.SDS_TEST_OUTPUT_DIR) mkdirSync(output);
  const source = sourceIdentity();
  const channel = process.env.SDS_TEST_BROWSER_CHANNEL || "msedge";
  if (!["msedge", "chrome"].includes(channel)) {
    throw new Error("Use an installed msedge or chrome channel; tests never download a browser.");
  }
  const results = [];
  let browser;
  let serverLog = "";
  let spawnError;
  const server = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js")], {
    cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", error => { spawnError = error; });
  server.stdout.on("data", data => { serverLog += data; });
  server.stderr.on("data", data => { serverLog += data; });

  async function stop() {
    const lifecycleErrors = [];
    try {
      if (browser) await browser.close();
    } catch (error) {
      lifecycleErrors.push(error);
    }
    for (const result of results) {
      if (result.status === "passed" && result.faults?.length) {
        const error = new Error(`Late faults in ${result.name}: ${result.faults.join("; ")}`);
        result.status = "failed";
        result.error = describeError(error);
        lifecycleErrors.push(error);
      }
    }
    try {
      if (server.pid && server.exitCode === null && server.signalCode === null) {
        server.kill();
        await until(() => server.exitCode !== null || server.signalCode !== null, "owned Vite process exit");
      }
    } catch (error) {
      lifecycleErrors.push(error);
    }
    writeFileSync(path.join(output, "server.log"), serverLog);
    const finalSource = sourceIdentity();
    const sourceUnchanged = source.commit === finalSource.commit &&
      source.workingTreeDigest === finalSource.workingTreeDigest;
    const overall = summarizeOutcome(results, { sourceUnchanged, lifecycleErrors });
    writeFileSync(path.join(output, "results.json"), JSON.stringify({
      mode: "vite-serve-local-only", browserChannel: channel, browserVersion: browser?.version(),
      runner: { nodeVersion: process.version, npmScript: process.env.npm_lifecycle_event ?? null,
        execArgs: process.execArgv, entrypoint: process.argv[1] ? path.relative(root, process.argv[1]) : null },
      source, sourceUnchanged, overall, lifecycleErrors: lifecycleErrors.map(describeError),
      results, humanUsability: "not-run", productionBuildBehavior: "not-run",
    }, null, 2));
    if (lifecycleErrors.length) throw new AggregateError(lifecycleErrors, "Browser/server cleanup failed");
    assert.ok(sourceUnchanged, "Source changed during browser validation; evidence must be regenerated.");
  }

  try {
    await until(async () => {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw new Error(`Vite startup failed:\n${serverLog}`);
      if (!hasLocalReadyMessage(serverLog)) return false;
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(500) });
        return response.ok && server.exitCode === null;
      } catch (error) {
        if (error.cause?.code === "ECONNREFUSED" || error.name === "TimeoutError") return false;
        throw error;
      }
    }, "local Vite startup", 20000);
    browser = await chromium.launch({ channel, headless: true });
  } catch (error) {
    results.push({ name: "startup", status: "blocked", error: error.message });
    await stop();
    throw new Error(`${error.message}\nEvidence: ${output}`);
  }
  console.log(`Browser test evidence: ${output}`);

  async function run(name, exercise, { hash = "" } = {}) {
    let page;
    const exerciseCase = async (context, result) => {
      const faults = result.faults;
      await context.route("**/*", async route => {
        if (allowsRequest(route.request().url())) await route.continue();
        else {
          faults.push(`Blocked unexpected HTTP origin/path: ${new URL(route.request().url()).origin}`);
          await route.abort("blockedbyclient");
        }
      });
      await context.routeWebSocket(/.*/, socket => {
        if (allowsRequest(socket.url(), true)) socket.connectToServer();
        else {
          faults.push(`Blocked unexpected WebSocket: ${new URL(socket.url()).origin}`);
          socket.close();
        }
      });
      await context.addInitScript(() => {
        // The module graph exceeds the browser's default 250 resource entries.
        // Retain actual loaded-module evidence used by the synthetic peer case.
        performance.setResourceTimingBufferSize(2000);
        // Exercise the supported download fallback, never a native OS save dialog.
        Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
      });
      page = await context.newPage();
      page.setDefaultTimeout(6000);
      page.on("pageerror", error => faults.push(`Runtime: ${error.message}`));
      page.on("console", message => {
        if (message.type() !== "error") return;
        faults.push(`Console: ${message.text()}`);
      });
      page.on("dialog", async dialog => {
        faults.push(`Unexpected ${dialog.type()}: ${dialog.message()}`);
        await dialog.dismiss();
      });
      await page.goto(`${origin}${hash}`);
      await page.getByLabel("Document status").getByText("Local mode", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator(".ps-command-version").textContent(), `v${source.version}`,
        "The served app displays the current worktree version");
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "browser-fixture.tma", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(modelFixture())),
      });
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_primary");
      await until(() => page.locator(".react-flow__node-process").count().then(count => count === 2), "fixture nodes");
      await until(() => page.locator(".react-flow__edge").count().then(count => count === 2), "fixture edges after node measurement");
      await until(() => page.locator('button[aria-controls="ps-command-menu-file"]')
        .evaluate(element => element === document.activeElement), "file import focus restoration");
      await exercise({ page, context, observations: result.observations });
      assert.deepEqual(faults, [], "No unexpected network attempts, runtime errors, or browser dialogs");
    };
    return runRecordedCase({
      results, name,
      createContext: async () => {
        if (typeof hash !== "string" || (hash && !hash.startsWith("#"))) {
          throw new Error("Only a synthetic URL fragment may be supplied.");
        }
        return browser.newContext({
          viewport: { width: 1366, height: 900 }, serviceWorkers: "block", acceptDownloads: true,
        });
      },
      exercise: exerciseCase,
      captureFailure: async result => {
        if (page && !page.isClosed()) {
          result.screenshot = `${results.indexOf(result) + 1}.png`;
          await page.screenshot({ path: path.join(output, result.screenshot), fullPage: true });
        }
      },
    });
  }
  return { run, stop };
}
