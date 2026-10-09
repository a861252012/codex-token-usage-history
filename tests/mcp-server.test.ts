import { describe, expect, test } from "bun:test";
import { parseMcpAgentRole, parseMcpLimit } from "../src/mcp/server.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";

describe("MCP request validation", () => {
  test("closing MCP stdin or terminating the server stops its background index process", async () => {
    for (const shutdown of ["stdin", "SIGTERM"] as const) {
      const directory = mkdtempSync(join(tmpdir(), "codex-mcp-shutdown-"));
      const preload = join(directory, "slow.ts");
      const pidFile = join(directory, "index.pid");
      writeFileSync(preload, `import { SessionIndexer } from ${JSON.stringify(join(import.meta.dir, "../src/core/session-indexer.ts"))};
        import { writeFileSync } from "node:fs";
        SessionIndexer.prototype.indexAll = function () {
          writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
          throw new Error("index should have been stopped");
        };`);
      const child = spawn(process.execPath, ["--preload", preload, "src/cli/index.ts", "mcp"], {
        cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: directory }, stdio: ["pipe", "pipe", "pipe"],
      });
      let indexPid: number | undefined;
      try {
        const response = once(child.stdout, "data");
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_codex_usage_history" } }) + "\n");
        const [data] = await response;
        expect(JSON.parse(String(data)).result.isError).toBe(true);
        indexPid = Number(readFileSync(pidFile, "utf8"));
        const exited = once(child, "exit");
        if (shutdown === "stdin") child.stdin.end(); else child.kill(shutdown);
        await exited;
        const alive = () => { try { process.kill(indexPid!, 0); return true; } catch { return false; } };
        for (let attempt = 0; attempt < 50 && alive(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
        expect(alive()).toBe(false);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
        if (indexPid) { try { process.kill(indexPid, "SIGKILL"); } catch {} }
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }, 10_000);

  test("MCP reports compressed scan failures instead of returning complete-looking totals", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-mcp-failed-index-"));
    mkdirSync(join(directory, "sessions"));
    mkdirSync(join(directory, "archived_sessions"));
    writeFileSync(join(directory, "sessions", "bad.jsonl.zst"), "bad");
    try {
      const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_codex_usage_history" } });
      const result = spawnSync(process.execPath, ["src/cli/index.ts", "mcp"], {
        cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: directory, PATH: directory },
        input: request + "\n", encoding: "utf8", timeout: 5000,
      });
      expect(result.status, result.stderr).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.error.message).toContain("zstd executable not found");
      expect(response.result).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("slow cold indexing keeps ping responsive, returns a retry result and shares one complete scan", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-mcp-background-"));
    const repository = join(import.meta.dir, "..");
    const preload = join(directory, "slow-index.ts");
    const counter = join(directory, "scans");
    const networkMarker = join(directory, "fetch-called");
    mkdirSync(join(directory, "sessions"));
    mkdirSync(join(directory, "archived_sessions"));
    writeFileSync(join(directory, "archived_sessions", "old.jsonl"), JSON.stringify({
      type: "token_usage_record", timestamp: "2020-01-01T00:00:00Z",
      payload: { session_id: "old", usage: { input_tokens: 7, total_tokens: 7 } },
    }));
    writeFileSync(preload, `import { SessionIndexer } from ${JSON.stringify(join(repository, "src/core/session-indexer.ts"))};
      import { appendFileSync } from "node:fs";
      globalThis.fetch = async () => { appendFileSync(${JSON.stringify(networkMarker)}, "fetch"); throw new Error("offline fixture"); };
      const original = SessionIndexer.prototype.indexAll;
      SessionIndexer.prototype.indexAll = function (...args) {
        appendFileSync(${JSON.stringify(counter)}, "scan\\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1800);
        return original.apply(this, args);
      };`);
    const child = spawn(process.execPath, ["--preload", preload, "src/cli/index.ts", "mcp"], {
      cwd: repository, env: { ...process.env, CODEX_HOME: directory }, stdio: ["pipe", "pipe", "pipe"],
    });
    const responses = new Map<number, (value: any) => void>();
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => { const response = JSON.parse(line); responses.get(response.id)?.(response); });
    let id = 0;
    const request = (method: string, params?: any): Promise<any> => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => reject(new Error(`No MCP response for ${key}`)), 4000);
      responses.set(key, (response) => { clearTimeout(timer); responses.delete(key); resolve(response); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: key, method, params }) + "\n");
    });
    try {
      await request("initialize");
      const started = performance.now();
      const first = request("tools/call", { name: "get_codex_usage_history" });
      const second = request("tools/call", { name: "get_codex_settlement_report" });
      const ping = await request("ping");
      expect(ping.result).toEqual({});
      expect(performance.now() - started).toBeLessThan(1000);
      for (const result of await Promise.all([first, second])) {
        expect(result.result.isError).toBe(true);
        expect(result.result.content[0].text).toContain("indexing is still running");
      }
      const completed = await request("tools/call", { name: "get_codex_usage_history" });
      expect(completed.result.isError).toBeUndefined();
      expect(JSON.parse(completed.result.content[0].text).recentRecordsTotal).toBe(1);
      expect(readFileSync(counter, "utf8")).toBe("scan\n");
      expect(existsSync(networkMarker)).toBe(false);
    } finally {
      const exited = once(child, "exit");
      child.stdin.end();
      await exited;
      lines.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);

  test("bounds result limits and rejects invalid numeric values", () => {
    expect(parseMcpLimit(25, 10)).toBe(25);
    expect(parseMcpLimit(50_000, 10)).toBe(1_000);
    expect(parseMcpLimit(-1, 10)).toBe(10);
    expect(parseMcpLimit(1.5, 10)).toBe(10);
    expect(parseMcpLimit(Number.POSITIVE_INFINITY, 10)).toBe(10);
    expect(parseMcpLimit("100", 10)).toBe(10);
  });

  test("stdio survives invalid input, acknowledges ping, and does not reply to notifications", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-mcp-protocol-"));
    const requests = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "{", "null", "[]", JSON.stringify({ jsonrpc: "1.0", id: 2, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: {}, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: "invalid" }),
      JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: "alive", method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    ];
    try {
      const result = spawnSync(process.execPath, ["src/cli/index.ts", "mcp"], {
        cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: directory },
        input: requests.join("\n") + "\n", encoding: "utf8", timeout: 5000,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(responses).toHaveLength(9);
      expect(responses[0].result.protocolVersion).toBe("2024-11-05");
      expect(responses.slice(1, 6).map((response) => [response.id, response.error.code])).toEqual([
        [null, -32700], [null, -32600], [null, -32600], [null, -32600], [null, -32600],
      ]);
      expect(responses[6]).toMatchObject({ id: 3, error: { code: -32602 } });
      expect(responses[7]).toEqual({ jsonrpc: "2.0", id: "alive", result: {} });
      expect(responses[8].result.tools).toHaveLength(6);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("accepts unknown as an explicit role without broadening invalid filters", () => {
    expect(parseMcpAgentRole("main")).toBe("main");
    expect(parseMcpAgentRole("subagent")).toBe("subagent");
    expect(parseMcpAgentRole("unknown")).toBe("unknown");
    expect(parseMcpAgentRole("all")).toBeUndefined();
    expect(parseMcpAgentRole(1)).toBeUndefined();
  });
});
