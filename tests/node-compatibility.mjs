import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

test("Node-only compiled CLI, MCP, and dashboard use isolated synthetic data", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-node-compatibility-"));
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const env = { ...process.env, CODEX_HOME: directory };
  const preload = join(directory, "offline.mjs");
  writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline Node fixture"); };');
  mkdirSync(join(directory, "sessions"));
  writeFileSync(join(directory, "sessions", "sample.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "node-fixture", provenance: { model: "gpt-5" } } }),
    JSON.stringify({ type: "token_usage_record", timestamp: new Date().toISOString(), payload: {
      session_id: "node-fixture", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    } }),
  ].join("\n"));
  const cli = ["--no-warnings", "--import", preload, "dist/cli/index.js"];
  let server;
  try {
    const doctor = JSON.parse(execFileSync(process.execPath, [...cli, "doctor", "--json"], { cwd, env, encoding: "utf8" }));
    assert.equal(doctor.sqliteAvailable, true);
    const history = JSON.parse(execFileSync(process.execPath, [...cli, "history", "--json"], { cwd, env, encoding: "utf8" }));
    assert.equal(history.total, 1);
    assert.equal(history.records[0].totalTokens, 3);
    const report = JSON.parse(execFileSync(process.execPath, [...cli, "report", "--period", "weekly", "--json"], { cwd, env, encoding: "utf8" }));
    assert.equal(report.settlements.length, 1);
    const ping = JSON.parse(execFileSync(process.execPath, [...cli, "mcp"], {
      cwd, env, encoding: "utf8", input: '{"jsonrpc":"2.0","id":"node","method":"ping"}\n',
    }));
    assert.deepEqual(ping, { jsonrpc: "2.0", id: "node", result: {} });

    server = spawn(process.execPath, [...cli, "dashboard", "--port", "0", "--no-open"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Dashboard startup timed out")), 5000);
      let output = "";
      server.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      server.once("error", (error) => { clearTimeout(timer); reject(error); });
      server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Dashboard exited: ${code}`)); });
    });
    for (const path of ["/", "/app.js", "/style.css", "/api/history"]) {
      const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200, path);
      assert.ok((await response.text()).length > 0, path);
    }
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
