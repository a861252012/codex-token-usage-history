import { test, expect, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDatabase } from "../src/core/history-db.js";
import { createSqliteDb } from "../src/core/sqlite-adapter.js";
import type { TokenRecord } from "../src/core/types.js";

describe("階段二：資料庫查詢優化與報表修復測試", () => {
    describe("1. 報表聚合查詢修復與假造值移除", () => {
        test("空資料表時呼叫 getSettlementRecords 應直接回傳空陣列", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-settlement-empty-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const dailyRecords = database.getSettlementRecords("daily", 10);
                const weeklyRecords = database.getSettlementRecords("weekly", 10);
                const monthlyRecords = database.getSettlementRecords("monthly", 10);
                const yearlyRecords = database.getSettlementRecords("yearly", 10);

                expect(dailyRecords).toEqual([]);
                expect(weeklyRecords).toEqual([]);
                expect(monthlyRecords).toEqual([]);
                expect(yearlyRecords).toEqual([]);
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("移除寫死的假造模型名稱，查無模型時應回傳 unknown", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-fake-model-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const connection = await createSqliteDb(path);

                // 直接插入一筆 model 為空字串之例外紀錄，驗證 fallback 不會變為 gpt-6-astra
                const now = Date.now();
                const nowIso = new Date(now).toISOString();
                connection.prepare(`
                    INSERT INTO token_records (
                        timestamp, datetime, session_id, thread_id, turn_id, model,
                        input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
                        total_tokens, agent_role, cost_usd, pricing_source, pricing_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    now, nowIso, "sess-empty-model", "thread-1", "turn-1", "",
                    100, 0, 50, 0,
                    150, "main", 0.001, "builtin", "2026-09-12"
                );
                connection.close();

                const settlements = database.getSettlementRecords("daily", 10);
                expect(settlements.length).toBe(1);
                // 由於 model 為空字串，查無模型名稱時應忠實回傳 unknown，絕不得假造為 gpt-6-astra
                expect(settlements[0].topModel).toBe("unknown");
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("次級聚合僅回傳分頁所選週期的模型與定價來源", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-scoped-aggregation-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();

                const dayMs = 86400 * 1000;
                const baseTimestamp = new Date("2026-09-10T12:00:00Z").getTime();
                const testRecords: TokenRecord[] = [];

                // 產生連續 5 天的紀錄，每天有不同的定價來源與模型
                for (let index = 0; index < 5; index += 1) {
                    const recordTimestamp = baseTimestamp - index * dayMs;
                    testRecords.push({
                        timestamp: recordTimestamp,
                        datetime: new Date(recordTimestamp).toISOString(),
                        sessionId: `session-day-${index}`,
                        threadId: `thread-day-${index}`,
                        turnId: `turn-day-${index}`,
                        model: `model-day-${index}`,
                        inputTokens: 1000 * (index + 1),
                        cachedInputTokens: 0,
                        outputTokens: 500 * (index + 1),
                        reasoningOutputTokens: 0,
                        totalTokens: 1500 * (index + 1),
                        costUsd: 0.05 * (index + 1),
                        agentRole: index % 2 === 0 ? "main" : "subagent",
                        pricingSource: index % 2 === 0 ? "builtin" : "user-config",
                        pricingVersion: `v${index}`,
                    });
                }

                database.insertBatch(testRecords);

                // 只查詢最新的 2 天 (limitCount = 2)
                const pagedSettlements = database.getSettlementRecords("daily", 2);
                expect(pagedSettlements.length).toBe(2);

                // 驗證回傳的最新兩天之模型與定價來源正確
                expect(pagedSettlements[0].topModel).toBe("model-day-0");
                expect(pagedSettlements[1].topModel).toBe("model-day-1");

                expect(pagedSettlements[0].pricingProvenance.length).toBe(1);
                expect(pagedSettlements[0].pricingProvenance[0].source).toBe("builtin");
                expect(pagedSettlements[0].pricingProvenance[0].version).toBe("v0");

                expect(pagedSettlements[1].pricingProvenance.length).toBe(1);
                expect(pagedSettlements[1].pricingProvenance[0].source).toBe("user-config");
                expect(pagedSettlements[1].pricingProvenance[0].version).toBe("v1");
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("支援 daily, weekly, monthly, yearly 各週期並忠實呈現真實數據", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-periods-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const now = Date.now();
                database.insertRecord({
                    timestamp: now,
                    datetime: new Date(now).toISOString(),
                    sessionId: "period-session",
                    threadId: "period-thread",
                    turnId: "period-turn",
                    model: "gpt-5-mini",
                    inputTokens: 200,
                    cachedInputTokens: 50,
                    outputTokens: 80,
                    reasoningOutputTokens: 20,
                    totalTokens: 280,
                    costUsd: 0.0004,
                    agentRole: "main",
                    pricingSource: "builtin",
                    pricingVersion: "2026-09-12",
                });

                for (const period of ["daily", "weekly", "monthly", "yearly"] as const) {
                    const settlements = database.getSettlementRecords(period, 5);
                    expect(settlements.length).toBe(1);
                    expect(settlements[0].topModel).toBe("gpt-5-mini");
                    expect(settlements[0].totalTokens).toBe(280);
                    expect(settlements[0].pricingProvenance[0].source).toBe("builtin");
                }
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("同週期不同模型消耗量相等時，topModel 應具備確定性平手排序 (依 model 字典序)", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-tie-model-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const now = Date.now();
                // 插入兩筆相同 token 量但不同名稱之模型紀錄
                database.insertBatch([
                    {
                        timestamp: now - 1000,
                        datetime: new Date(now - 1000).toISOString(),
                        sessionId: "tie-sess-1",
                        threadId: "th-1",
                        turnId: "tu-1",
                        model: "model-z-later",
                        inputTokens: 100,
                        cachedInputTokens: 0,
                        outputTokens: 100,
                        reasoningOutputTokens: 0,
                        totalTokens: 200,
                        agentRole: "main",
                        costUsd: 0.001,
                    },
                    {
                        timestamp: now,
                        datetime: new Date(now).toISOString(),
                        sessionId: "tie-sess-2",
                        threadId: "th-2",
                        turnId: "tu-2",
                        model: "model-a-first",
                        inputTokens: 100,
                        cachedInputTokens: 0,
                        outputTokens: 100,
                        reasoningOutputTokens: 0,
                        totalTokens: 200,
                        agentRole: "main",
                        costUsd: 0.001,
                    },
                ]);

                const settlements = database.getSettlementRecords("daily", 10);
                expect(settlements.length).toBe(1);
                // 兩者 tokens 相同時，依 model 字典序穩定選取 model-a-first
                expect(settlements[0].topModel).toBe("model-a-first");
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("大量分頁週期 (超過 500 筆) 次級查詢能自動分塊執行，不超限 SQLite 參數且正確組裝報表", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-large-chunks-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const connection = await createSqliteDb(path);
                const baseTime = Date.now();
                const dayMs = 86400 * 1000;

                // 產生 550 個不同天數的紀錄以跨越 500 個參數門檻
                connection.exec("BEGIN TRANSACTION;");
                for (let index = 0; index < 550; index += 1) {
                    const recordTime = baseTime - index * dayMs;
                    connection.prepare(`
                        INSERT INTO token_records (
                            timestamp, datetime, session_id, thread_id, turn_id, model,
                            input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
                            total_tokens, agent_role, cost_usd, pricing_source, pricing_version
                        ) VALUES (?, ?, ?, ?, ?, ?, 10, 0, 10, 0, 20, 'main', 0.0001, 'builtin', 'v1')
                    `).run(recordTime, new Date(recordTime).toISOString(), `sess-${index}`, "th", `turn-${index}`, `m-${index % 5}`);
                }
                connection.exec("COMMIT;");
                connection.close();

                const settlements = database.getSettlementRecords("daily", 550);
                expect(settlements.length).toBe(550);
                expect(settlements[0].topModel).toBeDefined();
                expect(settlements[0].pricingProvenance.length).toBe(1);
                expect(settlements[549].pricingProvenance.length).toBe(1);
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });
    });

    describe("2. 複合查詢索引評估與 EXPLAIN QUERY PLAN 驗證", () => {
        test("資料庫結構包含複合索引 idx_token_records_agent_role_timestamp 與 idx_token_records_session_id_timestamp", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-indexes-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const connection = await createSqliteDb(path);
                try {
                    const indexes = connection.prepare(`
                        SELECT name FROM sqlite_master
                        WHERE type = 'index' AND tbl_name = 'token_records'
                    `).all().map((row: any) => row.name);

                    expect(indexes).toContain("idx_token_records_agent_role_timestamp");
                    expect(indexes).toContain("idx_token_records_session_id_timestamp");
                    expect(indexes).toContain("idx_token_records_timestamp");
                    expect(indexes).toContain("idx_token_records_session_id");
                    expect(indexes).toContain("idx_token_records_agent_role");
                } finally {
                    connection.close();
                }
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("EXPLAIN QUERY PLAN 驗證 agent_role 過濾並依 timestamp 倒序排序已消除 TEMP B-TREE", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-explain-role-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const connection = await createSqliteDb(path);
                try {
                    // 執行 EXPLAIN QUERY PLAN
                    const planRows = connection.prepare(`
                        EXPLAIN QUERY PLAN
                        SELECT * FROM token_records
                        WHERE agent_role = ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                    `).all("main", 10);

                    const planDetails = planRows.map((row: any) => row.detail).join(" | ");
                    const tempBTreeUsed = planRows.some((row: any) => row.detail.includes("USE TEMP B-TREE"));

                    // 驗證已消除臨時 B-Tree 排序
                    expect(tempBTreeUsed).toBe(false);
                    // 驗證正確使用複合索引
                    expect(planDetails).toContain("idx_token_records_agent_role_timestamp");
                } finally {
                    connection.close();
                }
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("EXPLAIN QUERY PLAN 驗證 session_id 過濾並依 timestamp 倒序排序已消除 TEMP B-TREE", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-explain-session-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const connection = await createSqliteDb(path);
                try {
                    const planRows = connection.prepare(`
                        EXPLAIN QUERY PLAN
                        SELECT * FROM token_records
                        WHERE session_id = ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                    `).all("session-target-id", 10);

                    const planDetails = planRows.map((row: any) => row.detail).join(" | ");
                    const tempBTreeUsed = planRows.some((row: any) => row.detail.includes("USE TEMP B-TREE"));

                    expect(tempBTreeUsed).toBe(false);
                    expect(planDetails).toContain("idx_token_records_session_id_timestamp");
                } finally {
                    connection.close();
                }
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("EXPLAIN QUERY PLAN 驗證複合過濾 (agent_role + timestamp 範圍) 排序無 TEMP B-TREE", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-explain-composite-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const connection = await createSqliteDb(path);
                try {
                    const planRows = connection.prepare(`
                        EXPLAIN QUERY PLAN
                        SELECT * FROM token_records
                        WHERE agent_role = ? AND timestamp >= ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                    `).all("subagent", Date.now() - 3600000, 20);

                    const planDetails = planRows.map((row: any) => row.detail).join(" | ");
                    const tempBTreeUsed = planRows.some((row: any) => row.detail.includes("USE TEMP B-TREE"));

                    expect(tempBTreeUsed).toBe(false);
                    expect(planDetails).toContain("idx_token_records_agent_role_timestamp");
                } finally {
                    connection.close();
                }
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("queryRecords 方法在包含 agentRole 與 sessionId 條件時正常運作並正確回傳紀錄", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-query-records-"));
            const path = join(directory, "history.sqlite");
            const database = new HistoryDatabase(path);
            try {
                await database.init();
                const now = Date.now();
                database.insertBatch([
                    {
                        timestamp: now - 3000,
                        datetime: new Date(now - 3000).toISOString(),
                        sessionId: "target-session",
                        threadId: "thread-1",
                        turnId: "turn-1",
                        model: "model-a",
                        inputTokens: 100,
                        cachedInputTokens: 0,
                        outputTokens: 50,
                        reasoningOutputTokens: 0,
                        totalTokens: 150,
                        agentRole: "main",
                        costUsd: 0.001,
                    },
                    {
                        timestamp: now - 2000,
                        datetime: new Date(now - 2000).toISOString(),
                        sessionId: "target-session",
                        threadId: "thread-1",
                        turnId: "turn-2",
                        model: "model-b",
                        inputTokens: 200,
                        cachedInputTokens: 0,
                        outputTokens: 100,
                        reasoningOutputTokens: 0,
                        totalTokens: 300,
                        agentRole: "subagent",
                        costUsd: 0.002,
                    },
                    {
                        timestamp: now - 1000,
                        datetime: new Date(now - 1000).toISOString(),
                        sessionId: "other-session",
                        threadId: "thread-2",
                        turnId: "turn-3",
                        model: "model-c",
                        inputTokens: 300,
                        cachedInputTokens: 0,
                        outputTokens: 150,
                        reasoningOutputTokens: 0,
                        totalTokens: 450,
                        agentRole: "subagent",
                        costUsd: 0.003,
                    },
                ]);

                // 過濾 sessionId
                const sessionResult = database.queryRecords({ sessionId: "target-session" });
                expect(sessionResult.total).toBe(2);
                expect(sessionResult.records.length).toBe(2);
                // 驗證依 timestamp 倒序排列
                expect(sessionResult.records[0].turnId).toBe("turn-2");
                expect(sessionResult.records[1].turnId).toBe("turn-1");

                // 過濾 agentRole
                const roleResult = database.queryRecords({ agentRole: "subagent" });
                expect(roleResult.total).toBe(2);
                expect(roleResult.records.length).toBe(2);
                expect(roleResult.records[0].sessionId).toBe("other-session");
                expect(roleResult.records[1].sessionId).toBe("target-session");
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });
    });

    describe("3. 既有資料庫相容性與初始化冪等性", () => {
        test("補建索引失敗後釋放連線，修復資料表後可重新初始化", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-init-retry-"));
            const path = join(directory, "history.sqlite");
            const connection = await createSqliteDb(path);
            const database = new HistoryDatabase(path);
            try {
                connection.exec("PRAGMA user_version = 2;");
                await expect(database.init()).rejects.toThrow();
                connection.exec("CREATE TABLE token_records (agent_role TEXT, session_id TEXT, timestamp INTEGER);");
                await database.init();
                const indexes = connection.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all();
                expect(indexes.map((row: any) => row.name)).toContain("idx_token_records_session_id_timestamp");
            } finally {
                database.close();
                connection.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("既有 user_version = 2 資料庫升級時平滑補齊複合索引且不修改 user_version", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-upgrade-v2-"));
            const path = join(directory, "history.sqlite");

            // 手動建立一個模擬舊版已存在之 user_version = 2 資料庫（缺少新複合索引）
            const manualConnection = await createSqliteDb(path);
            manualConnection.exec(`
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
                    agent_role TEXT NOT NULL DEFAULT 'unknown',
                    cost_usd REAL NOT NULL DEFAULT 0.0,
                    pricing_source TEXT NOT NULL DEFAULT 'unknown',
                    pricing_version TEXT NOT NULL DEFAULT 'unknown',
                    five_hour_used_pct REAL,
                    weekly_used_pct REAL,
                    source_file TEXT,
                    UNIQUE(session_id, turn_id, model, timestamp)
                );
                CREATE INDEX idx_token_records_timestamp ON token_records(timestamp);
                CREATE INDEX idx_token_records_session_id ON token_records(session_id);
                CREATE INDEX idx_token_records_agent_role ON token_records(agent_role);
                CREATE TABLE deleted_token_records (
                    session_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    PRIMARY KEY(session_id, turn_id, model, timestamp)
                );
                PRAGMA user_version = 2;
            `);
            manualConnection.close();

            // 啟動 HistoryDatabase 執行 init()
            const database = new HistoryDatabase(path);
            try {
                await database.init();

                const verifyConnection = await createSqliteDb(path);
                try {
                    // user_version 依然維持為 2，不破壞相容性
                    expect(verifyConnection.prepare("PRAGMA user_version").get().user_version).toBe(2);

                    // 複合索引已順利補齊
                    const indexes = verifyConnection.prepare(`
                        SELECT name FROM sqlite_master
                        WHERE type = 'index' AND tbl_name = 'token_records'
                    `).all().map((row: any) => row.name);
                    expect(indexes).toContain("idx_token_records_agent_role_timestamp");
                    expect(indexes).toContain("idx_token_records_session_id_timestamp");

                    // 記錄當前 schema_version
                    const schemaVersionBefore = verifyConnection.prepare("PRAGMA schema_version").get().schema_version;

                    // 重複呼叫 init()，確認完全冪等且不會二次修改結構或報錯
                    database.close();
                    await database.init();

                    const schemaVersionAfter = verifyConnection.prepare("PRAGMA schema_version").get().schema_version;
                    expect(schemaVersionAfter).toBe(schemaVersionBefore);
                } finally {
                    verifyConnection.close();
                }
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });

        test("既有 user_version = 2 資料庫若僅存在單一複合索引時，升級應自動補齊另一複合索引", async () => {
            const directory = mkdtempSync(join(tmpdir(), "phase2-partial-index-"));
            const path = join(directory, "history.sqlite");

            // 手動建立僅具備 idx_token_records_agent_role_timestamp 的 user_version = 2 資料庫
            const manualConnection = await createSqliteDb(path);
            manualConnection.exec(`
                CREATE TABLE token_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    datetime TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    thread_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    agent_role TEXT NOT NULL DEFAULT 'unknown'
                );
                CREATE INDEX idx_token_records_agent_role_timestamp ON token_records(agent_role, timestamp DESC);
                PRAGMA user_version = 2;
            `);
            manualConnection.close();

            const database = new HistoryDatabase(path);
            try {
                await database.init();

                const verifyConnection = await createSqliteDb(path);
                try {
                    const indexes = verifyConnection.prepare(`
                        SELECT name FROM sqlite_master
                        WHERE type = 'index' AND tbl_name = 'token_records'
                    `).all().map((row: any) => row.name);

                    // 驗證原本缺少的 session_id_timestamp 複合索引被補齊，原有索引依然存在
                    expect(indexes).toContain("idx_token_records_agent_role_timestamp");
                    expect(indexes).toContain("idx_token_records_session_id_timestamp");
                    expect(verifyConnection.prepare("PRAGMA user_version").get().user_version).toBe(2);
                } finally {
                    verifyConnection.close();
                }
            } finally {
                database.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });
    });
});
