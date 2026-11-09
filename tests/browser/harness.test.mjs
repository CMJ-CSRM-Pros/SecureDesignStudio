import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { allowsRequest, hasLocalReadyMessage, requireFreePort, runRecordedCase, summarizeOutcome } from "./harness.mjs";

test("failed context setup is registered and cannot produce passing evidence", async () => {
  const results = [];
  await assert.rejects(runRecordedCase({
    results, name: "setup failure",
    createContext: async () => { throw new Error("Context unavailable"); },
    exercise: async () => assert.fail("exercise must not run"),
  }), /Context unavailable/);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "failed");
  assert.match(results[0].error, /Context unavailable/);
  assert.equal(summarizeOutcome(results), "failed");
});

test("cleanup completes before success and a cleanup error fails the recorded case", async () => {
  const results = [];
  await assert.rejects(runRecordedCase({
    results, name: "cleanup failure",
    createContext: async () => ({ close: async () => {
      assert.equal(results[0].status, "running");
      throw new Error("Context close failed");
    } }),
    exercise: async () => {},
  }), /Context close failed/);
  assert.equal(results[0].status, "failed");
  assert.match(results[0].cleanupError, /Context close failed/);
  assert.equal(summarizeOutcome(results), "failed");
});

test("exercise, evidence-capture and cleanup errors retain the original failure", async () => {
  const results = [];
  await assert.rejects(runRecordedCase({
    results, name: "combined failure",
    createContext: async () => ({ close: async () => { throw new Error("Cleanup failure"); } }),
    exercise: async () => { throw new Error("Contract failure"); },
    captureFailure: async () => { throw new Error("Screenshot failure"); },
  }), error => error instanceof AggregateError && error.errors.length === 2);
  assert.match(results[0].error, /Contract failure/);
  assert.match(results[0].cleanupError, /Cleanup failure/);
  assert.match(results[0].screenshotError, /Screenshot failure/);
  assert.equal(summarizeOutcome(results), "failed");
});

test("late faults and lifecycle failures are never reported as passed", async () => {
  const results = [];
  await assert.rejects(runRecordedCase({
    results, name: "late fault",
    createContext: async () => ({ close: async () => { results[0].faults.push("Late runtime error"); } }),
    exercise: async () => {},
  }), /Late runtime error/);
  assert.equal(summarizeOutcome(results), "failed");
  assert.equal(summarizeOutcome([{ status: "passed" }], { lifecycleErrors: [new Error("Shutdown failed")] }), "failed");
  assert.equal(summarizeOutcome([{ status: "passed", faults: ["Late fault"] }]), "failed");
  assert.equal(summarizeOutcome([{ status: "running" }]), "failed");
  assert.equal(summarizeOutcome([{ status: "passed" }], { sourceUnchanged: false }), "failed");
  assert.equal(summarizeOutcome([{ status: "blocked" }]), "blocked");
  assert.equal(summarizeOutcome([]), "not-run");
});

test("falsy thrown values and missing contexts cannot turn failures into passes", async () => {
  for (const phase of ["setup", "exercise", "cleanup"]) {
    for (const value of [null, undefined, false, 0, ""]) {
      const results = [];
      await assert.rejects(runRecordedCase({
        results, name: phase,
        createContext: async () => {
          if (phase === "setup") throw value;
          return { close: async () => { if (phase === "cleanup") throw value; } };
        },
        exercise: async () => { if (phase === "exercise") throw value; },
      }));
      assert.equal(results[0].status, "failed");
      assert.equal(summarizeOutcome(results), "failed");
    }
  }
  const results = [];
  await assert.rejects(runRecordedCase({
    results, name: "missing context", createContext: async () => undefined, exercise: async () => {},
  }), /closable context/);
  assert.equal(summarizeOutcome(results), "failed");
});

test("a completed case records success only after its owned context closes", async () => {
  const results = [];
  let closed = false;
  const result = await runRecordedCase({
    results, name: "success",
    createContext: async () => ({ close: async () => { closed = true; assert.equal(results[0].status, "running"); } }),
    exercise: async () => {},
  });
  assert.equal(closed, true);
  assert.equal(result.status, "passed");
  assert.ok(result.finishedUtc);
  assert.equal(summarizeOutcome(results), "passed");
});

test("readiness requires the owned server's exact address and tolerates ANSI formatting", () => {
  assert.equal(hasLocalReadyMessage("Local: http://localhost:\u001b[1m5173\u001b[22m/"), true);
  assert.equal(hasLocalReadyMessage("Local: http://localhost:5174/"), false);
  assert.equal(hasLocalReadyMessage("Error requesting http://localhost:5173/"), false);
});

test("HTTP and WebSocket policy permits only the exact local origin and no API routes", () => {
  assert.equal(allowsRequest("http://localhost:5173/src/main.tsx"), true);
  assert.equal(allowsRequest("ws://localhost:5173/?token=synthetic", true), true);
  for (const url of [
    "https://example.invalid/", "http://localhost:7071/api/test", "http://127.0.0.1:5173/",
    "http://localhost:5173/api/collab-token", "http://localhost:5173/api/design-assistant",
    "http://localhost:5173/api", "http://localhost:5173/API/test",
    "http://localhost:5173/%61pi/test", "http://localhost:5173/api%2Ftest",
    "http://localhost:5173/%zz", "http://user:password@localhost:5173/",
  ]) assert.equal(allowsRequest(url), false, url);
  assert.equal(allowsRequest("wss://example.invalid/", true), false);
  assert.equal(allowsRequest("ws://localhost:5173/api/socket", true), false);
});

test("an occupied port is rejected without stopping or reusing its listener", async t => {
  const listener = net.createServer(socket => socket.end());
  await new Promise(resolve => listener.listen(0, "localhost", resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  await assert.rejects(requireFreePort(listener.address().port), /no existing process will be stopped/);
  assert.equal(listener.listening, true);
});
