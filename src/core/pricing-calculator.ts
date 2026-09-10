/**
 * OpenAI 各模型官方 API 定價計算器 (Token 等值金額換算模組)
 *
 * 階層化定價決策鏈 (Hierarchical Pricing Fallback Chain):
 *   1. 最高優先: 使用者自訂覆蓋 ~/.codex/pricing.json ("user-config")
 *   2. 第二優先: 本機快取之開源社群定價庫 ~/.codex/pricing_cache.json ("upstream-cache")
 *   3. 保底防線: 程式內嵌官方基準與 Codex 預覽模型定價 ("builtin")
 *   4. 通用降級: 未知模型預設定價 ("fallback")
 *
 * 單位: 每 1,000,000 Tokens 之美元費率 (USD per 1M tokens)
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadCachedUpstreamPricing } from "./pricing-sync.js";
import type { PricingSource } from "./types.js";

export interface ModelPricingTier {
  modelPrefix: string;
  inputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  outputCostPerMillion: number;
  reasoningOutputCostPerMillion: number;
}

export interface CalculatedCostResult {
  inputCost: number;
  cachedInputCost: number;
  outputCost: number;
  reasoningOutputCost: number;
  totalCost: number;
  formattedCostUsd: string;
  tier: ModelPricingTier;
  pricingSource: PricingSource;
  pricingVersion: string;
}

export interface PricingResolution {
  tier: ModelPricingTier;
  source: PricingSource;
  version: string;
}

export interface PricingConfigSummary {
  pricingVersion: string;
  primarySource: "user-config" | "upstream-cache" | "builtin";
  totalModelsAvailable: number;
  userConfigCount: number;
  upstreamCacheCount: number;
  builtinCount: number;
}

// 程式內嵌基準定價 (包含 Codex 特有或尚未登錄公開資料庫之模型)
const BUILTIN_MODEL_PRICING: ModelPricingTier[] = [
  {
    modelPrefix: "gpt-6-astra",
    inputCostPerMillion: 2.50,
    cachedInputCostPerMillion: 1.25,
    outputCostPerMillion: 10.00,
    reasoningOutputCostPerMillion: 10.00,
  },
  {
    modelPrefix: "gpt-5.3-codex-spark",
    inputCostPerMillion: 1.25,
    cachedInputCostPerMillion: 0.30,
    outputCostPerMillion: 5.00,
    reasoningOutputCostPerMillion: 5.00,
  },
  {
    modelPrefix: "gpt-5.6-sol",
    inputCostPerMillion: 2.00,
    cachedInputCostPerMillion: 0.50,
    outputCostPerMillion: 8.00,
    reasoningOutputCostPerMillion: 8.00,
  },
  {
    modelPrefix: "gpt-5.6-terra",
    inputCostPerMillion: 2.00,
    cachedInputCostPerMillion: 0.50,
    outputCostPerMillion: 8.00,
    reasoningOutputCostPerMillion: 8.00,
  },
  {
    modelPrefix: "gpt-5.6-luna",
    inputCostPerMillion: 2.00,
    cachedInputCostPerMillion: 0.50,
    outputCostPerMillion: 8.00,
    reasoningOutputCostPerMillion: 8.00,
  },
  {
    modelPrefix: "gpt-5",
    inputCostPerMillion: 2.00,
    cachedInputCostPerMillion: 0.50,
    outputCostPerMillion: 8.00,
    reasoningOutputCostPerMillion: 8.00,
  },
  {
    modelPrefix: "o3-mini",
    inputCostPerMillion: 1.10,
    cachedInputCostPerMillion: 0.55,
    outputCostPerMillion: 4.40,
    reasoningOutputCostPerMillion: 4.40,
  },
  {
    modelPrefix: "o1",
    inputCostPerMillion: 15.00,
    cachedInputCostPerMillion: 7.50,
    outputCostPerMillion: 60.00,
    reasoningOutputCostPerMillion: 60.00,
  },
  {
    modelPrefix: "gpt-4o-mini",
    inputCostPerMillion: 0.15,
    cachedInputCostPerMillion: 0.075,
    outputCostPerMillion: 0.60,
    reasoningOutputCostPerMillion: 0.60,
  },
  {
    modelPrefix: "gpt-4o",
    inputCostPerMillion: 2.50,
    cachedInputCostPerMillion: 1.25,
    outputCostPerMillion: 10.00,
    reasoningOutputCostPerMillion: 10.00,
  },
  {
    modelPrefix: "codex-auto-review",
    inputCostPerMillion: 1.50,
    cachedInputCostPerMillion: 0.50,
    outputCostPerMillion: 6.00,
    reasoningOutputCostPerMillion: 6.00,
  },
];

export const DEFAULT_FALLBACK_PRICING: ModelPricingTier = {
  modelPrefix: "default",
  inputCostPerMillion: 2.00,
  cachedInputCostPerMillion: 0.50,
  outputCostPerMillion: 8.00,
  reasoningOutputCostPerMillion: 8.00,
};

const BUILTIN_VERSION = "2026-09-09";
const MAXIMUM_USER_PRICING_FILE_BYTES = 1024 * 1024;
const MAXIMUM_USER_PRICING_MODELS = 1_000;
const MAXIMUM_MODEL_PREFIX_LENGTH = 128;
const MAXIMUM_PRICE_PER_MILLION = 1_000_000;

function validatePricingTier(value: unknown): ModelPricingTier | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ModelPricingTier>;
  if (
    typeof candidate.modelPrefix !== "string" ||
    candidate.modelPrefix.length === 0 ||
    candidate.modelPrefix.length > MAXIMUM_MODEL_PREFIX_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(candidate.modelPrefix)
  ) return null;

  const isValidPrice = (price: unknown): price is number =>
    typeof price === "number" && Number.isFinite(price) && price >= 0 && price <= MAXIMUM_PRICE_PER_MILLION;
  if (!isValidPrice(candidate.inputCostPerMillion) || !isValidPrice(candidate.outputCostPerMillion)) return null;

  const cachedPrice = candidate.cachedInputCostPerMillion ?? candidate.inputCostPerMillion * 0.5;
  const reasoningPrice = candidate.reasoningOutputCostPerMillion ?? candidate.outputCostPerMillion;
  if (!isValidPrice(cachedPrice) || !isValidPrice(reasoningPrice)) return null;

  return {
    modelPrefix: candidate.modelPrefix.toLowerCase(),
    inputCostPerMillion: candidate.inputCostPerMillion,
    cachedInputCostPerMillion: cachedPrice,
    outputCostPerMillion: candidate.outputCostPerMillion,
    reasoningOutputCostPerMillion: reasoningPrice,
  };
}

/**
 * 取得使用者自訂定價設定檔路徑 (~/.codex/pricing.json)
 */
