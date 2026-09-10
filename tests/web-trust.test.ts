import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

function createWebContext() {
  const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8")
    .split("// Initialization")[0];
  const elements = new Map<string, any>();
  const context = vm.createContext({
    localStorage: { getItem: () => "en", setItem: () => {} },
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      querySelectorAll: () => [],
      documentElement: {},
    },
    setTimeout,
    clearTimeout,
    Date,
    Number,
    Map,
    AbortController,
    DOMException,
  });
  vm.runInContext(source, context);
  return { context, elements };
}

function evaluate(context: vm.Context, expression: string) {
  return vm.runInContext(expression, context);
}

describe("dashboard trust semantics", () => {
  test("initial markup does not claim healthy quota before the first response", () => {
    const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
    expect(html).not.toContain("Used 0%");
    expect(html).not.toContain("100% left");
    expect(html).not.toContain('class="meta-value ok">Optimal');
    for (const id of [
      "text-today-tokens",
      "text-today-cost",
      "text-today-input",
      "text-today-output",
      "text-today-agents",
      "text-today-requests",
      "text-today-burn-rate",
      "resets-count-tag",
      "plans-count-tag",
      "history-total-count",
    ]) {
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*>—<`));
    }
    expect(html).toContain('id="chart-total-tokens" class="count-tag" style="font-size: 12px; color: var(--text-secondary); margin-left: 8px;">24h Total: —<');
  });

  test("local service connection copy is distinct from quota freshness", () => {
    const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
    expect(source).toContain("Local service connected");
    expect(source).toContain("Quota: live");
    expect(source).not.toContain("Live Stream Connected");
  });

  test("scan diagnostics do not claim complete database coverage", () => {
    const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
    expect(html).toContain("Dashboard last scan");
    expect(html).toContain("Unchanged files are not reread");
    expect(html).toContain("does not change this service's last-scan scope to all");
    expect(html).not.toContain(">Data coverage<");
  });

  test("only a recent successful WHAM snapshot is fresh", () => {
    const { context } = createWebContext();
    const states = JSON.parse(evaluate(context, `JSON.stringify([
      getQuotaTrustState({ source: "wham", updatedAt: 950000 }, 1000000),
      getQuotaTrustState({ source: "cache", updatedAt: 990000, errorReason: "HTTP 401" }, 1000000),
      getQuotaTrustState({ source: "wham", updatedAt: 800000 }, 1000000),
      getQuotaTrustState({ source: "fallback", updatedAt: 1000000, errorReason: "offline" }, 1000000),
      getQuotaTrustState({ source: "wham", updatedAt: 1000001 }, 1000000)
    ])`));

    expect(states[0].level).toBe("fresh");
    expect(states[1]).toMatchObject({ level: "cached", tone: "warn", errorReason: "HTTP 401" });
    expect(states[2]).toMatchObject({ level: "stale", tone: "warn" });
    expect(states[3]).toMatchObject({ level: "unavailable", tone: "danger", updatedAt: null });
    expect(states[4]).toMatchObject({ level: "stale", tone: "warn" });
  });

  test("cached quota cannot render a green normal window status", () => {
    const { context, elements } = createWebContext();
    for (const suffix of ["bar-five-hour", "text-five-hour-used", "text-five-hour-rem", "text-five-hour-reset", "text-five-hour-status"]) {
      elements.set(suffix, { style: {}, className: "", textContent: "" });
    }
    evaluate(context, `updateWindowCard("five-hour", {
      usedPercent: 20,
      resetAtMs: 1100000,
      resetAfterSeconds: 0,
      resetCountdown: ""
    }, { level: "cached", tone: "warn" })`);

    expect(elements.get("text-five-hour-status").className).toBe("meta-value warn");
    expect(elements.get("text-five-hour-status").textContent).toBe("Cached snapshot");
  });

  test("a Pro plan still shows a valid five-hour window", () => {
    const { context } = createWebContext();
    expect(evaluate(context, `shouldShowFiveHourWindow({ proTier: true, fiveHour: { usedPercent: 1 }, weekly: { usedPercent: 2 } })`)).toBe(true);
    expect(evaluate(context, `shouldShowFiveHourWindow({ proTier: true, fiveHour: null, weekly: { usedPercent: 2 } })`)).toBe(false);
  });

  test("unknown agent roles stay unknown instead of becoming main", () => {
    const { context } = createWebContext();
    expect(evaluate(context, `normalizeAgentRole(undefined)`)).toBe("unknown");
    expect(evaluate(context, `normalizeAgentRole("tool")`)).toBe("unknown");
    expect(evaluate(context, `normalizeAgentRole("main")`)).toBe("main");
  });

  test("reset-credit zero is shown only when the API confirms it is known", () => {
    const { context } = createWebContext();
    expect(evaluate(context, `getResetCreditsDisplay({ resetCredits: 0 })`)).toBe("—");
    expect(evaluate(context, `getResetCreditsDisplay({ resetCredits: 0, resetCreditsKnown: false })`)).toBe("—");
    expect(evaluate(context, `getResetCreditsDisplay({ resetCredits: 0, resetCreditsKnown: true })`)).toBe("0");
  });

  test("missing or error-like plan data stays unknown", () => {
    const { context } = createWebContext();
    expect(evaluate(context, `getPlanLabel({ source: "fallback", planType: null })`)).toBe("—");
    expect(evaluate(context, `getPlanLabel({ source: "cache", planType: "HTTP error" })`)).toBe("—");
    expect(evaluate(context, `getPlanLabel({ source: "wham", planType: "pro" })`)).toBe("pro");
  });

  test("mixed stored pricing sources are shown explicitly", () => {
    const { context } = createWebContext();
    const label = evaluate(context, `describePricingProvenance({ pricingProvenance: [
      { source: "user-config", version: "custom-v1", records: 2 },
      { source: "fallback", version: "2026-09-09", records: 1 }
    ] })`);
    expect(label).toContain("mixed:");
    expect(label).toContain("user-config custom-v1");
    expect(label).toContain("fallback 2026-09-09");
    expect(evaluate(context, `describePricingProvenance({ pricing: { source: "builtin" } })`)).toBe("unknown");
  });

  test("web CSV keeps stored pricing provenance", () => {
    const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
    expect(source).toContain('"PricingSource", "PricingVersion"');
    expect(source).toContain('record.pricingSource || "unknown"');
    expect(source).toContain('record.pricingVersion || "unknown"');
  });
});
