import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";

describe("SessionIndexer diagnostics", () => {
  let scratchDirectory: string;
  let database: HistoryDatabase;
  let indexer: SessionIndexer;

  beforeEach(async () => {
    scratchDirectory = join(tmpdir(), `index-diagnostics-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratchDirectory, { recursive: true });
    database = new HistoryDatabase(join(scratchDirectory, "history.sqlite"));
    await database.init();
    indexer = new SessionIndexer(database, scratchDirectory);
  });

  afterEach(() => {
    database.close();
    if (existsSync(scratchDirectory)) rmSync(scratchDirectory, { recursive: true, force: true });
  });

  test("reports malformed JSON, unsupported events, invalid usage, range, and unknown role", () => {
    const sessionFile = join(scratchDirectory, "mixed.jsonl");
    writeFileSync(sessionFile, [
      "not-json",
      JSON.stringify({ type: "response_item", payload: { type: "message" } }),
      JSON.stringify({ type: "token_usage_record", payload: { usage: {} } }),
      JSON.stringify({
        type: "token_usage_record",
        timestamp: "2026-09-09T10:01:00.000Z",
        payload: {
          session_id: "unknown-role",
          thread_id: "not-a-subagent-role",
          subagent: "untrusted-truthy-value",
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        },
      }),
      JSON.stringify({ type: "turn_context", payload: { role: "main" } }),
      JSON.stringify({
        type: "token_usage_record",
        timestamp: "2026-09-09T10:02:00.000Z",
        payload: { session_id: "main-role", usage: { input_tokens: 5, total_tokens: 5 } },
      }),
    ].join("\n"));

    expect(indexer.indexFile(sessionFile).insertedCount).toBe(2);
    const { records } = database.queryRecords({ limit: 10 });
    expect(records.map((record) => record.agentRole)).toEqual(["main", "unknown"]);

    const diagnostics = indexer.getDiagnostics();
    expect(diagnostics.scope).toBe("file");
    expect(diagnostics.dataDirectory).toBe(scratchDirectory);
    expect(diagnostics.filesDiscovered).toBe(1);
    expect(diagnostics.filesRead).toBe(1);
    expect(diagnostics.filesFailed).toBe(0);
    expect(diagnostics.recordsParsed).toBe(2);
    expect(diagnostics.recordsInserted).toBe(2);
    expect(diagnostics.invalidLines).toBe(1);
    expect(diagnostics.unsupportedEvents).toBe(1);
    expect(diagnostics.invalidRecords).toBe(1);
    expect(diagnostics.dataStartMs).toBe(Date.parse("2026-09-09T10:01:00.000Z"));
    expect(diagnostics.dataEndMs).toBe(Date.parse("2026-09-09T10:02:00.000Z"));
    expect(diagnostics.lastSuccessfulScanAt).toBe(diagnostics.scannedAt);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics.missingDirectories)).toBe(true);
  });

  test("reports missing data directories with an explicit recent/all scope", () => {
    indexer.indexRecent(1);
    const recentDiagnostics = indexer.getDiagnostics();
    expect(recentDiagnostics.scope).toBe("recent");
    expect(recentDiagnostics.missingDirectories).toEqual([join(scratchDirectory, "sessions")]);
    expect(recentDiagnostics.lastSuccessfulScanAt).toBeNull();

    mkdirSync(join(scratchDirectory, "sessions"), { recursive: true });
    mkdirSync(join(scratchDirectory, "archived_sessions"), { recursive: true });
    indexer.indexAll();
    const allDiagnostics = indexer.getDiagnostics();
    expect(allDiagnostics.scope).toBe("all");
    expect(allDiagnostics.missingDirectories).toEqual([]);
    expect(allDiagnostics.lastSuccessfulScanAt).toBe(allDiagnostics.scannedAt);

    indexer.indexFile(join(scratchDirectory, "missing.jsonl"));
    const fileDiagnostics = indexer.getDiagnostics();
    expect(fileDiagnostics.scope).toBe("file");
    expect(fileDiagnostics.filesFailed).toBe(1);
    expect(fileDiagnostics.lastSuccessfulScanAt).toBe(allDiagnostics.lastSuccessfulScanAt);
  });

  test("does not advance a successful cursor when a file cannot be read", () => {
    const sessionFile = join(scratchDirectory, "unreadable.jsonl");
    writeFileSync(sessionFile, JSON.stringify({
      type: "token_usage_record",
      timestamp: "2026-09-09T10:00:00.000Z",
      payload: { usage: { input_tokens: 1, total_tokens: 1 } },
    }));
    expect(indexer.indexFile(sessionFile).insertedCount).toBe(1);
    const successfulCursor = database.getCursor(sessionFile);

    rmSync(sessionFile);
    mkdirSync(sessionFile);
    expect(indexer.indexFile(sessionFile, true).insertedCount).toBe(0);
    expect(database.getCursor(sessionFile)).toEqual(successfulCursor);
    expect(indexer.getDiagnostics().filesFailed).toBe(1);
  });

  test("counts unchanged files without reading them during a recent scan", () => {
    const sessionsDirectory = join(scratchDirectory, "sessions");
    mkdirSync(sessionsDirectory, { recursive: true });
    const sessionFile = join(sessionsDirectory, "unchanged.jsonl");
    writeFileSync(sessionFile, JSON.stringify({
      type: "token_usage_record",
      timestamp: "2026-09-09T10:00:00.000Z",
      payload: { usage: { input_tokens: 1, total_tokens: 1 } },
    }));

    indexer.indexFile(sessionFile);
    indexer.indexRecent(365);
    const diagnostics = indexer.getDiagnostics();
    expect(diagnostics.scope).toBe("recent");
    expect(diagnostics.filesDiscovered).toBe(1);
    expect(diagnostics.filesUnchanged).toBe(1);
    expect(diagnostics.filesRead).toBe(0);
    expect(diagnostics.recordsParsed).toBe(0);
  });

  test("forced full indexing repairs an existing unknown role from explicit source evidence", () => {
    const sessionsDirectory = join(scratchDirectory, "sessions");
    mkdirSync(sessionsDirectory, { recursive: true });
    mkdirSync(join(scratchDirectory, "archived_sessions"), { recursive: true });
    const sessionFile = join(sessionsDirectory, "role-repair.jsonl");
    const usageRecord = {
      type: "token_usage_record",
      timestamp: "2026-09-09T10:00:00.000Z",
      payload: { session_id: "repair", turn_id: "turn-1", usage: { input_tokens: 1, total_tokens: 1 } },
    };

    writeFileSync(sessionFile, JSON.stringify(usageRecord));
    indexer.indexFile(sessionFile);
    expect(database.queryRecords({ limit: 1 }).records[0].agentRole).toBe("unknown");

    writeFileSync(sessionFile, [
      JSON.stringify({ type: "turn_context", payload: { role: "main" } }),
      JSON.stringify(usageRecord),
    ].join("\n"));
    const result = indexer.indexAll(true);
    expect(result.recordsInserted).toBe(0);
    expect(database.queryRecords({ limit: 1 }).records[0].agentRole).toBe("main");
    expect(indexer.getDiagnostics().scope).toBe("all");
  });
});
