import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { QuotaSnapshot, QuotaWindow, AdditionalQuotaLimit } from "./types.js";

const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 30_000; // 快取 30 秒，避免頻繁請求打滿 API

export interface RawWhamResponse {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: RawWhamWindow | null;
    secondary_window?: RawWhamWindow | null;
  };
  additional_rate_limits?: Array<{
    limit_name?: string;
    metered_feature?: string;
    rate_limit?: {
      allowed?: boolean;
      limit_reached?: boolean;
      primary_window?: RawWhamWindow | null;
      secondary_window?: RawWhamWindow | null;
    };
  }>;
  rate_limit_reset_credits?: {
    available_count?: number;
    applicable_available_count?: number;
  };
}

export interface RawWhamWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

export class QuotaClient {
  private codexHome: string;
  private cachedSnapshot: QuotaSnapshot | null = null;
  private cachePath: string;

  private databaseInstance: import("./history-db.js").HistoryDatabase | null = null;

  constructor(codexHomeDirectory?: string, databaseInstance?: import("./history-db.js").HistoryDatabase) {
    this.codexHome = codexHomeDirectory || process.env.CODEX_HOME || join(homedir(), ".codex");
    this.cachePath = join(this.codexHome, "codex_quota_snapshot.json");
    this.databaseInstance = databaseInstance || null;
    this.loadPersistedCache();
  }

  /**
   * 設定歷史資料庫實例以供重置事件記錄
   */
  public setDatabase(databaseInstance: import("./history-db.js").HistoryDatabase): void {
    this.databaseInstance = databaseInstance;
  }

