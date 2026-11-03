import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
const {
  ADO_JOURNAL_KEY, effectiveReceipt, readSubmissionJournal,
  submissionEligible, submitWorkBatch, workItemEligibility, workQueueCounts,
} = await import("../../src/workSubmission.ts");

const item = (id, patch = {}) => ({
  id, title: id, description: "<plain>", decision: "accepted", severity: "3 - Medium",
  workItemType: "Bug", weaknessType: "Synthetic weakness", link: "", ...patch,
});
const receipt = status => ({ operationId: "op", destinationKey: "synthetic/task", attemptedAt: 1, status });
function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
function options(items, overrides = {}) {
  const calls = [], saved = [];
  return {
    items, storage: storage(), destination: "synthetic/task", isCurrent: () => true,
    onReceipt: (work, result) => saved.push([work.id, result]),
    client: {
      validate: async draft => { calls.push(["validate", draft]); },
      create: async draft => { calls.push(["create", draft]); return { id: 12, url: "https://dev.azure.com/synthetic/project/_workitems/edit/12" }; },
    },
    calls, saved, ...overrides,
  };
}

test("work submit: explicit accepted-only eligibility respects links, receipts and durable Undo guards", () => {
  assert.equal(submissionEligible(item("a"), {}), true);
  for (const decision of [undefined, "pending", "rejected"]) {
    assert.equal(submissionEligible(item("a", { decision }), {}), false);
  }
  assert.equal(submissionEligible(item("a", { link: "https://tracker.example/12" }), {}), false);
  for (const status of ["submitting", "submitted", "unknown"]) {
    assert.equal(submissionEligible(item("a"), { a: receipt(status) }), false);
    assert.equal(submissionEligible(item("a", { submission: receipt(status) }), {}), false);
  }
  assert.equal(submissionEligible(item("a", { submission: receipt("failed") }), {}), true);
  assert.equal(effectiveReceipt(item("a", { submission: receipt("submitted") }), { a: receipt("failed") }).status, "submitted");
});

test("work submit: visible queue reasons preserve every review, link and durable-result guard", () => {
  for (const decision of [undefined, "pending", "accepted", "rejected"]) {
    for (const link of ["", "  ", "https://example.invalid/already-tracked"]) {
      for (const status of [undefined, "failed", "submitting", "submitted", "unknown"]) {
        for (const durable of [undefined, "failed", "submitting", "submitted", "unknown"]) {
          const work = item("a", { decision, link, ...(status ? { submission: receipt(status) } : {}) });
          const journal = durable ? { a: receipt(durable) } : {};
          const effective = effectiveReceipt(work, journal);
          const eligible = decision === "accepted" && !link.trim() && (!effective || effective.status === "failed");
          assert.equal(workItemEligibility(work, journal) === "eligible", eligible);
          assert.equal(submissionEligible(work, journal), eligible);
        }
      }
    }
  }
  const items = [
    item("selected"), item("pending", { decision: undefined }), item("rejected", { decision: "rejected" }),
    item("linked", { link: "https://example.invalid/existing" }), item("recorded"),
    item("failed", { submission: receipt("failed") }),
  ];
  const journal = { recorded: receipt("unknown") };
  const before = structuredClone({ items, journal });
  assert.deepEqual(workQueueCounts(items, journal), { eligible: 2, pending: 1, rejected: 1, linked: 1, recorded: 1 });
  assert.equal(workItemEligibility(item("a", { decision: "pending", link: "https://example.invalid/existing" }), {}), "linked");
  assert.equal(workItemEligibility(item("a", { link: "https://example.invalid/existing" }), { a: receipt("submitted") }), "recorded");
  assert.deepEqual({ items, journal }, before);
});

