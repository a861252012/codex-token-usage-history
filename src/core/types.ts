/**
 * Codex 配額與 Token 消耗紀錄的型別定義
 */

export interface QuotaWindow {
  /** 已使用百分比 (0 - 100) */
  usedPercent: number;
  /** 剩餘可用百分比 (0 - 100) */
  remainingPercent: number;
  /** 限制視窗秒數 (例: 18000 代表 5 小時, 604800 代表 7 天) */
  limitWindowSeconds: number;
  /** 重設倒數秒數 */
  resetAfterSeconds: number;
  /** 重設時間戳記 (毫秒) */
  resetAtMs: number;
  /** 人類可讀重設倒數字串 (例: "4小時 25分", "6天 2小時") */
  resetCountdown: string;
}

export interface AdditionalQuotaLimit {
  limitName: string;
  meteredFeature: string;
  primaryWindow: QuotaWindow | null;
  secondaryWindow: QuotaWindow | null;
}

export interface QuotaSnapshot {
  /** 抓取或更新時間戳記 (毫秒) */
  updatedAt: number;
  /** 帳號 Email */
  email: string | null;
  /** 方案類型 (例: prolite, plus, pro, team) */
  planType: string | null;
  /** 五小時限制視窗 (短時間滾動配額) */
  fiveHour: QuotaWindow | null;
  /** 一週限制視窗 (7天滾動配額) */
  weekly: QuotaWindow | null;
  /** 附加模型配額 (例: GPT-5.3-Codex-Spark) */
  additionalLimits: AdditionalQuotaLimit[];
  /** 可用重設信用額度次數 */
  resetCredits: number;
  /** 資料來源: "wham" (官方 API), "cache" (本機快取), "fallback" */
  source: "wham" | "cache" | "fallback";
}

export interface TokenRecord {
  id?: number;
  timestamp: number;
  datetime: string;
  sessionId: string;
  threadId: string;
  turnId: string;
  responseId?: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  fiveHourUsedPct?: number | null;
  weeklyUsedPct?: number | null;
  sourceFile?: string;
}

export interface ModelUsageStats {
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface UsageSummary {
  requests: number;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  byModel: ModelUsageStats[];
  hourlyBurnRate: number;
  timeRange: {
    startMs: number;
    endMs: number;
  };
}

export interface FilterOptions {
  limit?: number;
  offset?: number;
  sinceMs?: number;
  model?: string;
  sessionId?: string;
}
