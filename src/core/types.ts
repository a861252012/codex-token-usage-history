/**
 * Codex 配額與 Token 消耗紀錄的型別定義
 * 嚴格遵循語意化命名，杜絕模糊縮寫
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
  /** 是否為 Pro 級方案 (pro / prolite，或 WHAM 僅有週視窗而無五小時視窗) */
  proTier: boolean;
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
  /** fallback 失敗原因 (成功快照可省略；舊快取可能沒有此欄) */
  errorReason?: string | null;
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
  /** 代理人角色 (main 代表主對話，subagent 代表衍生子代理人) */
  agentRole?: string;
  /** 等值官方 API 美元金額 (USD) */
  costUsd?: number;
  fiveHourUsedPercent?: number | null;
  weeklyUsedPercent?: number | null;
  // 向下相容別名
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
  costUsd: number;
}

export interface UsageSummary {
  requests: number;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  mainAgentTokens: number;
  subAgentTokens: number;
  estimatedCostUsd: number;
  formattedCostUsd: string;
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
  agentRole?: string;
}

export interface FileScanCursor {
  filePath: string;
  mtime: number;
  size: number;
  lastScannedAt: number;
  recordsCount: number;
}

/**
 * OpenAI 配額重置事件與重置券變動歷史紀錄
 */
export interface QuotaResetEvent {
  id?: number;
  timestamp: number;
  datetime: string;
  eventType: "periodic_reset" | "credit_change" | "credit_received" | "credit_consumed" | "manual_reset";
  previousFiveHourUsedPercent: number | null;
  newFiveHourUsedPercent: number | null;
  previousWeeklyUsedPercent: number | null;
  newWeeklyUsedPercent: number | null;
  availableCredits: number;
  creditDelta: number;
  description: string;
}

/**
 * 多週期結算項目 (每日、每週、每月、每年)
 */
export interface SettlementRecord {
  periodKey: string;
  startDate: string;
  endDate: string;
  requests: number;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  mainAgentTokens: number;
  subAgentTokens: number;
  estimatedCostUsd: number;
  formattedCostUsd: string;
  topModel: string;
}

/**
 * 方案變更事件 (升級、降級、方案切換紀錄)
 */
export interface PlanChangeEvent {
  id?: number;
  timestamp: number;
  datetime: string;
  previousPlan: string;
  newPlan: string;
  changeType: "upgrade" | "downgrade" | "change" | "initial";
  description: string;
}
