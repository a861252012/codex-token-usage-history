import { describe, expect, test } from "bun:test";
import {
  renderPromptString,
  renderQuotaStatus,
  renderRecentRecords,
  renderSettlementTable,
  renderUsageSummary,
} from "../src/cli/formatters.js";
import type { QuotaSnapshot, SettlementRecord, TokenRecord, UsageSummary } from "../src/core/types.js";

function quotaSnapshot(overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
  return {
    updatedAt: Date.now(),
    email: null,
    planType: "plus",
    proTier: false,
    fiveHour: null,
    weekly: null,
    additionalLimits: [],
    resetCredits: 0,
    source: "wham",
    errorReason: null,
    ...overrides,
  };
}

describe("data semantics formatters", () => {
  test("摘要把 requests 顯示為紀錄筆數，並分列 unknown 與 mixed 定價來源", () => {
    const summary: UsageSummary = {
      requests: 3,
      totalTokens: 60,
      inputTokens: 40,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      mainAgentTokens: 10,
      subAgentTokens: 20,
      unknownAgentTokens: 30,
      estimatedCostUsd: 1,
      formattedCostUsd: "$1.00",
      pricingProvenance: [
        { source: "builtin", version: "v1", records: 2 },
        { source: "unknown", version: "unknown", records: 1 },
      ],
      byModel: [],
      hourlyBurnRate: 0,
      timeRange: { startMs: 0, endMs: 0 },
    };

    const output = renderUsageSummary(summary);
    expect(output).toContain("Token 紀錄筆數");
    expect(output).not.toContain("總計請求次數");
    expect(output).toContain("未知 30 tokens");
    expect(output).toContain("mixed: builtin@v1 (2 筆), unknown@unknown (1 筆)");
  });

  test("流水帳與結算表不把缺少角色或定價證據的資料偽裝為 main 或目前來源", () => {
    const record: TokenRecord = {
      timestamp: 1,
      datetime: new Date(1).toISOString(),
      sessionId: "s",
      threadId: "t",
      turnId: "turn",
      model: "model",
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 1,
      costUsd: 1,
    };
    expect(renderRecentRecords([record])).toContain("unknown@unknown");

    const settlement: SettlementRecord = {
      periodKey: "2026-09-10",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      requests: 1,
      totalTokens: 1,
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      mainAgentTokens: 0,
      subAgentTokens: 0,
      unknownAgentTokens: 1,
      estimatedCostUsd: 1,
      formattedCostUsd: "$1.00",
      pricingProvenance: [{ source: "unknown", version: "unknown", records: 1 }],
      topModel: "model",
    };
    const output = renderSettlementTable([settlement], "daily");
    expect(output).toContain("紀錄筆數");
    expect(output).toContain("未知角色");
    expect(output).toContain("unknown@unknown");
  });

  test("配額文字以兩分鐘為新鮮度門檻，並保留快取與失敗原因", () => {
    const fresh = quotaSnapshot();
    expect(renderQuotaStatus(fresh)).toContain("官方 API（即時）");
    expect(renderPromptString(fresh)).toBe("[Codex 5h: ? | 7d: ?]");

    const cached = quotaSnapshot({ source: "cache" });
    expect(renderQuotaStatus(cached)).toContain("本機快取（2 分鐘內）");
    expect(renderPromptString(cached)).toBe("[Codex 快取 | 5h: ? | 7d: ?]");

    const stale = quotaSnapshot({
      source: "cache",
      updatedAt: Date.now() - 120_001,
      errorReason: "401 Unauthorized",
    });
    expect(renderQuotaStatus(stale)).toContain("本機快取（已過期）");
    expect(renderQuotaStatus(stale)).toContain("取得失敗原因");
    expect(renderQuotaStatus(stale)).toContain("401 Unauthorized");
    expect(renderPromptString(stale)).toBe("[Codex: 配額已過期]");

    const unavailable = quotaSnapshot({ source: "fallback", errorReason: "auth.json 不存在" });
    expect(renderQuotaStatus(unavailable)).toContain("無可用資料");
    expect(renderPromptString(unavailable)).toBe("[Codex: 配額無法取得]");
  });

  test("Pro 方案有五小時視窗時照實顯示，缺少視窗時標為無法判定", () => {
    const fiveHour = {
      usedPercent: 25,
      remainingPercent: 75,
      limitWindowSeconds: 18_000,
      resetAfterSeconds: 3_600,
      resetAtMs: Date.now() + 3_600_000,
      resetCountdown: "1小時",
    };
    const withWindow = quotaSnapshot({ planType: "pro", proTier: true, fiveHour });
    const statusWithWindow = renderQuotaStatus(withWindow);
    expect(statusWithWindow).toContain("25% 已用");
    expect(statusWithWindow).not.toContain("無限額度");
    expect(renderPromptString(withWindow)).toContain("5h: 75%");

    const withoutWindow = quotaSnapshot({ planType: "pro", proTier: true, fiveHour: null });
    const statusWithoutWindow = renderQuotaStatus(withoutWindow);
    expect(statusWithoutWindow).toContain("五小時配額");
    expect(statusWithoutWindow).toContain("無資料（無法判定）");
    expect(statusWithoutWindow).not.toContain("無限額度");
    expect(renderPromptString(withoutWindow)).toContain("5h: ?");
  });

  test("未來時間戳不會被判定為即時資料", () => {
    const future = quotaSnapshot({ updatedAt: Date.now() + 60_000 });
    expect(renderQuotaStatus(future)).toContain("官方 API（已過期）");
    expect(renderPromptString(future)).toBe("[Codex: 配額已過期]");
  });
});
