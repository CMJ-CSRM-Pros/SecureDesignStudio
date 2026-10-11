// Bounded, non-inference readiness for one local subscription CLI. Shares the
// backend's native resolution, managed-policy, isolation-flag and sign-in checks
// (api/design-assistant/localProviders.ts) via Node type stripping, so it can run
// before dependencies are installed or the API is built. Prints one
// AiProviderStatus JSON line: exit 0 when available, 1 when not, 2 on misuse.
const OVERALL_TIMEOUT_MS = 14_000;
const provider = process.argv[2] === "--provider" ? process.argv[3] : undefined;
if ((provider !== "claude" && provider !== "codex") || process.argv.length !== 4) {
  process.stderr.write("Usage: node scripts/ai-provider-preflight.mjs --provider claude|codex\n");
  process.exit(2);
}
const label = provider === "claude" ? "Claude Code subscription" : "ChatGPT Codex CLI";
let finished = false;
let timeout;
const report = (status) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  process.stdout.write(`${JSON.stringify({ id: provider, label, available: status.available === true,
    message: String(status.message ?? "") })}\n`);
  process.exitCode = status.available === true ? 0 : 1;
};
// Each CLI subprocess has its own kill timeout; this only bounds the total.
timeout = setTimeout(() => report({ available: false, message: "Local CLI readiness timed out." }), OVERALL_TIMEOUT_MS);
try {
  const { localProviderStatus } = await import("../api/design-assistant/localProviders.ts");
  report(await localProviderStatus(provider));
} catch {
  report({ available: false, message: "Local CLI readiness requires Node.js with TypeScript type stripping (22.18+ or 24)." });
}