export function getUserPricingFilePath(): string {
  const baseDirectory = process.env.CODEX_HOME || join(homedir(), ".codex");
  return join(baseDirectory, "pricing.json");
}

let cachedUserConfigData: { version: string; models: ModelPricingTier[]; fallback?: ModelPricingTier } | null = null;
let cachedUserConfigMtime = 0;
let lastUserConfigCheckTime = 0;
let cachedUserConfigPath = "";

/**
 * 讀取使用者自訂定價表 (~/.codex/pricing.json)，具備記憶體快取與 mtime 檢查
 */
export function loadUserPricingConfig(): { version: string; models: ModelPricingTier[]; fallback?: ModelPricingTier } | null {
  const filePath = getUserPricingFilePath();
  const currentTimeMs = Date.now();

  if (filePath !== cachedUserConfigPath) {
    cachedUserConfigPath = filePath;
    cachedUserConfigData = null;
    cachedUserConfigMtime = 0;
    lastUserConfigCheckTime = 0;
    clearPricingResolutionCache();
  }

  // 2 秒內直接回傳記憶體快取，避免密集重複 statSync
  if (cachedUserConfigData !== null && currentTimeMs - lastUserConfigCheckTime < 2000) {
    return cachedUserConfigData;
  }
  lastUserConfigCheckTime = currentTimeMs;

  try {
    if (!existsSync(filePath)) {
      cachedUserConfigData = null;
      cachedUserConfigMtime = 0;
      return null;
    }

    const fileStat = statSync(filePath);
    if (!fileStat.isFile() || fileStat.size > MAXIMUM_USER_PRICING_FILE_BYTES) {
      cachedUserConfigData = null;
      cachedUserConfigMtime = fileStat.mtimeMs;
      return null;
    }
    if (cachedUserConfigData && fileStat.mtimeMs === cachedUserConfigMtime) {
      return cachedUserConfigData;
    }

    const rawContent = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(rawContent);

    if (!Array.isArray(parsed.models) || parsed.models.length === 0) {
      cachedUserConfigData = null;
      cachedUserConfigMtime = fileStat.mtimeMs;
      return null;
    }

    const validatedModels: ModelPricingTier[] = [];
    for (const item of parsed.models.slice(0, MAXIMUM_USER_PRICING_MODELS)) {
      const validatedTier = validatePricingTier(item);
      if (validatedTier) validatedModels.push(validatedTier);
    }

    if (validatedModels.length === 0) {
      cachedUserConfigData = null;
      cachedUserConfigMtime = fileStat.mtimeMs;
      return null;
    }

    const validatedFallback = validatePricingTier(parsed.fallback);
    cachedUserConfigData = {
      version: typeof parsed.pricingVersion === "string"
        ? parsed.pricingVersion.slice(0, 128)
        : "user-custom",
      models: validatedModels,
      fallback: validatedFallback || undefined,
    };
    cachedUserConfigMtime = fileStat.mtimeMs;
    clearPricingResolutionCache();
    return cachedUserConfigData;
  } catch {
    cachedUserConfigData = null;
    cachedUserConfigMtime = 0;
    return null;
  }
}