test("work submit: all payloads validate before writes; journal precedes each create and blocks replay", async () => {
  const input = options([item("a", { severity: "1 - Critical" }), item("b", { severity: "4 - Low", workItemType: "Task", weaknessType: "Task-specific" }),
    item("pending", { decision: "pending" }), item("rejected", { decision: "rejected" })]);
  const create = input.client.create;
  input.client.create = async draft => {
    assert.equal(readSubmissionJournal(input.storage)[draft.title].status, "submitting");
    return create(draft);
  };
  const results = await submitWorkBatch(input);
  assert.deepEqual(input.calls.map(call => call[0]), ["validate", "validate", "create", "create"]);
  assert.equal(results.length, 2);
  assert.deepEqual(input.calls.map(call => call[1].severity), ["1 - Critical", "4 - Low", "1 - Critical", "4 - Low"]);
  assert.deepEqual(input.calls.map(call => call[1].workItemType), ["Bug", "Task", "Bug", "Task"]);
  assert.deepEqual(input.calls.map(call => call[1].weaknessType), ["Synthetic weakness", "Task-specific", "Synthetic weakness", "Task-specific"]);
  assert.equal(readSubmissionJournal(input.storage).a.status, "submitted");
  assert.equal(input.saved[0][1].status, "submitting");
  await assert.rejects(submitWorkBatch(input), /No accepted/);
});

test("work submit: preflight failure creates no external item or claim", async () => {
  const input = options([item("a"), item("b")]);
  input.client.validate = async draft => { if (draft.title === "b") throw new Error("Required custom field missing."); };
  await assert.rejects(submitWorkBatch(input), /Required custom/);
  assert.deepEqual(input.calls, []);
  assert.equal(input.storage.getItem(ADO_JOURNAL_KEY), null);
});

test("work submit: ambiguous creation stops the batch and survives reload", async () => {
  const input = options([item("a"), item("b")]);
  input.client.create = async () => { throw new Error("Connection interrupted."); };
  const result = await submitWorkBatch(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].receipt.status, "unknown");
  assert.equal(submissionEligible(item("a"), readSubmissionJournal(input.storage)), false);
  assert.equal(readSubmissionJournal(input.storage).b, undefined);
});

test("work submit: definite rejection allows explicit retry and retains later successes", async () => {
  const input = options([item("a"), item("b")]);
  input.client.create = async draft => {
    if (draft.title === "a") throw Object.assign(new Error("ADO rejected the work."), { uncertain: false });
    return { id: 34, url: "https://dev.azure.com/synthetic/project/_workitems/edit/34" };
  };
  const results = await submitWorkBatch(input);
  assert.deepEqual(results.map(result => result.receipt.status), ["failed", "submitted"]);
  const journal = readSubmissionJournal(input.storage);
  assert.equal(submissionEligible(item("a"), journal), true);
  assert.equal(submissionEligible(item("b"), journal), false);
});

test("work submit: missing storage and corrupt journal fail before POST, no success-shaped fallback", async () => {
  const input = options([item("a")]);
  input.storage.setItem = () => { throw new Error("Storage is unavailable."); };
  await assert.rejects(submitWorkBatch(input), /Storage is unavailable/);
  assert.deepEqual(input.calls.map(call => call[0]), ["validate"]);
  for (const raw of ["null", "[]", "false", '{"a":{"status":"submitted"}}', "not json",
    JSON.stringify({ a: { ...receipt("submitted"), url: "javascript:alert(1)" } }),
    JSON.stringify({ a: { ...receipt("submitted"), attemptedAt: -1 } }),
    JSON.stringify({ a: { ...receipt("submitted"), token: "SYNTHETIC_DO_NOT_ECHO" } })]) {
    const store = storage();
    store.setItem(ADO_JOURNAL_KEY, raw);
    assert.throws(() => readSubmissionJournal(store));
  }
});

test("work submit: outcome remains visible when post-create storage fails and durable claim blocks retry", async () => {
  const input = options([item("a"), item("b")]);
  const set = input.storage.setItem;
  let writes = 0;
  input.storage.setItem = (key, value) => { if (++writes === 2) throw new Error("Storage full."); set(key, value); };
  await assert.rejects(submitWorkBatch(input), /Storage full/);
  assert.equal(input.saved.at(-1)[1].status, "submitted");
  assert.equal(readSubmissionJournal(input.storage).a.status, "submitting");
  assert.equal(input.calls.filter(call => call[0] === "create").length, 1);
});

test("work submit: edited/replaced sources and duplicate IDs cannot trigger stale writes", async () => {
  const input = options([item("a"), item("b")]);
  let current = true;
  input.isCurrent = () => current;
  input.client.validate = async () => { current = false; };
  await assert.rejects(submitWorkBatch(input), /Work changed/);
  assert.equal(input.calls.filter(call => call[0] === "create").length, 0);
  const duplicate = options([item("a"), item("a")]);
  await assert.rejects(submitWorkBatch(duplicate), /Duplicate SDS/);
});
