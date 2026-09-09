/**
 * OpenAI 各模型官方 API 定價計算器 (Token 等值金額換算模組)
 * 單位: 每 1,000,000 Tokens 之美元費率 (USD per 1M tokens)
 */

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
}

// 官方標準與微調模型定價表 (每百萬 Tokens 美元定價)
export const MODEL_PRICING_TABLE: ModelPricingTier[] = [
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

// 預設備援費率 (標準中高階模型水準)
export const DEFAULT_FALLBACK_PRICING: ModelPricingTier = {
  modelPrefix: "default",
  inputCostPerMillion: 2.00,
  cachedInputCostPerMillion: 0.50,
  outputCostPerMillion: 8.00,
  reasoningOutputCostPerMillion: 8.00,
};

/**
 * 依據模型名稱匹配最適定價規則
 */
export function findPricingTierForModel(modelName: string): ModelPricingTier {
  const normalizedName = modelName.toLowerCase();
  for (const tier of MODEL_PRICING_TABLE) {
    if (normalizedName.startsWith(tier.modelPrefix.toLowerCase())) {
      return tier;
    }
  }
  return DEFAULT_FALLBACK_PRICING;
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
  const tier = findPricingTierForModel(modelName);

  // 非快取的直接輸入 Tokens
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
  };
}
