import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HistoryDatabase } from "../src/core/history-db.js";
import { createSqliteDb } from "../src/core/sqlite-adapter.js";
import type { TokenRecord, QuotaResetEvent, PlanChangeEvent } from "../src/core/types.js";

describe("HistoryDatabase", () => {
  let dbPath: string;
  let db: HistoryDatabase;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `test_db_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
    db = new HistoryDatabase(dbPath);
    await db.init();
  });

  afterEach(() => {
    try {
      db.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
    } catch {}
  });

  test("restricts new and existing WAL sidecars while another connection stays open", async () => {
    const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    for (const path of paths) expect(statSync(path).mode & 0o777).toBe(0o600);
    db.updateCursor("permission-check", 1, 2, 3);
    for (const path of paths) chmodSync(path, 0o644);
    const secondConnection = new HistoryDatabase(dbPath);
    try {
      await secondConnection.init();
      for (const path of paths) expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(secondConnection.getCursor("permission-check")?.recordsCount).toBe(3);
      db.updateCursor("permission-check", 4, 5, 6);
      expect(secondConnection.getCursor("permission-check")?.recordsCount).toBe(6);
    } finally {
      secondConnection.close();
    }
  });

  test("正確初始化檔案游標並支援 getCursor 與 updateCursor", () => {
    const filePath = "/tmp/fake_session.jsonl";
    expect(db.getCursor(filePath)).toBeNull();

    db.updateCursor(filePath, 12345678, 1024, 15);
    const cursor = db.getCursor(filePath);
    expect(cursor).not.toBeNull();
    expect(cursor?.mtime).toBe(12345678);
    expect(cursor?.size).toBe(1024);
    expect(cursor?.recordsCount).toBe(15);

    // 測試 UPSERT 更新覆蓋
    db.updateCursor(filePath, 87654321, 2048, 25);
    const updatedCursor = db.getCursor(filePath);
    expect(updatedCursor?.mtime).toBe(87654321);
    expect(updatedCursor?.size).toBe(2048);
    expect(updatedCursor?.recordsCount).toBe(25);
  });

  test("批次寫入 Token 紀錄並正確統計主代理人與 subAgent 消耗", () => {
    const now = Date.now();
    const records: TokenRecord[] = [
      {
        timestamp: now - 3000,
        datetime: new Date(now - 3000).toISOString(),
        sessionId: "session-1",
        threadId: "thread-1",
        turnId: "turn-1",
        model: "gpt-6-astra",
        inputTokens: 1000,
        cachedInputTokens: 200,
        outputTokens: 500,
        reasoningOutputTokens: 100,
        totalTokens: 1500,
        agentRole: "main",
      },
      {
        timestamp: now - 2000,
        datetime: new Date(now - 2000).toISOString(),
        sessionId: "session-1",
        threadId: "thread-2",
        turnId: "turn-2",
        model: "gpt-6-astra",
        inputTokens: 2000,
        cachedInputTokens: 500,
        outputTokens: 1000,
        reasoningOutputTokens: 300,
        totalTokens: 3000,
        agentRole: "subagent",
      },
    ];

    const inserted = db.insertBatch(records);
    expect(inserted).toBe(2);

    const summary = db.getSummary();
    expect(summary.requests).toBe(2);
    expect(summary.totalTokens).toBe(4500);
    expect(summary.subAgentTokens).toBe(3000);
    expect(summary.mainAgentTokens).toBe(1500);
    expect(summary.unknownAgentTokens).toBe(0);
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);
    expect(summary.pricingProvenance).toHaveLength(1);
    expect(summary.pricingProvenance[0].records).toBe(2);
    expect(summary.pricingProvenance[0].source).not.toBe("unknown");
    expect(summary.byModel.length).toBe(1);
    expect(summary.byModel[0].model).toBe("gpt-6-astra");
  });

  test("多週期結算能透過單次 CTE 查詢正確歸納主要模型且消除 N+1 查詢", () => {
    const now = Date.now();
    const records: TokenRecord[] = [
      {
        timestamp: now - 10000,
        datetime: new Date(now - 10000).toISOString(),
        sessionId: "session-a",
        threadId: "thread-a",
        turnId: "turn-a1",
        model: "gpt-5.6-sol",
        inputTokens: 5000,
        cachedInputTokens: 0,
        outputTokens: 2000,
        reasoningOutputTokens: 0,
        totalTokens: 7000,
        agentRole: "unknown",
      },
      {
        timestamp: now - 5000,
        datetime: new Date(now - 5000).toISOString(),
        sessionId: "session-a",
        threadId: "thread-a",
        turnId: "turn-a2",
        model: "gpt-6-astra",
        inputTokens: 10000,
        cachedInputTokens: 0,
        outputTokens: 5000,
        reasoningOutputTokens: 0,
        totalTokens: 15000,
        agentRole: "main",
      },
    ];

    db.insertBatch(records);

    const settlements = db.getSettlementRecords("daily", 10);
    expect(settlements.length).toBe(1);
    expect(settlements[0].totalTokens).toBe(22000);
    expect(settlements[0].mainAgentTokens).toBe(15000);
    expect(settlements[0].subAgentTokens).toBe(0);
    expect(settlements[0].unknownAgentTokens).toBe(7000);
    expect(settlements[0].pricingProvenance[0].records).toBe(2);
    // 總量最大者應為 gpt-6-astra (15000 > 7000)
    expect(settlements[0].topModel).toBe("gpt-6-astra");
  });

  test("支援全表重新計價 recalculateAllCosts", () => {
    const now = Date.now();
    const records: TokenRecord[] = [
      {
        timestamp: now - 1000,
        datetime: new Date(now - 1000).toISOString(),
        sessionId: "s1",
        threadId: "t1",
        turnId: "turn-reprice",
        model: "gpt-6-astra",
        inputTokens: 10000,
        cachedInputTokens: 0,
        outputTokens: 5000,
        reasoningOutputTokens: 0,
        totalTokens: 15000,
        costUsd: 0, // 初始為 0
      },
    ];
    db.insertBatch(records);

    const count = db.recalculateAllCosts();
    expect(count).toBe(1);

    const latest = db.getLatestRecord();
    expect(latest?.costUsd).toBeGreaterThan(0);
    expect(latest?.pricingSource).not.toBe("unknown");
    expect(latest?.pricingVersion).not.toBe("unknown");
  });

  test("舊版預設 main 與既有成本來源保守遷移為 unknown，強制再索引只回填明確角色", async () => {
    db.close();
    for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(path)) unlinkSync(path);
    }

    const legacyDatabase = await createSqliteDb(dbPath);
    legacyDatabase.exec(`
      CREATE TABLE token_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        datetime TEXT NOT NULL,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        response_id TEXT,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        agent_role TEXT NOT NULL DEFAULT 'main',
        cost_usd REAL NOT NULL DEFAULT 0.0,
        five_hour_used_pct REAL,
        weekly_used_pct REAL,
        source_file TEXT,
        UNIQUE(session_id, turn_id, model, timestamp)
      )
    `);
    legacyDatabase.exec(`
      INSERT INTO token_records (
        timestamp, datetime, session_id, thread_id, turn_id, model,
        input_tokens, total_tokens, agent_role, cost_usd, source_file
      ) VALUES (
        1000, '1970-01-01T00:00:01.000Z', 'legacy-session', 'legacy-thread',
        'legacy-turn', 'gpt-6-astra', 100, 100, 'main', 1.23, '/tmp/legacy.jsonl'
      )
    `);
    legacyDatabase.close();

    db = new HistoryDatabase(dbPath);
    await db.init();
    const migrated = db.getLatestRecord();
    expect(migrated?.agentRole).toBe("unknown");
    expect(migrated?.costUsd).toBe(1.23);
    expect(migrated?.pricingSource).toBe("unknown");
    expect(migrated?.pricingVersion).toBe("unknown");

    const record = {
      ...migrated!,
      id: undefined,
      agentRole: "main" as const,
      costUsd: undefined,
      pricingSource: undefined,
      pricingVersion: undefined,
    };
    expect(db.insertBatch([record], undefined, { updateExistingMetadata: true })).toBe(0);
    const reindexed = db.getLatestRecord();
    expect(reindexed?.agentRole).toBe("main");
    expect(reindexed?.costUsd).toBe(1.23);
    expect(reindexed?.pricingSource).toBe("unknown");
  });

  test("支援配額重置事件與方案變更事件之寫入與查詢", () => {
    const now = Date.now();
    const resetEvent: QuotaResetEvent = {
      timestamp: now,
      datetime: new Date(now).toISOString(),
      eventType: "credit_received",
      previousFiveHourUsedPercent: 80,
      newFiveHourUsedPercent: 10,
      previousWeeklyUsedPercent: 50,
      newWeeklyUsedPercent: 45,
      availableCredits: 3,
      creditDelta: 1,
      description: "收到測試重置券",
    };

    const insertedReset = db.insertResetEvent(resetEvent);
    expect(insertedReset).toBe(true);

    const resetEvents = db.getResetEvents(10);
    expect(resetEvents.length).toBe(1);
    expect(resetEvents[0].eventType).toBe("credit_received");
    expect(resetEvents[0].availableCredits).toBe(3);

    const planEvent: PlanChangeEvent = {
      timestamp: now,
      datetime: new Date(now).toISOString(),
      previousPlan: "plus",
      newPlan: "pro",
      changeType: "upgrade",
      description: "升級至 Pro 方案",
    };

    const insertedPlan = db.insertPlanChangeEvent(planEvent);
    expect(insertedPlan).toBe(true);

    const planEvents = db.getPlanChangeEvents(10);
    expect(planEvents.length).toBe(1);
    expect(planEvents[0].changeType).toBe("upgrade");
  });
});
