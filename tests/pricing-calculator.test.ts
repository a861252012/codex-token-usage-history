import { describe, test, expect, beforeEach } from "bun:test";
import {
  calculateTokenCost,
  resolvePricingTierForModel,
  findPricingTierForModel,
  clearPricingResolutionCache,
  getActivePricingConfig,
  getEffectiveCatalogOverview,
} from "../src/core/pricing-calculator.js";

describe("PricingCalculator", () => {
  beforeEach(() => {
    clearPricingResolutionCache();
  });

  test("正確計算已知模型的輸入、快取與推論 Token 成本", () => {
    // 測試 gpt-6-astra 模型計價
    const result = calculateTokenCost("gpt-6-astra", 1_000_000, 500_000, 500_000, 200_000);
    // 輸入 1M (其中 500k 快取, 500k 非快取)
    // 輸出 500k (其中 200k 推論, 300k 一般輸出)
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.formattedCostUsd).toBeDefined();
    expect(result.tier.modelPrefix).toBe("gpt-6-astra");
  });

  test("最長前綴比對優先於短前綴", () => {
    const miniRes = resolvePricingTierForModel("gpt-4o-mini-experimental-preview");
    expect(miniRes.tier.modelPrefix).toBe("gpt-4o-mini");

    const fullRes = resolvePricingTierForModel("gpt-4o-custom-variant");
    expect(fullRes.tier.modelPrefix).toBe("gpt-4o");
  });

  test("未知模型觸發保底備援 (fallback)", () => {
    const unknownRes = resolvePricingTierForModel("totally-unknown-model-xyz");
    expect(unknownRes.tier.modelPrefix).toBe("default");
    expect(unknownRes.source).toBe("fallback");
  });

  test("決策結果寫入記憶體快取以支援極速查詢", () => {
    const first = resolvePricingTierForModel("gpt-5.6-sol");
    const second = resolvePricingTierForModel("gpt-5.6-sol");
    expect(first).toBe(second); // 同一物件參照
  });

  test("支援向下相容之 findPricingTierForModel", () => {
    const tier = findPricingTierForModel("o3-mini");
    expect(tier.modelPrefix).toBe("o3-mini");
  });

  test("有效產出全域定價環境概要與核心模型清單", () => {
    const config = getActivePricingConfig();
    expect(config.pricingVersion).toBeDefined();
    expect(config.summary.builtinCount).toBeGreaterThan(0);

    const catalog = getEffectiveCatalogOverview();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.some((m) => m.modelPrefix === "gpt-6-astra")).toBe(true);
  });
});