  /**
   * 格式化剩餘倒數時間為人可讀字串
   */
  public static formatCountdown(seconds: number): string {
    if (seconds <= 0) return "即將重設";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}天 ${hours}小時`;
    }
    if (hours > 0) {
      return `${hours}小時 ${minutes}分`;
    }
    const remainingSeconds = seconds % 60;
    return `${minutes}分 ${remainingSeconds}秒`;
  }

  /**
   * 從 ~/.codex/auth.json 讀取認證 Token
   */
  public readAuthTokens(): { accessToken: string; accountId: string } | null {
    try {
      const authPath = join(this.codexHome, "auth.json");
      if (!existsSync(authPath)) return null;
      const rawFileContent = readFileSync(authPath, "utf-8");
      const authPayload = JSON.parse(rawFileContent);
      const tokenCollection = authPayload.tokens;
      if (!tokenCollection || !tokenCollection.access_token) return null;
      return {
        accessToken: tokenCollection.access_token,
        accountId: tokenCollection.account_id || "",
      };
    } catch {
      return null;
    }
  }

  /**
   * 取得即時配額快照 (支援記憶體快取與即時強制重整)
   */
  public async getQuotaSnapshot(forceRefresh = false): Promise<QuotaSnapshot> {
    const currentTimeMs = Date.now();
    if (!forceRefresh && this.cachedSnapshot && (currentTimeMs - this.cachedSnapshot.updatedAt < CACHE_TTL_MS)) {
      return this.cachedSnapshot;
    }

    const authTokens = this.readAuthTokens();
    if (!authTokens) {
      return this.cachedSnapshot || this.getEmptyFallback("無法讀取認證資訊 (未登入 Codex)");
    }

    try {
      const abortController = new AbortController();
      const timeoutIdentifier = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

      const httpResponse = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: {
          "Authorization": `Bearer ${authTokens.accessToken}`,
          "ChatGPT-Account-Id": authTokens.accountId,
          "User-Agent": "codex-token-usage-monitor/1.0",
        },
        signal: abortController.signal,
      });
      clearTimeout(timeoutIdentifier);

      if (!httpResponse.ok) {
        // 如果遠端端點回傳錯誤，使用快取
        if (this.cachedSnapshot) return this.cachedSnapshot;
        return this.getEmptyFallback(`遠端 API 回應代碼: ${httpResponse.status}`);
      }

      const rawResponsePayload = (await httpResponse.json()) as RawWhamResponse;
      const newSnapshot = this.parseWhamResponse(rawResponsePayload);

      // 自動比對配額重置或重置券事件
      this.detectAndRecordResetEvents(newSnapshot);

      this.cachedSnapshot = newSnapshot;
      this.persistCache(newSnapshot);
      return newSnapshot;
    } catch {
      // 網路連線逾時或失敗時，優先回傳已儲存的快取
      if (this.cachedSnapshot) return this.cachedSnapshot;
      return this.getEmptyFallback("無法連線至 OpenAI 配額伺服器");
    }
  }

  /**
   * 偵測並記錄 OpenAI 不定期配額重置或重置券發送歷史
   */
  private detectAndRecordResetEvents(newSnapshot: QuotaSnapshot): void {
    if (!this.cachedSnapshot || !this.databaseInstance) {
      return;
    }

    // 忽略 fallback 狀態的快照比較
    if (this.cachedSnapshot.source === "fallback" || newSnapshot.source === "fallback") {
      return;
    }

    const currentTimeMs = Date.now();
    const currentIsoString = new Date(currentTimeMs).toISOString();

    const previousCredits = this.cachedSnapshot.resetCredits ?? 0;
    const currentCredits = newSnapshot.resetCredits ?? 0;
    const creditDelta = currentCredits - previousCredits;

    const previousFiveHourUsedPercent = this.cachedSnapshot.fiveHour?.usedPercent ?? 0;
    const newFiveHourUsedPercent = newSnapshot.fiveHour?.usedPercent ?? 0;
    const previousWeeklyUsedPercent = this.cachedSnapshot.weekly?.usedPercent ?? 0;
    const newWeeklyUsedPercent = newSnapshot.weekly?.usedPercent ?? 0;

    // 1. 偵測重置券發送或消耗事件
    if (creditDelta !== 0) {
      const eventType = creditDelta > 0 ? "credit_received" : "credit_consumed";
      const description = creditDelta > 0
        ? `收到 OpenAI 配額重置券（增加 ${creditDelta} 張，現有 ${currentCredits} 張）`
        : `使用 OpenAI 配額重置券（扣除 ${Math.abs(creditDelta)} 張，剩餘 ${currentCredits} 張）`;

      this.databaseInstance.insertResetEvent({
        timestamp: currentTimeMs,
        datetime: currentIsoString,
        eventType,
        previousFiveHourUsedPercent,
        newFiveHourUsedPercent,
        previousWeeklyUsedPercent,
        newWeeklyUsedPercent,
        availableCredits: currentCredits,
        creditDelta,
        description,
      });
    }

    // 2. 偵測五小時週期或不定期歸零重置事件（使用率下降超過 20% 且非重置券扣除所致）
    if (creditDelta === 0 && previousFiveHourUsedPercent >= 20 && newFiveHourUsedPercent < previousFiveHourUsedPercent && (previousFiveHourUsedPercent - newFiveHourUsedPercent) >= 20) {
      this.databaseInstance.insertResetEvent({
        timestamp: currentTimeMs,
        datetime: currentIsoString,
        eventType: "periodic_reset",
        previousFiveHourUsedPercent,
        newFiveHourUsedPercent,
        previousWeeklyUsedPercent,
        newWeeklyUsedPercent,
        availableCredits: currentCredits,
        creditDelta: 0,
        description: `五小時時間視窗配額重置（使用率自 ${previousFiveHourUsedPercent.toFixed(1)}% 降至 ${newFiveHourUsedPercent.toFixed(1)}%）`,
      });
    }

    // 3. 偵測週用量時間視窗重置事件
    if (creditDelta === 0 && previousWeeklyUsedPercent >= 20 && newWeeklyUsedPercent < previousWeeklyUsedPercent && (previousWeeklyUsedPercent - newWeeklyUsedPercent) >= 20) {
      this.databaseInstance.insertResetEvent({
        timestamp: currentTimeMs,
        datetime: currentIsoString,
        eventType: "periodic_reset",
        previousFiveHourUsedPercent,
        newFiveHourUsedPercent,
        previousWeeklyUsedPercent,
        newWeeklyUsedPercent,
        availableCredits: currentCredits,
        creditDelta: 0,
        description: `週用量時間視窗滾動重置（使用率自 ${previousWeeklyUsedPercent.toFixed(1)}% 降至 ${newWeeklyUsedPercent.toFixed(1)}%）`,
      });
    }

    // 4. 偵測用戶方案異動 (升級、降級)
    this.detectAndRecordPlanChanges(newSnapshot);
  }

  /**
   * 偵測用戶方案升級或降級調整並記錄歷史
   */
  private detectAndRecordPlanChanges(newSnapshot: QuotaSnapshot): void {
    if (!this.cachedSnapshot || !this.databaseInstance) {
      return;
    }

    if (this.cachedSnapshot.source === "fallback" || newSnapshot.source === "fallback") {
      return;
    }

    const previousPlan = (this.cachedSnapshot.planType || "").trim().toLowerCase();
    const newPlan = (newSnapshot.planType || "").trim().toLowerCase();

    if (!previousPlan || !newPlan || previousPlan === newPlan) {
      return;
    }

    const planTierHierarchy: Record<string, number> = {
      free: 0,
      standard: 1,
      plus: 2,
      prolite: 3,
      pro: 4,
      team: 5,
      business: 6,
      enterprise: 7,
    };

    const previousTier = planTierHierarchy[previousPlan];
    const newTier = planTierHierarchy[newPlan];
    const hasUnknownPlan = previousTier === undefined || newTier === undefined;

    let changeType: "upgrade" | "downgrade" | "change" = "change";
    let changeDescription = `方案由 ${previousPlan} 變更為 ${newPlan}`;

    if (!hasUnknownPlan && newTier > previousTier) {
      changeType = "upgrade";
      changeDescription = `[方案升級] 成功由 ${previousPlan.toUpperCase()} 升級至 ${newPlan.toUpperCase()}`;
    } else if (!hasUnknownPlan && newTier < previousTier) {
      changeType = "downgrade";
      changeDescription = `[方案降級] 方案由 ${previousPlan.toUpperCase()} 降級為 ${newPlan.toUpperCase()}`;
    }

    const currentTimeMs = Date.now();
    const currentIsoString = new Date(currentTimeMs).toISOString();

    this.databaseInstance.insertPlanChangeEvent({
      timestamp: currentTimeMs,
      datetime: currentIsoString,
      previousPlan,
      newPlan,
      changeType,
      description: changeDescription,
    });
  }

  /**
   * 解析 WHAM API 回傳的資料結構
   */
  public parseWhamResponse(responsePayload: RawWhamResponse): QuotaSnapshot {
    const currentTimeMs = Date.now();
    let fiveHourWindow: QuotaWindow | null = null;
    let weeklyWindow: QuotaWindow | null = null;

    const inspectWindow = (rawWindow?: RawWhamWindow | null): QuotaWindow | null => {
      if (!rawWindow) return null;
      const usedPercent = typeof rawWindow.used_percent === "number" ? Math.max(0, Math.min(100, rawWindow.used_percent)) : 0;
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const limitWindowSeconds = rawWindow.limit_window_seconds || 0;
      const resetAfterSeconds = rawWindow.reset_after_seconds || 0;
      const resetAtMs = rawWindow.reset_at ? (rawWindow.reset_at > 1e11 ? rawWindow.reset_at : rawWindow.reset_at * 1000) : (currentTimeMs + resetAfterSeconds * 1000);

      return {
        usedPercent,
        remainingPercent,
        limitWindowSeconds,
        resetAfterSeconds,
        resetAtMs,
        resetCountdown: QuotaClient.formatCountdown(resetAfterSeconds),
      };
    };

    // 檢查主配額 (rate_limit)
    if (responsePayload.rate_limit) {
      const primaryWindow = inspectWindow(responsePayload.rate_limit.primary_window);
      const secondaryWindow = inspectWindow(responsePayload.rate_limit.secondary_window);

      if (primaryWindow) {
        if (primaryWindow.limitWindowSeconds <= 86400 && primaryWindow.limitWindowSeconds > 0) {
          fiveHourWindow = primaryWindow;
        } else {
          weeklyWindow = primaryWindow;
        }
      }

      if (secondaryWindow) {
        if (secondaryWindow.limitWindowSeconds > 86400) {
          weeklyWindow = secondaryWindow;
        } else if (!fiveHourWindow && secondaryWindow.limitWindowSeconds > 0) {
          fiveHourWindow = secondaryWindow;
        }
      }
    }

    // 檢查附加模型配額 (如 Spark)
    const additionalLimits: AdditionalQuotaLimit[] = [];
    if (Array.isArray(responsePayload.additional_rate_limits)) {
      for (const limitEntry of responsePayload.additional_rate_limits) {
        const primaryWindowLimit = inspectWindow(limitEntry.rate_limit?.primary_window);
        const secondaryWindowLimit = inspectWindow(limitEntry.rate_limit?.secondary_window);

        additionalLimits.push({
          limitName: limitEntry.limit_name || "附加配額",
          meteredFeature: limitEntry.metered_feature || "",
          primaryWindow: primaryWindowLimit,
          secondaryWindow: secondaryWindowLimit,
        });
      }
    }

    const resetCredits = responsePayload.rate_limit_reset_credits?.available_count ?? 0;
    const planType = responsePayload.plan_type || null;

    return {
      updatedAt: currentTimeMs,
      email: responsePayload.email || null,
      planType,
      proTier: computeProTier(planType, fiveHourWindow, weeklyWindow, "wham"),
      fiveHour: fiveHourWindow,
      weekly: weeklyWindow,
      additionalLimits,
      resetCredits,
      source: "wham",
    };
  }

  private persistCache(snapshot: QuotaSnapshot): void {
    try {
      // The snapshot contains account identity and quota details; never create it world-readable.
      writeFileSync(this.cachePath, JSON.stringify(snapshot, null, 2), { encoding: "utf-8", mode: 0o600 });
      chmodSync(this.cachePath, 0o600);
    } catch {
      // 寫入失敗不阻擋主流程
    }
  }

  private loadPersistedCache(): void {
    try {
      if (existsSync(this.cachePath)) {
        chmodSync(this.cachePath, 0o600);
        const rawFileContent = readFileSync(this.cachePath, "utf-8");
        const parsedSnapshot = JSON.parse(rawFileContent) as QuotaSnapshot;
        if (parsedSnapshot && typeof parsedSnapshot.updatedAt === "number") {
          if (typeof parsedSnapshot.proTier !== "boolean") {
            parsedSnapshot.proTier = isProTierSnapshot(parsedSnapshot);
          }
          parsedSnapshot.source = "cache";
          this.cachedSnapshot = parsedSnapshot;
        }
      }
    } catch {
      // 忽略快取讀取錯誤
    }
  }

  private getEmptyFallback(reasonDescription: string): QuotaSnapshot {
    return {
      updatedAt: Date.now(),
      email: null,
      planType: null,
      proTier: false,
      fiveHour: null,
      weekly: null,
      additionalLimits: [],
      resetCredits: 0,
      source: "fallback",
      errorReason: reasonDescription,
    };
  }
}

function computeProTier(
  planType: string | null,
  fiveHour: QuotaWindow | null,
  weekly: QuotaWindow | null,
  source: QuotaSnapshot["source"]
): boolean {
  const normalizedPlanType = (planType || "").trim().toLowerCase();
  if (normalizedPlanType === "pro" || normalizedPlanType === "prolite") {
    return true;
  }
  return source === "wham" && fiveHour == null && weekly != null;
}

/**
 * 判斷快照是否為 Pro 級方案；舊快取若缺少 proTier 則依方案與視窗推斷
 */
export function isProTierSnapshot(snapshot: QuotaSnapshot): boolean {
  if (typeof snapshot.proTier === "boolean") {
    return snapshot.proTier;
  }
  return computeProTier(snapshot.planType, snapshot.fiveHour, snapshot.weekly, snapshot.source);
}
