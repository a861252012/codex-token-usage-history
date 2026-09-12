import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  calculateTokenCost,
  resolvePricingTierForModel,
  findPricingTierForModel,
  clearPricingResolutionCache,
  getActivePricingConfig,
  getEffectiveCatalogOverview,
} from "../src/core/pricing-calculator.js";
import { parseLiteLlmPricingJson, syncPricingFromUpstream, loadCachedUpstreamPricing } from "../src/core/pricing-sync.js";

describe("PricingCalculator", () => {
  let directory: string;
  let originalHome: string | undefined;
  beforeEach(() => {
    originalHome = process.env.CODEX_HOME;
    directory = mkdtempSync(join(tmpdir(), "pricing-calculator-"));
    process.env.CODEX_HOME = directory;
    clearPricingResolutionCache();
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalHome;
    rmSync(directory, { recursive: true, force: true });
  });

  test("正確計算已知模型的輸入、快取與推論 Token 成本", () => {
    // 測試 gpt-6-astra 模型計價
    const result = calculateTokenCost("gpt-6-astra", 1_000_000, 500_000, 500_000, 200_000);
    // 輸入 1M (其中 500k 快取, 500k 非快取)
    // 輸出 500k (其中 200k 推論, 300k 一般輸出)
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.formattedCostUsd).toBeDefined();
    expect(result.tier.modelPrefix).toBe("gpt-6-astra");
    expect(result.pricingSource).not.toBe("unknown");
    expect(result.pricingVersion).not.toBe("unknown");
  });

  test("公開價目只採精確模型，不把未知變體或快照當成已公布定價", () => {
    const miniRes = resolvePricingTierForModel("gpt-4o-mini");
    expect(miniRes.tier.modelPrefix).toBe("gpt-4o-mini");

    const fullRes = resolvePricingTierForModel("gpt-4o");
    expect(fullRes.tier.modelPrefix).toBe("gpt-4o");
    for (const model of ["gpt-4o-2024-05-13", "gpt-5-unknown", "gpt-5.7", "o1-mini", "gpt-5.3-codex-spark", "codex-auto-review"]) {
      expect(resolvePricingTierForModel(model).source).toBe("fallback");
    }
  });

  test("未知模型觸發保底備援 (fallback)", () => {
    const unknownRes = resolvePricingTierForModel("totally-unknown-model-xyz");
    expect(unknownRes.tier.modelPrefix).toBe("default");
    expect(unknownRes.source).toBe("fallback");
    expect(unknownRes.version).not.toBe("unknown");
  });

  test("決策結果寫入記憶體快取以支援極速查詢", () => {
    const first = resolvePricingTierForModel("gpt-5.6-sol");
    const second = resolvePricingTierForModel("gpt-5.6-sol");
    expect(first).toBe(second); // 同一物件參照
  });

  test("CODEX_HOME 切換時不會沿用另一個目錄的使用者定價快取", () => {
    const originalCodexHome = process.env.CODEX_HOME;
    const firstDirectory = join(tmpdir(), `pricing-home-a-${Date.now()}-${Math.random()}`);
    const secondDirectory = join(tmpdir(), `pricing-home-b-${Date.now()}-${Math.random()}`);
    mkdirSync(firstDirectory, { recursive: true });
    mkdirSync(secondDirectory, { recursive: true });

    const pricingConfig = (version: string, inputCostPerMillion: number) => JSON.stringify({
      pricingVersion: version,
      models: [{
        modelPrefix: "path-isolation-model",
        inputCostPerMillion,
        outputCostPerMillion: 0,
      }],
    });
    writeFileSync(join(firstDirectory, "pricing.json"), pricingConfig("first", 1));
    writeFileSync(join(secondDirectory, "pricing.json"), pricingConfig("second", 9));

    try {
      process.env.CODEX_HOME = firstDirectory;
      const first = calculateTokenCost("path-isolation-model", 1_000_000, 0, 0, 0);
      process.env.CODEX_HOME = secondDirectory;
      const second = calculateTokenCost("path-isolation-model", 1_000_000, 0, 0, 0);

      expect(first.totalCost).toBe(1);
      expect(first.pricingVersion).toBe("first");
      expect(second.totalCost).toBe(9);
      expect(second.pricingVersion).toBe("second");
    } finally {
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      clearPricingResolutionCache();
      rmSync(firstDirectory, { recursive: true, force: true });
      rmSync(secondDirectory, { recursive: true, force: true });
    }
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
    expect(catalog.every((model) => model.version.length > 0)).toBe(true);
  });

  test("拒絕非有限、負數或異常巨大的上游定價", () => {
    const models = parseLiteLlmPricingJson({
      valid: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
      negative: { input_cost_per_token: -1, output_cost_per_token: 0.000002 },
      infinite: { input_cost_per_token: Number.POSITIVE_INFINITY, output_cost_per_token: 0.000002 },
      excessive: { input_cost_per_token: 2, output_cost_per_token: 2 },
    });

    expect(models).toHaveLength(1);
    expect(models[0].modelPrefix).toBe("valid");
  });

  test("內建標準 API 費率與已查證的模型定價一致", () => {
    for (const [model, input, cached, output] of [
      ["gpt-6-astra", 10, 1, 50],
      ["gpt-5.6-sol", 4, 0.4, 20],
      ["gpt-5.6-terra", 2, 0.2, 12],
      ["gpt-5.6-luna", 0.2, 0.02, 1.2],
      ["gpt-5", 1.25, 0.125, 10],
    ] as const) {
      const result = calculateTokenCost(model, 100_000, 20_000, 10_000, 5_000);
      expect(result.totalCost).toBeCloseTo(0.08 * input + 0.02 * cached + 0.01 * output, 9);
      expect(result.pricingSource).toBe("builtin");
    }
  });

  test("長上下文以包含快取的完整 input 數判斷，門檻以上套整筆費率", () => {
    expect(calculateTokenCost("gpt-6-astra", 300_000, 0, 10_000, 5_000).totalCost).toBeCloseTo(6.75, 9);
    expect(calculateTokenCost("gpt-6-astra", 272_000, 272_000, 10_000, 5_000).totalCost).toBeCloseTo(0.772, 9);
    expect(calculateTokenCost("gpt-6-astra", 272_001, 272_001, 10_000, 5_000).totalCost).toBeCloseTo(1.294002, 9);
  });

  test("上游泛用模型不能覆蓋另一家族的內建精確項", () => {
    writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({
      updatedAtMs: Date.now(), updatedDate: "synthetic", models: parseLiteLlmPricingJson({
        "gpt-5": { input_cost_per_token: 1.25e-6, cache_read_input_token_cost: 1.25e-7, output_cost_per_token: 1e-5 },
      }),
    }));
    expect(resolvePricingTierForModel("gpt-5").source).toBe("upstream-cache");
    expect(resolvePricingTierForModel("gpt-5-2025-08-07").source).toBe("fallback");
    const luna = resolvePricingTierForModel("gpt-5.6-luna");
    expect(luna.source).toBe("builtin");
    expect(luna.tier.inputCostPerMillion).toBe(0.2);
  });

  test("舊快取遺失長上下文資訊時先用已查證內建價，不等待網路", () => {
    writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({
      updatedAtMs: Date.now(), updatedDate: "legacy", models: [{
        modelPrefix: "gpt-6-astra", inputCostPerMillion: 2.5, cachedInputCostPerMillion: 1.25,
        outputCostPerMillion: 10, reasoningOutputCostPerMillion: 10,
      }],
    }));
    const result = calculateTokenCost("gpt-6-astra", 300_000, 0, 10_000, 0);
    expect(result.pricingSource).toBe("builtin");
    expect(result.pricingVersion).toBe("2026-09-12");
    expect(result.totalCost).toBeCloseTo(6.75, 9);
  });

  test("自訂前綴及舊四費率設定仍可用，長上下文設定會驗證所有價格", () => {
    const longContext = { inputTokenThreshold: 10, inputCostPerMillion: 3, cachedInputCostPerMillion: 2,
      outputCostPerMillion: 5, reasoningOutputCostPerMillion: 7 };
    writeFileSync(join(directory, "pricing.json"), JSON.stringify({ models: [
      { modelPrefix: "custom-", inputCostPerMillion: 1, cachedInputCostPerMillion: 0.5,
        outputCostPerMillion: 2, reasoningOutputCostPerMillion: 2 },
      { modelPrefix: "long", inputCostPerMillion: 1, outputCostPerMillion: 2, longContext },
      ...["inputTokenThreshold", "inputCostPerMillion", "cachedInputCostPerMillion", "outputCostPerMillion", "reasoningOutputCostPerMillion"].map((field) => ({
        modelPrefix: "invalid-" + field, inputCostPerMillion: 1, outputCostPerMillion: 2,
        longContext: { ...longContext, [field]: -1 },
      })),
    ] }));
    expect(getActivePricingConfig().summary.userConfigCount).toBe(2);
    expect(calculateTokenCost("custom-future", 1_000_000, 0, 0, 0).totalCost).toBe(1);
    const long = calculateTokenCost("long", 20, 5, 10, 4);
    expect(long.totalCost).toBeCloseTo((15 * 3 + 5 * 2 + 6 * 5 + 4 * 7) / 1_000_000, 10);
  });

  test("同步保留長上下文價格並更新舊快取格式，重讀仍正確計價", async () => {
    writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ updatedAtMs: Date.now(), models: [] }));
    const previousFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ "gpt-6-astra": {
        input_cost_per_token: 1e-5, cache_read_input_token_cost: 1e-6, output_cost_per_token: 5e-5,
        input_cost_per_token_above_272k_tokens: 2e-5,
        cache_read_input_token_cost_above_272k_tokens: 2e-6,
        output_cost_per_token_above_272k_tokens: 7.5e-5,
      } }));
    }) as typeof fetch;
    try {
      expect((await syncPricingFromUpstream()).updated).toBe(true);
      expect((await syncPricingFromUpstream()).updated).toBe(false);
      expect(calls).toBe(1);
      const persisted = JSON.parse(readFileSync(join(directory, "pricing_cache.json"), "utf8"));
      expect(persisted.models[0].longContext.outputCostPerMillion).toBe(75);
      process.env.CODEX_HOME = join(directory, "empty");
      loadCachedUpstreamPricing();
      process.env.CODEX_HOME = directory;
      const result = calculateTokenCost("gpt-6-astra", 300_000, 100_000, 10_000, 5_000);
      expect(result.pricingSource).toBe("upstream-cache");
      expect(result.totalCost).toBeCloseTo(4.95, 9);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("上游缺少快取折扣不擅自打五折，無效長上下文價不採用", () => {
    const models = parseLiteLlmPricingJson({
      plain: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
      invalid: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6,
        input_cost_per_token_above_272k_tokens: -1, output_cost_per_token_above_272k_tokens: 3e-6 },
    });
    expect(models).toHaveLength(1);
    expect(models[0].cachedInputCostPerMillion).toBe(1);
  });

});
