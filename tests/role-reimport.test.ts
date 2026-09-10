import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";
import { createSqliteDb } from "../src/core/sqlite-adapter.js";

test("source role detection and deleted records survive ordinary and forced reimport", async () => {
  const root = mkdtempSync(join(tmpdir(), "role-reimport-"));
  const path = join(root, "history.sqlite");
  const db = new HistoryDatabase(path);
  await db.init();
  const sql = await createSqliteDb(path);
  try {
    const indexer = new SessionIndexer(db);
    const file = join(root, "session.jsonl");
    const usage = { type: "token_usage_record", timestamp: "2026-09-10T00:00:00Z", payload: { turn_id: "turn", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } };
    const write = (source: unknown, parent?: string, extra: unknown[] = []) => writeFileSync(file, [
      { type: "session_meta", payload: { id: "session", source, parent_thread_id: parent } }, usage, ...extra,
    ].map(x => JSON.stringify(x)).join("\n"));
    for (const source of ["cli", "vscode", "exec", "mcp"]) {
      write(source);
      expect(indexer.parseFile(file).records[0].agentRole).toBe("main");
    }
    write("vscode", "parent");
    expect(indexer.parseFile(file).records[0].agentRole).toBe("subagent");
    write({ subagent: { thread_spawn: { parent_thread_id: "parent" } } });
    expect(indexer.parseFile(file).records[0].agentRole).toBe("subagent");
    write("unrecognized");
    expect(indexer.parseFile(file).records[0].agentRole).toBe("unknown");
    write("vscode");
    expect(indexer.indexFile(file).insertedCount).toBe(1);
    write("vscode", "parent");
    indexer.indexFile(file, true);
    expect(sql.prepare("SELECT agent_role FROM token_records").get()?.agent_role).toBe("subagent");
    sql.exec("DELETE FROM token_records");
    expect(indexer.indexFile(file, true).insertedCount).toBe(0);
    write("vscode", undefined, [{ ...usage, timestamp: "2026-09-10T00:01:00Z" }]);
    expect(indexer.indexFile(file).insertedCount).toBe(1);
    expect(sql.prepare("SELECT count(*) AS n FROM token_records").get()?.n).toBe(1);
    expect(sql.prepare("SELECT count(*) AS n FROM deleted_token_records").get()?.n).toBe(1);
  } finally { sql.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});


test("version 1 databases receive deletion protection on upgrade", async () => {
  const root = mkdtempSync(join(tmpdir(), "role-migration-"));
  const path = join(root, "history.sqlite");
  const db = new HistoryDatabase(path);
  try {
    await db.init();
    db.close();
    const sql = await createSqliteDb(path);
    sql.exec("DROP TRIGGER remember_deleted_token_record; DROP TRIGGER prevent_deleted_token_reimport; DROP TABLE deleted_token_records; PRAGMA user_version = 1;");
    sql.close();
    await db.init();
    const upgraded = await createSqliteDb(path);
    try {
      expect(upgraded.prepare("PRAGMA user_version").get().user_version).toBe(2);
      expect(upgraded.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name IN ('remember_deleted_token_record', 'prevent_deleted_token_reimport')").get().n).toBe(2);
    } finally { upgraded.close(); }
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
