/**
 * 遠端定價庫自動同步模組 (Upstream Pricing Catalog Sync)
 *
 * 設計原則:
 *   1. 權威開源來源: 整合 LiteLLM 全球開源模型定價資料庫
 *   2. 非阻塞非同步: 背景靜默更新，網路延遲或斷線絕不阻擋本機指令與操作
 *   3. 本機持久快取: 同步結果儲存至 ~/.codex/pricing_cache.json，具備 24 小時 TTL
 */

import { chmodSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelPricingTier } from "./pricing-calculator.js";

export const UPSTREAM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MAXIMUM_PRICING_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAXIMUM_PRICING_MODELS = 20_000;

function isValidTokenPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

async function readBoundedJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_PRICING_RESPONSE_BYTES) {
    throw new Error("遠端定價資料超過允許大小");
  }
  if (!response.body) throw new Error("遠端定價資料為空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAXIMUM_PRICING_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("遠端定價資料超過允許大小");
    }
    chunks.push(value);
  }
  const responseBytes = new Uint8Array(receivedBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    responseBytes.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  const responseText = new TextDecoder().decode(responseBytes);
  const parsedValue: unknown = JSON.parse(responseText);
  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
    throw new Error("遠端定價資料格式無效");
  }
  return parsedValue as Record<string, unknown>;
}

export interface PricingCacheFile {
  updatedAtMs: number;
  updatedDate: string;
  sourceUrl: string;
  modelCount: number;
  models: ModelPricingTier[];
}

export interface SyncPricingResult {
  success: boolean;
  updated: boolean;
  modelCount: number;
  source: string;
  message: string;
}

/**
 * 取得本機快取定價檔案路徑
 */
export function getPricingCacheFilePath(): string {
  const baseDirectory = process.env.CODEX_HOME || join(homedir(), ".codex");
  if (!existsSync(baseDirectory)) {
    mkdirSync(baseDirectory, { recursive: true });
  }
  return join(baseDirectory, "pricing_cache.json");
}

let cachedUpstreamPricingData: PricingCacheFile | null = null;
let cachedUpstreamPricingMtime = 0;
let lastUpstreamCheckTime = 0;

/**
 * 讀取本機已快取的遠端定價庫 (具備記憶體快取與 mtime 增量檢查)
 */
export function loadCachedUpstreamPricing(): PricingCacheFile | null {
  const cachePath = getPricingCacheFilePath();
  const currentTimeMs = Date.now();

  // 2 秒內直接回傳記憶體快取，免除密集重複 statSync 呼叫
  if (cachedUpstreamPricingData && currentTimeMs - lastUpstreamCheckTime < 2000) {
    return cachedUpstreamPricingData;
  }
  lastUpstreamCheckTime = currentTimeMs;

  try {
    if (!existsSync(cachePath)) {
      cachedUpstreamPricingData = null;
      cachedUpstreamPricingMtime = 0;
      return null;
    }

    const fileStat = statSync(cachePath);
    if (cachedUpstreamPricingData && fileStat.mtimeMs === cachedUpstreamPricingMtime) {
      return cachedUpstreamPricingData;
    }

    const rawData = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(rawData);
    if (parsed && Array.isArray(parsed.models) && typeof parsed.updatedAtMs === "number") {
      cachedUpstreamPricingData = parsed as PricingCacheFile;
      cachedUpstreamPricingMtime = fileStat.mtimeMs;
      return cachedUpstreamPricingData;
    }
  } catch {
    // 忽略格式損毀快取
  }
  cachedUpstreamPricingData = null;
  cachedUpstreamPricingMtime = 0;
  return null;
}

/**
 * 解析 LiteLLM 格式並轉譯為標準每百萬 Tokens 美元定價表
 */