/**
 * 輔助函數: 從指定清單中尋找最適模型階層 (精確比對優先，次採最長前綴比對)
 */
function findBestTierInList(modelName: string, tierList: ModelPricingTier[]): ModelPricingTier | null {
  const normalizedName = modelName.toLowerCase();

  // 1. 完全一致匹配 (Exact Match)
  for (const singleTier of tierList) {
    if (singleTier.modelPrefix.toLowerCase() === normalizedName) {
      return singleTier;
    }
  }

  // 2. 最長前綴匹配 (Longest Prefix Match)
  let bestCandidate: ModelPricingTier | null = null;
  let maxPrefixLength = 0;

  for (const singleTier of tierList) {
    const candidatePrefix = singleTier.modelPrefix.toLowerCase();
    if (normalizedName.startsWith(candidatePrefix) && candidatePrefix.length > maxPrefixLength) {
      bestCandidate = singleTier;
      maxPrefixLength = candidatePrefix.length;
    }
  }

  return bestCandidate;
}

const modelResolutionCache = new Map<string, PricingResolution>();
let resolvedUserConfig: ReturnType<typeof loadUserPricingConfig> = null;
let resolvedUpstreamCache: ReturnType<typeof loadCachedUpstreamPricing> = null;

/**
 * 清理模型定價決策記憶體快取 (當設定檔或遠端快取更新時呼叫)
 */
export function clearPricingResolutionCache(): void {
  modelResolutionCache.clear();
}

/**
 * 依據模型名稱匹配最適定價階層 (嚴格落實四層優先級降級鏈，具備 O(1) 決策快取)
 */
export function resolvePricingTierForModel(modelName: string): PricingResolution {
  const normalizedModelName = (modelName || "default").toLowerCase();

  const userConfig = loadUserPricingConfig();
  const upstreamCache = loadCachedUpstreamPricing();
  if (userConfig !== resolvedUserConfig || upstreamCache !== resolvedUpstreamCache) {
    clearPricingResolutionCache();
    resolvedUserConfig = userConfig;
    resolvedUpstreamCache = upstreamCache;
  }

  const cachedResolution = modelResolutionCache.get(normalizedModelName);
  if (cachedResolution) {
    return cachedResolution;
  }

  // 1. 最高優先: 檢查使用者自訂設定檔 (~/.codex/pricing.json)
  if (userConfig) {
    const matchedUserTier = findBestTierInList(normalizedModelName, userConfig.models);
    if (matchedUserTier) {
      const resolution: PricingResolution = {
        tier: matchedUserTier,
        source: "user-config",
        version: userConfig.version,
      };
      modelResolutionCache.set(normalizedModelName, resolution);
      return resolution;
    }
  }

  // 2. 第二優先: 檢查本機快取的開源社群定價庫 (~/.codex/pricing_cache.json)
  if (upstreamCache) {
    const matchedUpstreamTier = findBestTierInList(normalizedModelName, upstreamCache.models);
    if (matchedUpstreamTier) {
      const resolution: PricingResolution = {
        tier: matchedUpstreamTier,
        source: "upstream-cache",
        version: upstreamCache.updatedDate || "unknown",
      };
      modelResolutionCache.set(normalizedModelName, resolution);
      return resolution;
    }
  }

  // 3. 第三優先: 檢查內建預設定價 (官方標竿與 Codex 專屬模型)
  const matchedBuiltinTier = findBestTierInList(normalizedModelName, BUILTIN_MODEL_PRICING);
  if (matchedBuiltinTier) {
    const resolution: PricingResolution = {
      tier: matchedBuiltinTier,
      source: "builtin",
      version: BUILTIN_VERSION,
    };
    modelResolutionCache.set(normalizedModelName, resolution);
    return resolution;
  }

  // 4. 通用降級
  const fallbackTier = userConfig?.fallback || DEFAULT_FALLBACK_PRICING;
  const resolution: PricingResolution = {
    tier: fallbackTier,
    source: "fallback",
    version: userConfig?.fallback ? userConfig.version : BUILTIN_VERSION,
  };
  modelResolutionCache.set(normalizedModelName, resolution);
  return resolution;
}

