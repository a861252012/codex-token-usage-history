import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";

describe("SessionIndexer", () => {
  let dbPath: string;
  let db: HistoryDatabase;
  let tempJsonlFile: string;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `test_indexer_db_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
    db = new HistoryDatabase(dbPath);
    await db.init();

    tempJsonlFile = join(tmpdir(), `test_session_${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try {
      db.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(tempJsonlFile)) unlinkSync(tempJsonlFile);
    } catch {}
  });

  test("正確解析 Session JSONL 內容並記錄 Token 消耗", () => {
    const jsonlContent = [
      JSON.stringify({
        type: "session_meta",
        payload: { id: "test-sess-1", provenance: { model: "gpt-6-astra" } },
      }),
      JSON.stringify({
        type: "token_usage_record",
        timestamp: "2026-09-09T10:00:00.000Z",
        payload: {
          session_id: "test-sess-1",
          thread_id: "main-thread",
          turn_id: "turn-1",
          usage: {
            input_tokens: 1500,
            cached_input_tokens: 500,
            output_tokens: 800,
            reasoning_output_tokens: 200,
            total_tokens: 2300,
          },
        },
      }),
    ].join("\n");

    writeFileSync(tempJsonlFile, jsonlContent, "utf-8");

    const indexer = new SessionIndexer(db);
    const { records } = indexer.parseFile(tempJsonlFile);
    expect(records.length).toBe(1);
    expect(records[0].sessionId).toBe("test-sess-1");
    expect(records[0].model).toBe("gpt-6-astra");
    expect(records[0].totalTokens).toBe(2300);
    expect(records[0].inputTokens).toBe(1500);
    expect(records[0].cachedInputTokens).toBe(500);
  });

  test("UUID thread_id 不會覆蓋已標記的 subagent 身分", () => {
    writeFileSync(tempJsonlFile, [
      { type: "session_meta", payload: { id: "child-session", agent_role: "subagent" } },
      { type: "event_msg", payload: { thread_id: "123e4567-e89b-12d3-a456-426614174000" } },
      {
        type: "token_usage_record", timestamp: "2026-09-09T10:00:00.000Z",
        payload: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      },
    ].map((event) => JSON.stringify(event)).join("\n"));
    const { records } = new SessionIndexer(db).parseFile(tempJsonlFile);
    expect(records).toHaveLength(1);
    expect(records[0].agentRole).toBe("subagent");
  });

  test("增量索引能記錄游標並在二次調用時自動略過未異動檔案", () => {
    const jsonlContent = [
      JSON.stringify({
        type: "session_meta",
        payload: { id: "test-sess-2", provenance: { model: "gpt-5.6-sol" } },
      }),
      JSON.stringify({
        type: "token_usage_record",
        timestamp: "2026-09-09T11:00:00.000Z",
        payload: {
          session_id: "test-sess-2",
          thread_id: "main-thread",
          turn_id: "turn-1",
          usage: {
            input_tokens: 500,
            output_tokens: 200,
            total_tokens: 700,
          },
        },
      }),
    ].join("\n");

    writeFileSync(tempJsonlFile, jsonlContent, "utf-8");

    const indexer = new SessionIndexer(db);

    // 第一次索引：應成功寫入 1 筆紀錄並建立游標
    const result1 = indexer.indexFile(tempJsonlFile);
    expect(result1.insertedCount).toBe(1);
    expect(result1.newRecords.length).toBe(1);

    const cursor = db.getCursor(tempJsonlFile);
    expect(cursor).not.toBeNull();
    expect(cursor?.recordsCount).toBe(1);

    // 第二次索引（檔案未異動且 force=false）：應直接略過，insertedCount 為 0
    const result2 = indexer.indexFile(tempJsonlFile);
    expect(result2.insertedCount).toBe(0);
    expect(result2.newRecords.length).toBe(0);
  });

  test("拒絕無效 token 數值並移除終端控制字元", () => {
    writeFileSync(tempJsonlFile, [
      {
        type: "session_meta",
        payload: { id: "safe\u001b[31m-session", provenance: { model: "gpt-safe\u202emodel" } },
      },
      {
        type: "token_usage_record",
        timestamp: "2026-09-09T10:00:00.000Z",
        payload: {
          thread_id: "thread\n-id",
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
      {
        type: "token_usage_record",
        timestamp: "not-a-date",
        payload: { usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 } },
      },
      {
        type: "token_usage_record",
        timestamp: "2026-09-09T10:01:00.000Z",
        payload: { usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 } },
      },
    ].map((event) => JSON.stringify(event)).join("\n"));

    const { records } = new SessionIndexer(db).parseFile(tempJsonlFile);
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).not.toContain("\u001b");
    expect(records[0].model).toBe("gpt-safemodel");
    expect(records[0].threadId).toBe("thread-id");
  });

  test("incremental events contain only inserted records even when duplicates are interleaved", () => {
    const event = (turn: string) => JSON.stringify({
      type: "token_usage_record", timestamp: "2026-09-09T12:00:00.000Z",
      payload: { session_id: "duplicates", turn_id: turn, usage: { input_tokens: 10, total_tokens: 10 } },
    });
    const indexer = new SessionIndexer(db);
    writeFileSync(tempJsonlFile, event("old"));
    expect(indexer.indexFile(tempJsonlFile).insertedCount).toBe(1);
    writeFileSync(tempJsonlFile, [event("new"), event("old"), event("new")].join("\n"));
    const result = indexer.indexFile(tempJsonlFile, true);
    expect(result.insertedCount).toBe(1);
    expect(result.newRecords.map((record) => record.turnId)).toEqual(["new"]);
    expect(indexer.indexFile(tempJsonlFile, true).newRecords).toEqual([]);
  });

  test("session_meta 支援 source.subagent 與 parent_thread_id 辨識，且 turn_context 缺少 role 不會覆寫為 main", () => {
    // 1. source.subagent 與 parent_thread_id 結構
    writeFileSync(tempJsonlFile, [
      { type: "session_meta", payload: { id: "guardian-subagent", source: { subagent: { other: "guardian" } }, parent_thread_id: "parent-123" } },
      { type: "turn_context", payload: { model: "gpt-5" } },
      {
        type: "token_usage_record", timestamp: "2026-09-09T12:00:00.000Z",
        payload: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      },
    ].map((event) => JSON.stringify(event)).join("\n"));

    const indexer = new SessionIndexer(db);
    const { records: records1 } = indexer.parseFile(tempJsonlFile);
    expect(records1).toHaveLength(1);
    expect(records1[0].agentRole).toBe("subagent");

    // 2. explicit agent_role 搭配無 role 的 turn_context
    writeFileSync(tempJsonlFile, [
      { type: "session_meta", payload: { id: "child-subagent", agent_role: "subagent" } },
      { type: "turn_context", payload: { model: "gpt-5.6" } },
      {
        type: "token_usage_record", timestamp: "2026-09-09T12:05:00.000Z",
        payload: { usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } },
      },
    ].map((event) => JSON.stringify(event)).join("\n"));

    const { records: records2 } = indexer.parseFile(tempJsonlFile);
    expect(records2).toHaveLength(1);
    expect(records2[0].agentRole).toBe("subagent");
  });
});
