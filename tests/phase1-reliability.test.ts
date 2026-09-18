import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuotaClient } from "../src/core/quota-client.js";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";
import { SessionWatcher } from "../src/core/session-watcher.js";
import {
  getStringDisplayWidth,
  getCharacterWidth,
  stripAnsi,
  truncateDisplay,
  padEndDisplay,
  padStartDisplay,
  fitDisplay,
  renderUsageSummary,
  renderRecentRecords,
} from "../src/cli/formatters.js";
import type { UsageSummary, TokenRecord } from "../src/core/types.js";

describe("階段一：可靠性防線與基礎體驗修復測試", () => {
  describe("1. QuotaClient 快取身分識別與缺少 account_id 穿透修復", () => {
    test("當 auth.json 缺少 account_id 時，30 秒本機快取仍正常生效不被強制穿透", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "codex-test-no-account-id-"));
      const db = new HistoryDatabase(":memory:");
      await db.init();
      const originalFetch = globalThis.fetch;

      try {
        // auth.json 僅有 access_token，缺少 account_id
        writeFileSync(join(tempDir, "auth.json"), JSON.stringify({
          tokens: { access_token: "token-without-account-id" },
        }));

        let fetchCallCount = 0;
        globalThis.fetch = async () => {
          fetchCallCount++;
          return new Response(JSON.stringify({
            plan_type: "pro",
            rate_limit: {
              primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_after_seconds: 3600 },
            },
          }));
        };

        const client = new QuotaClient(tempDir, db);

        // 第一次呼叫：發起遠端請求
        const first = await client.getQuotaSnapshot(false);
        expect(fetchCallCount).toBe(1);
        expect(first.planType).toBe("pro");

        // 第二次呼叫：在 30 秒快取期內，不得穿透快取
        const second = await client.getQuotaSnapshot(false);
        expect(fetchCallCount).toBe(1);
        expect(second.planType).toBe("pro");
        expect(second.updatedAt).toBe(first.updatedAt);
      } finally {
        globalThis.fetch = originalFetch;
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("更換 access_token 後，即使兩者皆無 account_id，憑證指紋不同仍會清空快取以隔離身分", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "codex-test-token-rotate-"));
      const db = new HistoryDatabase(":memory:");
      await db.init();
      const originalFetch = globalThis.fetch;

      try {
        writeFileSync(join(tempDir, "auth.json"), JSON.stringify({
          tokens: { access_token: "token-user-alpha" },
        }));

        let returnedPlan = "plus";
        globalThis.fetch = async () => new Response(JSON.stringify({
          plan_type: returnedPlan,
          rate_limit: {
            primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 3600 },
          },
        }));

        const client = new QuotaClient(tempDir, db);
        const snapshotA = await client.getQuotaSnapshot(false);
        expect(snapshotA.planType).toBe("plus");

        // 切換為另一個無 account_id 的 token
        returnedPlan = "team";
        writeFileSync(join(tempDir, "auth.json"), JSON.stringify({
          tokens: { access_token: "token-user-beta" },
        }));

        const snapshotB = await client.getQuotaSnapshot(false);
        expect(snapshotB.planType).toBe("team");
      } finally {
        globalThis.fetch = originalFetch;
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("computeAuthFingerprint 使用空字元分隔，防止帳號與 Token 碰撞偽造", () => {
      const { computeAuthFingerprint } = require("../src/core/quota-client.js");
      const hash1 = computeAuthFingerprint({ accountId: "a:b", accessToken: "c" });
      const hash2 = computeAuthFingerprint({ accountId: "a", accessToken: "b:c" });
      expect(hash1).not.toBe(hash2);
    });

    test("當缺少 account_id 時，具備相同憑證指紋仍能正確偵測配額重置事件", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "codex-test-reset-fingerprint-"));
      const db = new HistoryDatabase(":memory:");
      await db.init();

      try {
        writeFileSync(join(tempDir, "auth.json"), JSON.stringify({
          tokens: { access_token: "same-token-no-acc-id" },
        }));

        const client = new QuotaClient(tempDir, db);
        const clientAny = client as any;

        // 模擬第一次快照 (4 張券)
        const snap1 = {
          updatedAt: Date.now() - 10000,
          accountId: "",
          authFingerprint: "fingerprint-xyz",
          email: "test@example.com",
          planType: "pro",
          proTier: true,
          fiveHour: { usedPercent: 50, remainingPercent: 50, limitWindowSeconds: 18000, resetAfterSeconds: 3600, resetAtMs: Date.now() + 3600000 },
          weekly: null,
          additionalLimits: [],
          resetCredits: 4,
          resetCreditsKnown: true,
          source: "wham" as const,
        };
        clientAny.cachedSnapshot = snap1;

        // 第二次快照 (使用 1 張券，剩 3 張券)
        const snap2 = {
          ...snap1,
          updatedAt: Date.now(),
          resetCredits: 3,
        };

        clientAny.detectAndRecordResetEvents(snap2);
        const resetEvents = db.getResetEvents(5);
        expect(resetEvents.length).toBe(1);
        expect(resetEvents[0].eventType).toBe("credit_consumed");
        expect(resetEvents[0].creditDelta).toBe(-1);
      } finally {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("切換帳號或憑證時，detectAndRecordPlanChanges 不會誤記跨帳號方案調整", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "codex-test-plan-change-isolate-"));
      const db = new HistoryDatabase(":memory:");
      await db.init();

      try {
        const client = new QuotaClient(tempDir, db);
        const clientAny = client as any;

        // 用戶 A 方案 plus
        const snapA = {
          updatedAt: Date.now() - 5000,
          accountId: "user-alpha",
          authFingerprint: "fingerprint-alpha",
          email: "alpha@example.com",
          planType: "plus",
          proTier: false,
          fiveHour: null,
          weekly: null,
          additionalLimits: [],
          resetCredits: 0,
          source: "wham" as const,
        };
        clientAny.cachedSnapshot = snapA;

        // 用戶 B 方案 pro
        const snapB = {
          updatedAt: Date.now(),
          accountId: "user-beta",
          authFingerprint: "fingerprint-beta",
          email: "beta@example.com",
          planType: "pro",
          proTier: true,
          fiveHour: null,
          weekly: null,
          additionalLimits: [],
          resetCredits: 0,
          source: "wham" as const,
        };

        clientAny.detectAndRecordPlanChanges(snapB);
        const planEvents = db.getPlanChangeEvents(5);
        // 跨帳號切換不得寫入方案升降級
        expect(planEvents.length).toBe(0);
      } finally {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("2. 終端機 CJK/ANSI 顯示寬度對齊與截斷", () => {
    test("字元寬度計算符合 East Asian Width 規範", () => {
      expect(getCharacterWidth("a".charCodeAt(0))).toBe(1);
      expect(getCharacterWidth("1".charCodeAt(0))).toBe(1);
      expect(getCharacterWidth(" ".charCodeAt(0))).toBe(1);
      expect(getCharacterWidth("中".charCodeAt(0))).toBe(2);
      expect(getCharacterWidth("文".charCodeAt(0))).toBe(2);
      expect(getCharacterWidth("模".charCodeAt(0))).toBe(2);
      expect(getCharacterWidth("型".charCodeAt(0))).toBe(2);
      expect(getCharacterWidth("（".charCodeAt(0))).toBe(2);
      expect(getCharacterWidth("，".charCodeAt(0))).toBe(2);
      expect(getCharacterWidth("\n".charCodeAt(0))).toBe(0);
    });

    test("字串顯示寬度正確剝離 ANSI 跳脫序列並精確計算全形中文寬度", () => {
      expect(getStringDisplayWidth("abc")).toBe(3);
      expect(getStringDisplayWidth("中文測試")).toBe(8);
      expect(getStringDisplayWidth("model: gpt-4o")).toBe(13);
      expect(getStringDisplayWidth("\x1b[32m升級 (Upgrade)\x1b[0m")).toBe(14);
      expect(stripAnsi("\x1b[31m錯誤訊息\x1b[0m")).toBe("錯誤訊息");
    });

    test("truncateDisplay 與 fitDisplay 嚴格依顯示欄寬截斷，不截斷全形字", () => {
      // 最大寬度 7，3 個中文佔 6，第 4 個中文寬度 2 無法放入，應保留前 3 個字
      expect(truncateDisplay("測試資料字串", 7)).toBe("測試資");
      expect(getStringDisplayWidth(truncateDisplay("測試資料字串", 7))).toBe(6);

      // fitDisplay 會補齊至目標寬度 7
      const fitted = fitDisplay("測試資料字串", 7);
      expect(fitted).toBe("測試資 ");
      expect(getStringDisplayWidth(fitted)).toBe(7);

      // 英文也是精確寬度 7
      const fittedEn = fitDisplay("abcdefghijk", 7);
      expect(fittedEn).toBe("abcdefg");
      expect(getStringDisplayWidth(fittedEn)).toBe(7);
    });

    test("表格標頭與資料列顯示寬度嚴格垂直對齊", () => {
      const headerText = fitDisplay("模型名稱", 24);
      const rowTextAscii = fitDisplay("gpt-4o", 24);
      const rowTextChinese = fitDisplay("自訂模型標籤", 24);

      expect(getStringDisplayWidth(headerText)).toBe(24);
      expect(getStringDisplayWidth(rowTextAscii)).toBe(24);
      expect(getStringDisplayWidth(rowTextChinese)).toBe(24);

      // 數值右對齊
      const headerNum = padStartDisplay("紀錄數", 8);
      const rowNum = padStartDisplay("123", 8);
      expect(getStringDisplayWidth(headerNum)).toBe(8);
      expect(getStringDisplayWidth(rowNum)).toBe(8);
    });

    test("renderUsageSummary 與 renderRecentRecords 產生之表格每列寬度一致", () => {
      const summary: UsageSummary = {
        requests: 10,
        totalTokens: 50000,
        inputTokens: 30000,
        cachedInputTokens: 10000,
        outputTokens: 20000,
        reasoningOutputTokens: 5000,
        mainAgentTokens: 40000,
        subAgentTokens: 10000,
        unknownAgentTokens: 0,
        estimatedCostUsd: 0.15,
        formattedCostUsd: "$0.15",
        pricingProvenance: [{ source: "builtin", version: "v1", records: 10 }],
        byModel: [
          {
            model: "gpt-4o",
            requests: 5,
            inputTokens: 15000,
            cachedInputTokens: 5000,
            outputTokens: 10000,
            reasoningOutputTokens: 2500,
            totalTokens: 25000,
            costUsd: 0.08,
          },
          {
            model: "o3-mini",
            requests: 5,
            inputTokens: 15000,
            cachedInputTokens: 5000,
            outputTokens: 10000,
            reasoningOutputTokens: 2500,
            totalTokens: 25000,
            costUsd: 0.07,
          },
        ],
        hourlyBurnRate: 1000,
        timeRange: { startMs: 0, endMs: 0 },
      };

      const renderedSummary = renderUsageSummary(summary);
      const lines = renderedSummary.split("\n");
      const modelHeaderLine = lines.find((line) => line.includes("模型名稱"));
      expect(modelHeaderLine).toBeDefined();
      for (const model of summary.byModel) {
        const row = lines.find((line) => line.includes(model.model))!;
        expect(getStringDisplayWidth(row)).toBe(getStringDisplayWidth(modelHeaderLine!));
      }

      const record: TokenRecord = {
        timestamp: Date.now(),
        datetime: new Date().toISOString(),
        sessionId: "session-1",
        threadId: "thread-1",
        turnId: "turn-1",
        model: "gpt-4o",
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningOutputTokens: 0,
        totalTokens: 150,
        agentRole: "main",
        costUsd: 0.001,
        weeklyUsedPercent: 12,
        pricingSource: "builtin",
        pricingVersion: "v1",
      };

      const renderedRecent = renderRecentRecords([record]);
      expect(renderedRecent).toContain("本機時間");
      expect(renderedRecent).toContain("gpt-4o");
      const recentLines = renderedRecent.split("\n");
      const recentHeader = recentLines.find((line) => line.includes("本機時間"))!;
      const recentRow = recentLines.find((line) => line.includes("gpt-4o"))!;
      expect(getStringDisplayWidth(recentRow)).toBe(getStringDisplayWidth(recentHeader));
    });

    test("truncateDisplay 截斷包含 ANSI 顏色字串時，必自動補上重設序列，防止色彩滲漏", () => {
      const colored = "\x1b[32m升級 (Upgrade)\x1b[0m";
      const truncated = truncateDisplay(colored, 10);
      expect(truncated.endsWith("\x1b[0m")).toBe(true);
      expect(stripAnsi(truncated)).toBe("升級 (Upgr");
    });

    test("renderPlanChangeEventsTable 升降級事件完整呈現，不裁切單字且垂直對齊", () => {
      const { renderPlanChangeEventsTable } = require("../src/cli/formatters.js");
      const rendered = renderPlanChangeEventsTable([
        { timestamp: Date.now(), previousPlan: "plus", newPlan: "pro", changeType: "upgrade", description: "方案升級" },
        { timestamp: Date.now(), previousPlan: "pro", newPlan: "plus", changeType: "downgrade", description: "方案降級" },
      ]);
      expect(rendered).toContain("升級 (Upgrade)");
      expect(rendered).toContain("降級 (Downgrade)");
      expect(rendered).not.toContain("Upgrad ");
    });
  });

  describe("3. SessionWatcher 節流冷卻機制", () => {
    for (const coolingDown of [false, true]) {
      test(`停止時仍在等待配額回應，不得再發事件或建立計時器 (cooldown=${coolingDown})`, async () => {
        const directory = mkdtempSync(join(tmpdir(), "watcher-stop-pending-"));
        let resolveSnapshot!: (value: any) => void;
        const pendingSnapshot = new Promise((resolve) => { resolveSnapshot = resolve; });
        const watcher = new SessionWatcher(
          { indexRecent: () => ({ recordsInserted: 0, newRecords: [] }) } as any,
          { getQuotaSnapshot: () => pendingSnapshot } as any,
          directory,
        );
        const internals = watcher as any;
        let events = 0;
        watcher.on("quotaUpdated", () => events++);
        try {
          watcher.start();
          if (coolingDown) internals.lastForcedRefreshTimestamp = Date.now();
          const refresh = internals.refreshQuotaThrottled();
          watcher.stop();
          resolveSnapshot({ source: "fallback" });
          await refresh;
          expect(events).toBe(0);
          expect(internals.pendingQuotaRefreshTimer).toBeNull();
        } finally {
          watcher.stop();
          rmSync(directory, { recursive: true, force: true });
        }
      });
    }

    test("短時間內連續觸發新紀錄時，強制刷新受到 15 秒冷卻保護", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "codex-test-throttle-"));
      const db = new HistoryDatabase(":memory:");
      await db.init();
      const originalFetch = globalThis.fetch;

      try {
        writeFileSync(join(tempDir, "auth.json"), JSON.stringify({
          tokens: { access_token: "test-token", account_id: "test-acc" },
        }));

        let networkCalls = 0;
        globalThis.fetch = async () => {
          networkCalls++;
          return new Response(JSON.stringify({
            plan_type: "pro",
            rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } },
          }));
        };

        const client = new QuotaClient(tempDir, db);
        const indexer = new SessionIndexer(db, tempDir);
        const watcher = new SessionWatcher(indexer, client, tempDir);

        watcher.start();
        const watcherAny = watcher as any;
        // 第一次呼叫：初始冷卻已過，發起遠端請求
        await watcherAny.refreshQuotaThrottled();
        expect(networkCalls).toBe(1);

        // 立即再次呼叫：冷卻中，直接取快取，不發起遠端請求
        await watcherAny.refreshQuotaThrottled();
        expect(networkCalls).toBe(1);

        watcher.stop();
      } finally {
        globalThis.fetch = originalFetch;
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("SessionWatcher 停止後，背景尾隨節流定時器會被清理且狀態重設", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "codex-test-watcher-stop-"));
      const db = new HistoryDatabase(":memory:");
      await db.init();

      try {
        writeFileSync(join(tempDir, "auth.json"), JSON.stringify({
          tokens: { access_token: "test-token", account_id: "test-acc" },
        }));

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(JSON.stringify({
          plan_type: "pro",
          rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } },
        }));

        const client = new QuotaClient(tempDir, db);
        const indexer = new SessionIndexer(db, tempDir);
        const watcher = new SessionWatcher(indexer, client, tempDir);

        watcher.start();
        const watcherAny = watcher as any;

        // 第一次強制刷新
        await watcherAny.refreshQuotaThrottled();

        // 模擬短時間內第二次呼叫，觸發尾隨計時器排程
        watcherAny.lastForcedRefreshTimestamp = Date.now();
        await watcherAny.refreshQuotaThrottled();
        expect(watcherAny.pendingQuotaRefreshTimer).not.toBeNull();

        // 呼叫 stop()，確認定時器已被取消並重設為 null
        watcher.stop();
        expect(watcherAny.pendingQuotaRefreshTimer).toBeNull();
        expect(watcherAny.lastForcedRefreshTimestamp).toBe(0);

        globalThis.fetch = originalFetch;
      } finally {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("4. DashboardServer SSE 連線狀態檢查與錯誤捕獲", () => {
    test("SSE 用戶端連線結束或 socket 關閉時，broadcast 不崩潰並自動清理", async () => {
      const db = new HistoryDatabase(":memory:");
      await db.init();
      const { DashboardServer } = await import("../src/server/app.js");
      const server = new DashboardServer(db, { port: 0 });

      try {
        const serverAny = server as any;
        const mockResponse: any = {
          writableEnded: true,
          destroyed: true,
          write: () => {
            throw new Error("write after end");
          },
        };
        serverAny.serverSentEventClients.add(mockResponse);

        // broadcastServerSentEvent 不應拋出例外，且應將 mockResponse 移出 Set
        expect(() => {
          serverAny.broadcastServerSentEvent("test", { hello: "world" });
        }).not.toThrow();

        expect(serverAny.serverSentEventClients.has(mockResponse)).toBe(false);
      } finally {
        server.stop();
        db.close();
      }
    });

    test("SSE 用戶端 socket.writable 為 false 或未結束但無法寫入時自動移除", async () => {
      const db = new HistoryDatabase(":memory:");
      await db.init();
      const { DashboardServer } = await import("../src/server/app.js");
      const server = new DashboardServer(db, { port: 0 });

      try {
        const serverAny = server as any;
        const mockResponse: any = {
          writableEnded: false,
          destroyed: false,
          writable: false,
          socket: { destroyed: false, writable: false },
          write: () => {},
        };
        serverAny.serverSentEventClients.add(mockResponse);

        serverAny.broadcastServerSentEvent("test", { hello: "world" });
        expect(serverAny.serverSentEventClients.has(mockResponse)).toBe(false);
      } finally {
        server.stop();
        db.close();
      }
    });
  });
});
