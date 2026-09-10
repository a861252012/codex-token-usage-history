import { expect, test } from "bun:test";
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createSqliteDb } from "../src/core/sqlite-adapter.js";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";
import { writePrivateFileAtomic } from "../src/core/atomic-file.js";

const repository = join(import.meta.dir, "..");

test("cache replacement preserves open readers and private permissions, and cleans failed writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-atomic-"));
  const path = join(directory, "snapshot.json");
  writeFileSync(path, '{"version":1}', { mode: 0o644 });
  const oldReader = openSync(path, "r");
  try {
    writePrivateFileAtomic(path, '{"version":2}');
    expect(JSON.parse(readFileSync(oldReader, "utf8"))).toEqual({ version: 1 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 2 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    mkdirSync(join(directory, "blocked"));
    expect(() => writePrivateFileAtomic(join(directory, "blocked"), "content")).toThrow();
    expect(readdirSync(directory).sort()).toEqual(["blocked", "snapshot.json"]);
  } finally {
    closeSync(oldReader);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("chunked JSONL parsing preserves split UTF-8, long lines, malformed lines and the last unterminated record", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-chunks-"));
  const database = new HistoryDatabase(":memory:");
  await database.init();
  try {
    const prefix = '{"type":"session_meta","payload":{"id":"';
    const metadata = " ".repeat(65535 - Buffer.byteLength(prefix)) + prefix + '測試","source":"cli"}}';
    const record = (turn: string) => JSON.stringify({ type: "token_usage_record", timestamp: "2026-09-10T00:00:00Z", payload: { turn_id: turn, usage: { input_tokens: 10, total_tokens: 10 } } });
    const path = join(directory, "sample.jsonl");
    writeFileSync(path, [metadata, record("first"), "{broken", JSON.stringify({ type: "response_item", payload: "x".repeat(150_000) }), record("last")].join("\r\n"));
    const indexer = new SessionIndexer(database, directory);
    expect(indexer.indexFile(path).insertedCount).toBe(2);
    expect(database.queryRecords({ limit: 10 }).records.map((record) => record.sessionId)).toEqual(["測試", "測試"]);
    expect(indexer.getDiagnostics().invalidLines).toBe(1);
    expect(indexer.getDiagnostics().unsupportedEvents).toBe(1);
    expect(indexer.indexFile(path).insertedCount).toBe(0);
    expect(indexer.getDiagnostics().filesUnchanged).toBe(1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const runtime of ["bun", "node"]) {
  test(`${runtime} SQLite waits for a competing writer and keeps schema initialization idempotent`, async () => {
    const directory = mkdtempSync(join(tmpdir(), `codex-sqlite-${runtime}-`));
    const path = join(directory, "history.sqlite");
    const database = new HistoryDatabase(path);
    await database.init();
    const connection = await createSqliteDb(path);
    let holder: ReturnType<typeof spawn> | undefined;
    try {
      const before = connection.prepare("PRAGMA schema_version").get().schema_version;
      expect(connection.prepare("PRAGMA user_version").get().user_version).toBe(1);
      database.close();
      await database.init();
      expect(connection.prepare("PRAGMA schema_version").get().schema_version).toBe(before);
      const build = await Bun.build({ entrypoints: [join(repository, "src/core/sqlite-adapter.ts")], outdir: directory, target: "node" });
      expect(build.success).toBe(true);
      const adapter = join(directory, "sqlite-adapter.js");
      const writer = join(directory, "writer.mjs");
      writeFileSync(writer, `import { createSqliteDb } from ${JSON.stringify(adapter)};
        const db = await createSqliteDb(${JSON.stringify(path)});
        db.exec("BEGIN IMMEDIATE");
        process.stdout.write("locked\\n");
        setTimeout(() => { db.exec("COMMIT"); db.close(); }, 400);`);
      holder = spawn(process.execPath, [writer], { stdio: ["ignore", "pipe", "pipe"] });
      await once(holder.stdout!, "data");
      const result = spawnSync(runtime === "bun" ? process.execPath : "node", ["--input-type=module", "--eval", `
        import { createSqliteDb } from ${JSON.stringify(adapter)};
        const db = await createSqliteDb(${JSON.stringify(path)});
        if (db.prepare("PRAGMA busy_timeout").get().timeout !== 5000) throw new Error("missing busy timeout");
        db.prepare("INSERT INTO file_scan_cursor VALUES (?, ?, ?, ?, ?)").run("writer", 1, 2, 3, 4);
        db.close();
      `], { encoding: "utf8", timeout: 5000 });
      expect(result.status, result.stderr).toBe(0);
      expect(database.getCursor("writer")?.recordsCount).toBe(4);
    } finally {
      holder?.kill();
      connection.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);
}

test("MCP bootstraps history only once for repeated report requests", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-mcp-scan-"));
  try {
    const preload = join(directory, "count-scans.ts");
    const counts = join(directory, "counts.json");
    writeFileSync(preload, `import { SessionIndexer } from ${JSON.stringify(join(repository, "src/core/session-indexer.ts"))};
      import { writeFileSync } from "node:fs";
      const counts = { all: 0, recent: 0 };
      for (const [method, key] of [["indexAll", "all"], ["indexRecent", "recent"]]) {
        const original = SessionIndexer.prototype[method];
        SessionIndexer.prototype[method] = function (...args) { counts[key] += 1; writeFileSync(${JSON.stringify(counts)}, JSON.stringify(counts)); return original.apply(this, args); };
      }`);
    const requests = ["get_codex_usage_history", "get_codex_settlement_report", "get_codex_usage_history"].map((name, id) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name } })).join("\n");
    const result = spawnSync(process.execPath, ["--preload", preload, "src/cli/index.ts", "mcp"], {
      cwd: repository, env: { ...process.env, CODEX_HOME: directory }, input: requests + "\n", encoding: "utf8", timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n").map((line) => JSON.parse(line).error)).toEqual([undefined, undefined, undefined]);
    expect(JSON.parse(readFileSync(counts, "utf8"))).toEqual({ all: 1, recent: 0 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI record and event tables show the same local instant across timezones", () => {
  for (const [timezone, expected] of [["Asia/Taipei", "2026-09-10 08:30:00"], ["America/New_York", "2026-09-09 20:30:00"]]) {
    const result = spawnSync(process.execPath, ["--eval", `
      import { renderRecentRecords, renderResetEventsTable, renderPlanChangeEventsTable } from "./src/cli/formatters.ts";
      const record = { timestamp: Date.parse("2026-09-10T00:30:00Z"), datetime: "2026-09-10T00:30:00Z", model: "test", agentRole: "main", inputTokens: 1, outputTokens: 1, totalTokens: 2, eventType: "periodic_reset", creditDelta: 0, availableCredits: 0, description: "test", previousPlan: "plus", newPlan: "pro", changeType: "upgrade" };
      console.log(JSON.stringify([renderRecentRecords([record]), renderResetEventsTable([record]), renderPlanChangeEventsTable([record])]));
    `], { cwd: repository, env: { ...process.env, TZ: timezone }, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    for (const output of JSON.parse(result.stdout)) {
      expect(output).toContain(expected);
      expect(output).not.toContain("UTC+8");
    }
  }
});
