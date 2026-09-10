import { chmodSync, existsSync, readFileSync } from "node:fs";
import { writePrivateFileAtomic } from "./atomic-file.js";
import { join } from "node:path";
import { homedir } from "node:os";
import type { QuotaSnapshot, QuotaWindow, AdditionalQuotaLimit } from "./types.js";

const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 30_000; // 快取 30 秒，避免頻繁請求打滿 API
const MAXIMUM_QUOTA_RESPONSE_BYTES = 1024 * 1024;
const MAXIMUM_ADDITIONAL_LIMITS = 100;
const MAXIMUM_ACCOUNT_TEXT_LENGTH = 320;

function boundedText(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, MAXIMUM_ACCOUNT_TEXT_LENGTH) : null;
}

function finiteNumber(value: unknown, minimum: number, maximum: number, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

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

async function readBoundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) throw new Error("Empty response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      throw new Error("Response exceeds size limit");
    }
    chunks.push(value);
  }
  const responseBytes = new Uint8Array(receivedBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    responseBytes.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return new TextDecoder().decode(responseBytes);
}

export class QuotaClient {
  private codexHome: string;
  private cachedSnapshot: QuotaSnapshot | null = null;
  private cachePath: string;

  private databaseInstance: import("./history-db.js").HistoryDatabase | null = null;

  constructor(codexHomeDirectory?: string, databaseInstance?: import("./history-db.js").HistoryDatabase, options: { readOnly?: boolean } = {}) {
    this.codexHome = codexHomeDirectory || process.env.CODEX_HOME || join(homedir(), ".codex");
    this.cachePath = join(this.codexHome, "codex_quota_snapshot.json");
    this.databaseInstance = databaseInstance || null;
    this.loadPersistedCache(options.readOnly === true);
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

  private createStaleSnapshot(baseSnapshot: QuotaSnapshot, failureReason: string): QuotaSnapshot {
    return (this.cachedSnapshot = {
      ...baseSnapshot,
      source: "cache",
      errorReason: failureReason,
    });
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
      if (
        !tokenCollection ||
        typeof tokenCollection.access_token !== "string" ||
        tokenCollection.access_token.length === 0 ||
        tokenCollection.access_token.length > 16_384
      ) return null;
      return {
        accessToken: tokenCollection.access_token,
        accountId: typeof tokenCollection.account_id === "string"
          ? tokenCollection.account_id.slice(0, 1024)
          : "",
      };
    } catch {
      return null;
    }
  }

  /** 只讀取已載入的本機快照，不觸發認證或網路存取。 */
  public getCachedQuotaSnapshot(): QuotaSnapshot {
    return this.cachedSnapshot ?? this.getEmptyFallback("尚無本機配額快取");
  }

  /** 取得即時配額快照 (支援記憶體快取與即時強制重整)。 */
  public async getQuotaSnapshot(forceRefresh = false): Promise<QuotaSnapshot> {
    const currentTimeMs = Date.now();
    if (!forceRefresh && this.cachedSnapshot && (currentTimeMs - this.cachedSnapshot.updatedAt < CACHE_TTL_MS)) {
      return this.cachedSnapshot;
    }

    const authTokens = this.readAuthTokens();
    if (!authTokens) {
      if (this.cachedSnapshot) {
        return this.createStaleSnapshot(this.cachedSnapshot, "尚未於 ~/.codex/auth.json 找到有效登入憑證");
      }
      return this.getEmptyFallback("尚未於 ~/.codex/auth.json 找到有效登入憑證");
    }

    const abortController = new AbortController();
    const timeoutIdentifier = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);
    timeoutIdentifier.unref?.();

