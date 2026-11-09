// A render error must not leave a blank page, and a crafted autosaved model
// must not make the app unrecoverable after every reload (audit S4).
import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { AppErrorBoundary } = await import("../../src/components/AppErrorBoundary.tsx");

function fallback(state) {
  const boundary = new AppErrorBoundary({ children: null });
  boundary.state = { ...boundary.state, ...AppErrorBoundary.getDerivedStateFromError(new Error("synthetic")), ...state };
  return { boundary, markup: renderToStaticMarkup(boundary.render()) };
}

test("regression: a render error shows recovery actions instead of a blank page", () => {
  assert.deepEqual(AppErrorBoundary.getDerivedStateFromError(new Error("x")).failed, true);
  const { markup } = fallback();
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Reload/);
  assert.match(markup, /Download the autosaved model/);
  assert.match(markup, /Discard the autosaved model/);
  // The error text is not echoed: it can carry model content.
  assert.doesNotMatch(markup, /synthetic/);
});

test("regression: discarding the autosave needs a second, explicit confirmation", () => {
  const removed = [];
  let reloads = 0;
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: { removeItem: key => removed.push(key), getItem: () => null, setItem() {} },
    location: { reload: () => { reloads++; } },
  };
  try {
    const first = fallback();
    first.boundary.setState = update => Object.assign(first.boundary.state, update);
    first.boundary.requestDiscard();
    assert.equal(removed.length, 0, "first click only asks");
    assert.match(renderToStaticMarkup(first.boundary.render()), /Confirm discard/);
    first.boundary.confirmDiscard();
    assert.ok(removed.includes("secure-design-studio:autosave:v1"));
    assert.equal(reloads, 1);
  } finally {
    globalThis.window = previous;
  }
});

test("regression: the app root is wrapped in the error boundary", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /<AppErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/AppErrorBoundary>/);
});
