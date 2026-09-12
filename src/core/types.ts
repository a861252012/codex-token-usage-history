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
  /** 取得此快照的帳號；舊快取或來源未提供時無法確認。 */
  accountId?: string | null;
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
  /** 相容數值欄位保留 0；只有此值為 true 才代表來源確實回傳可用張數。 */
  resetCreditsKnown?: boolean;
  /** 資料來源: "wham" (官方 API), "cache" (本機快取), "fallback" */
  source: "wham" | "cache" | "fallback";
  /** fallback 失敗原因 (成功快照可省略；舊快取可能沒有此欄) */
  errorReason?: string | null;
}

export type AgentRole = "main" | "subagent" | "unknown";

export type PricingSource =
  | "user-config"
  | "upstream-cache"
  | "builtin"
  | "fallback"
  | "unknown";

export interface PricingProvenanceBreakdown {
  source: PricingSource;
  version: string;
  /** 使用此定價來源與版本的 Token 紀錄筆數 */
  records: number;
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
  /** 代理人角色；無明確來源證據時為 unknown */
  agentRole?: AgentRole;
  /** 等值官方 API 美元金額 (USD) */
  costUsd?: number;
  /** 此筆成本實際採用的定價來源；舊資料無法還原時為 unknown */
  pricingSource?: PricingSource;
  /** 此筆成本實際採用的定價版本；舊資料無法還原時為 unknown */
  pricingVersion?: string;
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
  /** Token 紀錄筆數；不是外部 API 呼叫次數 */
  requests: number;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  mainAgentTokens: number;
  subAgentTokens: number;
  unknownAgentTokens: number;
  estimatedCostUsd: number;
  formattedCostUsd: string;
  pricingProvenance: PricingProvenanceBreakdown[];
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
  agentRole?: AgentRole;
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
  eventType: "usage_drop" | "periodic_reset" | "credit_change" | "credit_received" | "credit_consumed" | "manual_reset";
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
  /** Token 紀錄筆數；不是外部 API 呼叫次數 */
  requests: number;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  mainAgentTokens: number;
  subAgentTokens: number;
  unknownAgentTokens: number;
  estimatedCostUsd: number;
  formattedCostUsd: string;
  pricingProvenance: PricingProvenanceBreakdown[];
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
