/** Launch the actual dashboard with disposable, synthetic data and no credentials. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "codex-usage-demo-"));
const now = Date.now();
const sessions = join(directory, "sessions");
mkdirSync(sessions);
const events = [];
for (let day = 0; day < 14; day++) {
  for (let slot = 0; slot < 24; slot++) {
    const timestamp = now - (day * 24 + slot) * 3_600_000;
    const subagent = slot % 3 === 0;
    const input = 12000 + ((slot * 7919 + day * 313) % 60000);
    const output = 800 + slot * 91;
    events.push(JSON.stringify({ type: "session_meta", payload: {
      id: `demo-${day}-${slot}`, provenance: { model: subagent ? "gpt-5.6-terra" : "gpt-6-astra" },
    } }));
    events.push(JSON.stringify({ type: "turn_context", payload: { role: subagent ? "subagent" : "main" } }));
    events.push(JSON.stringify({ type: "token_usage_record", timestamp: new Date(timestamp).toISOString(), payload: {
      session_id: `demo-${day}-${slot}`, turn_id: `turn-${slot}`, thread_id: "demo-thread",
      usage: { input_tokens: input, cached_input_tokens: Math.floor(input * 0.65), output_tokens: output,
        reasoning_output_tokens: Math.floor(output * 0.2), total_tokens: input + output },
    } }));
  }
}
writeFileSync(join(sessions, "demo.jsonl"), events.join("\n"));
writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ updatedAtMs: now, updatedDate: "demo", models: [] }), { mode: 0o600 });
const window = (used: number, seconds: number) => ({ usedPercent: used, remainingPercent: 100 - used,
  limitWindowSeconds: seconds, resetAfterSeconds: seconds / 2, resetAtMs: now + seconds * 500, resetCountdown: "Demo" });
writeFileSync(join(directory, "codex_quota_snapshot.json"), JSON.stringify({
  updatedAt: now, email: "demo@example.com", planType: "demo", proTier: false,
  fiveHour: window(28, 18000), weekly: window(63, 604800), additionalLimits: [], resetCredits: 0, resetCreditsKnown: true, source: "cache",
}), { mode: 0o600 });

console.log("DEMO — synthetic records and quota; no real account or network credentials.");
console.log(`Temporary data: ${directory}`);
const args = process.argv.slice(2);
const child = spawn(process.execPath, ["src/cli/index.ts", ...(args.length ? args : ["dashboard", "--port", "10201", "--no-open"])], {
  cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, CODEX_HOME: directory }, stdio: "inherit",
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("error", (error) => { console.error(error.message); rmSync(directory, { recursive: true, force: true }); process.exitCode = 1; });
child.on("exit", (code) => { rmSync(directory, { recursive: true, force: true }); process.exitCode = code ?? 0; });
