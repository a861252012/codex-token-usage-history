import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

  constructor(codexHomeDir?: string) {
    this.codexHome = codexHomeDir || process.env.CODEX_HOME || join(homedir(), ".codex");
    this.cachePath = join(this.codexHome, "codex_quota_snapshot.json");
    this.loadPersistedCache();
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
    const secs = seconds % 60;
    return `${minutes}分 ${secs}秒`;
  }

  /**
   * 從 ~/.codex/auth.json 讀取認證 Token
   */
  public readAuthTokens(): { accessToken: string; accountId: string } | null {
    try {
      const authPath = join(this.codexHome, "auth.json");
      if (!existsSync(authPath)) return null;
      const raw = readFileSync(authPath, "utf-8");
      const data = JSON.parse(raw);
      const tokens = data.tokens;
      if (!tokens || !tokens.access_token) return null;
      return {
        accessToken: tokens.access_token,
        accountId: tokens.account_id || "",
      };
    } catch {
      return null;
    }
  }

  /**
   * 取得即時配額快照 (支援記憶體快取與即時強制重整)
   */
  public async getQuotaSnapshot(forceRefresh = false): Promise<QuotaSnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.cachedSnapshot && (now - this.cachedSnapshot.updatedAt < CACHE_TTL_MS)) {
      return this.cachedSnapshot;
    }

    const auth = this.readAuthTokens();
    if (!auth) {
      return this.cachedSnapshot || this.getEmptyFallback("無法讀取認證資訊 (未登入 Codex)");
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: {
          "Authorization": `Bearer ${auth.accessToken}`,
          "ChatGPT-Account-Id": auth.accountId,
          "User-Agent": "codex-token-usage-monitor/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        // 如果遠端端點回傳錯誤，使用快取
        if (this.cachedSnapshot) return this.cachedSnapshot;
        return this.getEmptyFallback(`遠端 API 回應代碼: ${resp.status}`);
      }

      const data = (await resp.json()) as RawWhamResponse;
      const snapshot = this.parseWhamResponse(data);
      this.cachedSnapshot = snapshot;
      this.persistCache(snapshot);
      return snapshot;
    } catch {
      // 網路連線逾時或失敗時，優先回傳已儲存的快取
      if (this.cachedSnapshot) return this.cachedSnapshot;
      return this.getEmptyFallback("無法連線至 OpenAI 配額伺服器");
    }
  }

  /**
   * 解析 WHAM API 回傳的資料結構
   */
  public parseWhamResponse(data: RawWhamResponse): QuotaSnapshot {
    const now = Date.now();
    let fiveHourWindow: QuotaWindow | null = null;
    let weeklyWindow: QuotaWindow | null = null;

    const inspectWindow = (win?: RawWhamWindow | null): QuotaWindow | null => {
      if (!win) return null;
      const usedPercent = typeof win.used_percent === "number" ? Math.max(0, Math.min(100, win.used_percent)) : 0;
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const limitWindowSeconds = win.limit_window_seconds || 0;
      const resetAfterSeconds = win.reset_after_seconds || 0;
      const resetAtMs = win.reset_at ? (win.reset_at > 1e11 ? win.reset_at : win.reset_at * 1000) : (now + resetAfterSeconds * 1000);

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
    if (data.rate_limit) {
      const primary = inspectWindow(data.rate_limit.primary_window);
      const secondary = inspectWindow(data.rate_limit.secondary_window);

      if (primary) {
        if (primary.limitWindowSeconds <= 86400 && primary.limitWindowSeconds > 0) {
          fiveHourWindow = primary;
        } else {
          weeklyWindow = primary;
        }
      }

      if (secondary) {
        if (secondary.limitWindowSeconds > 86400) {
          weeklyWindow = secondary;
        } else if (!fiveHourWindow && secondary.limitWindowSeconds > 0) {
          fiveHourWindow = secondary;
        }
      }
    }

    // 檢查附加模型配額 (如 Spark)
    const additionalLimits: AdditionalQuotaLimit[] = [];
    if (Array.isArray(data.additional_rate_limits)) {
      for (const item of data.additional_rate_limits) {
        const prim = inspectWindow(item.rate_limit?.primary_window);
        const sec = inspectWindow(item.rate_limit?.secondary_window);

        additionalLimits.push({
          limitName: item.limit_name || "附加配額",
          meteredFeature: item.metered_feature || "",
          primaryWindow: prim,
          secondaryWindow: sec,
        });

        // 若主配額沒有 5 小時時間視窗，但附加配額有 (常見於 prolite 方案配屬 5小時 burst 視窗)
        if (!fiveHourWindow && prim && prim.limitWindowSeconds <= 86400 && prim.limitWindowSeconds > 0) {
          fiveHourWindow = prim;
        }
      }
    }

    const resetCredits = data.rate_limit_reset_credits?.available_count ?? 0;

    return {
      updatedAt: now,
      email: data.email || null,
      planType: data.plan_type || null,
      fiveHour: fiveHourWindow,
      weekly: weeklyWindow,
      additionalLimits,
      resetCredits,
      source: "wham",
    };
  }

  private persistCache(snapshot: QuotaSnapshot): void {
    try {
      writeFileSync(this.cachePath, JSON.stringify(snapshot, null, 2), "utf-8");
    } catch {
      // 寫入失敗不阻擋主流程
    }
  }

  private loadPersistedCache(): void {
    try {
      if (existsSync(this.cachePath)) {
        const raw = readFileSync(this.cachePath, "utf-8");
        const parsed = JSON.parse(raw) as QuotaSnapshot;
        if (parsed && typeof parsed.updatedAt === "number") {
          parsed.source = "cache";
          this.cachedSnapshot = parsed;
        }
      }
    } catch {
      // 忽略快取讀取錯誤
    }
  }

  private getEmptyFallback(reason: string): QuotaSnapshot {
    return {
      updatedAt: Date.now(),
      email: null,
      planType: reason,
      fiveHour: null,
      weekly: null,
      additionalLimits: [],
      resetCredits: 0,
      source: "fallback",
    };
  }
}