    try {
      const httpResponse = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: {
          "Authorization": `Bearer ${authTokens.accessToken}`,
          "ChatGPT-Account-Id": authTokens.accountId,
          "User-Agent": "codex-token-usage-monitor/1.0",
        },
        signal: abortController.signal,
      });

      if (!httpResponse.ok) {
        const failureReason = `遠端 API 回應代碼: ${httpResponse.status}`;
        if (this.cachedSnapshot) {
          return this.createStaleSnapshot(this.cachedSnapshot, failureReason);
        }
        return this.getEmptyFallback(failureReason);
      }

      const declaredLength = Number(httpResponse.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_QUOTA_RESPONSE_BYTES) {
        throw new Error("Quota response exceeds size limit");
      }
      const responseText = await readBoundedResponseText(httpResponse, MAXIMUM_QUOTA_RESPONSE_BYTES);
      const rawResponsePayload = JSON.parse(responseText) as RawWhamResponse;
      const newSnapshot = this.parseWhamResponse(rawResponsePayload);
      if (newSnapshot.errorReason) {
        return this.cachedSnapshot
          ? this.createStaleSnapshot(this.cachedSnapshot, newSnapshot.errorReason)
          : { ...newSnapshot, source: "fallback" };
      }

      // 自動比對配額重置或重置券事件
      this.detectAndRecordResetEvents(newSnapshot);

      this.cachedSnapshot = newSnapshot;
      this.persistCache(newSnapshot);
      return newSnapshot;
    } catch (caughtError: any) {
      // 網路連線逾時或失敗時，優先回傳已儲存的快取
      const failureReason = caughtError?.message || "無法連線至 OpenAI 配額伺服器";
      if (this.cachedSnapshot) {
        return this.createStaleSnapshot(this.cachedSnapshot, failureReason);
      }
      return this.getEmptyFallback("無法連線至 OpenAI 配額伺服器");
    } finally {
      clearTimeout(timeoutIdentifier);
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
    const creditDelta = this.cachedSnapshot.resetCreditsKnown === true && newSnapshot.resetCreditsKnown === true
      ? currentCredits - previousCredits : null;

    const previousFiveHourUsedPercent = this.cachedSnapshot.fiveHour?.usedPercent ?? null;
    const newFiveHourUsedPercent = newSnapshot.fiveHour?.usedPercent ?? null;
    const previousWeeklyUsedPercent = this.cachedSnapshot.weekly?.usedPercent ?? null;
    const newWeeklyUsedPercent = newSnapshot.weekly?.usedPercent ?? null;

    // 1. 偵測重置券發送或消耗事件
    if (creditDelta !== null && creditDelta !== 0) {
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

    // With unknown credit counts, a usage drop alone cannot identify the reset cause.
    const unchangedPlan = this.cachedSnapshot.planType === newSnapshot.planType;
    for (const [label, previousWindow, newWindow] of [
      ["五小時", this.cachedSnapshot.fiveHour, newSnapshot.fiveHour],
      ["週用量", this.cachedSnapshot.weekly, newSnapshot.weekly],
    ] as const) {
      if (!unchangedPlan || !previousWindow || !newWindow || previousWindow.limitWindowSeconds !== newWindow.limitWindowSeconds) continue;
      const elapsedWindow = previousWindow.resetAtMs > 0
        && previousWindow.resetAtMs <= newSnapshot.updatedAt
        && newWindow.resetAtMs > previousWindow.resetAtMs;
      const resetWithoutCreditConsumption = elapsedWindow && (creditDelta === null || creditDelta >= 0);
      if (!resetWithoutCreditConsumption || previousWindow.usedPercent - newWindow.usedPercent < 20) continue;
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
        description: `${label}配額週期已到期（依重設時間判定；使用率自 ${previousWindow.usedPercent.toFixed(1)}% 降至 ${newWindow.usedPercent.toFixed(1)}%${creditDelta === null ? "；券數未知，依視窗重設時間判定" : ""}）`,
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
    let invalidWindow = false;

    const inspectWindow = (rawWindow?: RawWhamWindow | null): QuotaWindow | null => {
      if (!rawWindow) return null;
      const usedPercent = finiteNumber(rawWindow.used_percent, 0, 100, NaN);
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const limitWindowSeconds = finiteNumber(rawWindow.limit_window_seconds, 0, 366 * 86400);
      if (!Number.isFinite(usedPercent) || !Number.isSafeInteger(limitWindowSeconds) || limitWindowSeconds <= 0) {
        invalidWindow = true;
        return null;
      }
      const resetAfterSeconds = finiteNumber(rawWindow.reset_after_seconds, 0, 366 * 86400);
      const hasResetDelay = typeof rawWindow.reset_after_seconds === "number" && Number.isFinite(rawWindow.reset_after_seconds) && rawWindow.reset_after_seconds >= 0 && rawWindow.reset_after_seconds <= 366 * 86400;
      const rawResetAt = finiteNumber(rawWindow.reset_at, 0, 10_000_000_000_000);
      const resetAtMs = rawResetAt > 0
        ? (rawResetAt > 1e11 ? rawResetAt : rawResetAt * 1000)
        : hasResetDelay ? currentTimeMs + resetAfterSeconds * 1000 : 0;

      return {
        usedPercent,
        remainingPercent,
        limitWindowSeconds,
        resetAfterSeconds,
        resetAtMs,
        resetCountdown: resetAtMs > 0 ? QuotaClient.formatCountdown(Math.max(0, Math.floor((resetAtMs - currentTimeMs) / 1000))) : "—",
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
      for (const limitEntry of responsePayload.additional_rate_limits.slice(0, MAXIMUM_ADDITIONAL_LIMITS)) {
        if (!limitEntry || typeof limitEntry !== "object") continue;
        const primaryWindowLimit = inspectWindow(limitEntry.rate_limit?.primary_window);
        const secondaryWindowLimit = inspectWindow(limitEntry.rate_limit?.secondary_window);

        additionalLimits.push({
          limitName: boundedText(limitEntry.limit_name) || "附加配額",
          meteredFeature: boundedText(limitEntry.metered_feature) || "",
          primaryWindow: primaryWindowLimit,
          secondaryWindow: secondaryWindowLimit,
        });
      }
    }

    const resetCredits = finiteNumber(responsePayload.rate_limit_reset_credits?.available_count, 0, 1_000_000);
    const rawCredits = responsePayload.rate_limit_reset_credits?.available_count;
    const resetCreditsKnown = typeof rawCredits === "number" && Number.isSafeInteger(rawCredits) && rawCredits >= 0 && rawCredits <= 1_000_000;
    const planType = boundedText(responsePayload.plan_type);

    return {
      updatedAt: currentTimeMs,
      email: boundedText(responsePayload.email),
      planType,
      proTier: computeProTier(planType, fiveHourWindow, weeklyWindow, "wham"),
      fiveHour: fiveHourWindow,
      weekly: weeklyWindow,
      additionalLimits,
      resetCredits,
      resetCreditsKnown,
      source: "wham",
      ...((invalidWindow || (!fiveHourWindow && !weeklyWindow))
        ? { errorReason: invalidWindow ? "上游回傳無效配額視窗，無法確認目前剩餘額度" : "上游未回傳有效主配額視窗" }
        : {}),
    };
  }

  private persistCache(snapshot: QuotaSnapshot): void {
    try {
      // The snapshot contains account identity and quota details; never create it world-readable.
      writePrivateFileAtomic(this.cachePath, JSON.stringify(snapshot, null, 2));
    } catch {
      // 寫入失敗不阻擋主流程
    }
  }

  private loadPersistedCache(readOnly = false): void {
    try {
      if (existsSync(this.cachePath)) {
        if (!readOnly) chmodSync(this.cachePath, 0o600);
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