/**
 * 簡化版搜尋函數 (向下相容)
 */
export function findPricingTierForModel(modelName: string): ModelPricingTier {
  return resolvePricingTierForModel(modelName).tier;
}

/**
 * 計算指定 Token 數量之等值美元費用
 */
export function calculateTokenCost(
  modelName: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  reasoningOutputTokens: number
): CalculatedCostResult {
  const { tier, source, version } = resolvePricingTierForModel(modelName);

  const directInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const inputCost = (directInputTokens / 1_000_000) * tier.inputCostPerMillion;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * tier.cachedInputCostPerMillion;
  const standardOutputTokens = Math.max(0, outputTokens - reasoningOutputTokens);
  const outputCost = (standardOutputTokens / 1_000_000) * tier.outputCostPerMillion;
  const reasoningOutputCost = (reasoningOutputTokens / 1_000_000) * tier.reasoningOutputCostPerMillion;

  const totalCost = inputCost + cachedInputCost + outputCost + reasoningOutputCost;

  let formattedCostUsd = "";
  if (totalCost < 0.01 && totalCost > 0) {
    formattedCostUsd = `$${totalCost.toFixed(4)}`;
  } else {
    formattedCostUsd = `$${totalCost.toFixed(2)}`;
  }

  return {
    inputCost,
    cachedInputCost,
    outputCost,
    reasoningOutputCost,
    totalCost,
    formattedCostUsd,
    tier,
    pricingSource: source,
    pricingVersion: version,
  };
}

/**
 * 取得當前全域定價環境概要資訊
 */
export function getActivePricingConfig(): {
  pricingVersion: string;
  pricingSource: "user-config" | "upstream-cache" | "builtin";
  summary: PricingConfigSummary;
} {
  const userConfig = loadUserPricingConfig();
  const upstreamCache = loadCachedUpstreamPricing();

  let pricingVersion = BUILTIN_VERSION;
  let primarySource: "user-config" | "upstream-cache" | "builtin" = "builtin";

  if (userConfig) {
    primarySource = "user-config";
    pricingVersion = userConfig.version;
  } else if (upstreamCache) {
    primarySource = "upstream-cache";
    pricingVersion = upstreamCache.updatedDate || "unknown";
  }

  const userConfigCount = userConfig?.models.length ?? 0;
  const upstreamCacheCount = upstreamCache?.models.length ?? 0;
  const builtinCount = BUILTIN_MODEL_PRICING.length;

  return {
    pricingVersion,
    pricingSource: primarySource,
    summary: {
      pricingVersion,
      primarySource,
      totalModelsAvailable: userConfigCount + upstreamCacheCount + builtinCount,
      userConfigCount,
      upstreamCacheCount,
      builtinCount,
    },
  };
}

/**
 * 彙總當前所有生效的代表性模型費率表 (供 CLI 與 API 檢視)
 */
export function getEffectiveCatalogOverview(): Array<{
  modelPrefix: string;
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
  reasoningOutputPer1M: number;
  source: PricingSource;
  version: string;
}> {
  // 挑選常用的主流核心模型與 Codex 模型
  const sampleModels = [
    "gpt-6-astra",
    "gpt-5.3-codex-spark",
    "gpt-5.6-sol",
    "gpt-5",
    "o3-mini",
    "o1",
    "gpt-4o",
    "gpt-4o-mini",
    "codex-auto-review",
  ];

  return sampleModels.map((modelName) => {
    const { tier, source, version } = resolvePricingTierForModel(modelName);
    return {
      modelPrefix: tier.modelPrefix,
      inputPer1M: tier.inputCostPerMillion,
      cachedInputPer1M: tier.cachedInputCostPerMillion,
      outputPer1M: tier.outputCostPerMillion,
      reasoningOutputPer1M: tier.reasoningOutputCostPerMillion,
      source,
      version,
    };
  });
}

// 向下相容匯出
export const MODEL_PRICING_TABLE = BUILTIN_MODEL_PRICING;