export function parseLiteLlmPricingJson(rawJson: Record<string, any>): ModelPricingTier[] {
  const tiers: ModelPricingTier[] = [];

  for (const [modelKey, spec] of Object.entries(rawJson)) {
    if (tiers.length >= MAXIMUM_PRICING_MODELS) break;
    if (!spec || typeof spec !== "object") continue;
    if (modelKey.length === 0 || modelKey.length > 256) continue;

    // 需包含基本 input / output token cost
    const inputCostPerToken = spec.input_cost_per_token;
    const outputCostPerToken = spec.output_cost_per_token;

    if (!isValidTokenPrice(inputCostPerToken) || !isValidTokenPrice(outputCostPerToken)) {
      continue;
    }

    // 換算為每 1,000,000 tokens 美元費率
    const inputCostPerMillion = inputCostPerToken * 1_000_000;
    const outputCostPerMillion = outputCostPerToken * 1_000_000;

    const cachedInputPerToken = spec.cache_read_input_token_cost;
    const cachedInputCostPerMillion = isValidTokenPrice(cachedInputPerToken)
      ? cachedInputPerToken * 1_000_000
      : inputCostPerMillion * 0.5; // 若未提供快取價，按常規半價計算

    const reasoningPerToken = spec.output_cost_per_reasoning_token;
    const reasoningOutputCostPerMillion = isValidTokenPrice(reasoningPerToken)
      ? reasoningPerToken * 1_000_000
      : outputCostPerMillion;

    tiers.push({
      modelPrefix: modelKey.toLowerCase(),
      inputCostPerMillion: Number(inputCostPerMillion.toFixed(4)),
      cachedInputCostPerMillion: Number(cachedInputCostPerMillion.toFixed(4)),
      outputCostPerMillion: Number(outputCostPerMillion.toFixed(4)),
      reasoningOutputCostPerMillion: Number(reasoningOutputCostPerMillion.toFixed(4)),
    });
  }

  return tiers;
}

/**
 * 執行遠端定價同步 (支援強制更新或 24 小時快取保護)
 */
export async function syncPricingFromUpstream(force = false): Promise<SyncPricingResult> {
  const cache = loadCachedUpstreamPricing();
  const cacheTtlMs = 24 * 3600 * 1000; // 24 小時快取過期時間

  if (!force && cache && Date.now() - cache.updatedAtMs < cacheTtlMs) {
    return {
      success: true,
      updated: false,
      modelCount: cache.modelCount,
      source: "local-cache",
      message: `快取仍在 24 小時有效期內 (上次更新: ${cache.updatedDate})，略過下載`,
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 6000); // 6 秒逾時保護
  try {

    const response = await fetch(UPSTREAM_PRICING_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "codex-token-usage-history/1.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = await readBoundedJsonResponse(response);
    const parsedModels = parseLiteLlmPricingJson(payload);

    if (parsedModels.length === 0) {
      throw new Error("解析遠端定價庫後未取得任何有效模型費率");
    }

    const todayDateString = new Date().toISOString().slice(0, 10);
    const cacheData: PricingCacheFile = {
      updatedAtMs: Date.now(),
      updatedDate: todayDateString,
      sourceUrl: UPSTREAM_PRICING_URL,
      modelCount: parsedModels.length,
      models: parsedModels,
    };

    const cachePath = getPricingCacheFilePath();
    writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), { encoding: "utf-8", mode: 0o600 });
    chmodSync(cachePath, 0o600);

    cachedUpstreamPricingData = cacheData;
    try {
      cachedUpstreamPricingMtime = statSync(cachePath).mtimeMs;
    } catch {
      cachedUpstreamPricingMtime = Date.now();
    }
    lastUpstreamCheckTime = Date.now();

    try {
      const { clearPricingResolutionCache } = await import("./pricing-calculator.js");
      clearPricingResolutionCache();
    } catch {
      // 動態匯入失敗時略過，避免與 pricing-calculator 循環依賴中斷同步
    }

    return {
      success: true,
      updated: true,
      modelCount: parsedModels.length,
      source: "upstream-litellm",
      message: `已成功同步遠端開源定價庫 (共收錄 ${parsedModels.length} 個模型)`,
    };
  } catch (syncError: any) {
    return {
      success: false,
      updated: false,
      modelCount: cache?.modelCount ?? 0,
      source: "error-fallback",
      message: `遠端同步失敗 (${syncError.message})，維持現有定價`,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * 背景非阻塞式靜默同步觸發器 (Fire-and-Forget)
 */
export function triggerBackgroundPricingSync(): void {
  syncPricingFromUpstream(false).catch(() => {
    // 靜默忽略背景同步異常，絕不干擾前景執行緒
  });
}
