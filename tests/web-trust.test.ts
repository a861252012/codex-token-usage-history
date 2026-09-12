import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

test("empty summary has no imaginary role share and model bars use total usage", async () => {
  const { context, elements } = createWebContext();
  for (const id of ["text-today-tokens", "text-today-cost", "text-today-input", "text-today-output", "text-today-agents", "text-today-requests", "text-today-burn-rate", "model-bars-container"]) {
    elements.set(id, { textContent: "", innerHTML: "" });
  }
  context.fetch = async () => ({ ok: true, json: async () => ({ totalTokens: 0, byModel: [] }) });
  await vm.runInContext("fetchSummary()", context);
  expect(elements.get("text-today-agents").textContent).toBe("—");
  context.fetch = async () => ({ ok: true, json: async () => ({ totalTokens: 100, mainAgentTokens: 75, subAgentTokens: 25, byModel: [{ model: "a", totalTokens: 75 }, { model: "b", totalTokens: 25 }] }) });
  await vm.runInContext("fetchSummary()", context);
  expect(elements.get("model-bars-container").innerHTML).toContain("width: 75%");
  expect(elements.get("model-bars-container").innerHTML).toContain("width: 25%");
  expect(elements.get("text-today-agents").textContent).not.toContain("Unknown");
});

test("history and event timestamps use the existing local-time formatter", () => {
  const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
  expect(source).not.toContain('datetime.replace("T", " ").slice(0, 19)');
  expect(source.match(/formatTimestamp\((?:record|event)\.timestamp/g)?.length).toBe(4);
});

test("account email and plan badge are separate for each plan", () => {
  const { context, elements } = createWebContext();
  const account = { textContent: "" };
  const badge = { textContent: "", hidden: true };
  elements.set("account-badge", account);
  elements.set("plan-badge", badge);
  for (const [plan, label] of [["pro", "PRO"], ["plus", "PLUS"], ["business", "BUSINESS"], ["enterprise", "ENTERPRISE"]]) {
    vm.runInContext(`renderQuotaSnapshot({source:"wham", email:"test@example.com", planType:"${plan}"})`, context);
    expect(account.textContent).toBe("test@example.com");
    expect(badge.textContent).toBe(label);
    expect(badge.hidden).toBe(false);
  }
  vm.runInContext('renderQuotaSnapshot({source:"fallback", planType:null})', context);
  expect(badge.hidden).toBe(true);
  expect(badge.textContent).toBe("");
});

test("Spark shows separate remaining bars and does not invent missing quota", () => {
  const { context, elements } = createWebContext();
  const list = { innerHTML: "" };
  elements.set("additional-limits-section", { style: {} });
  elements.set("additional-limits-list", list);
  vm.runInContext('renderQuotaSnapshot({additionalLimits:[{limitName:"GPT-5.3-Codex-Spark", primaryWindow:{usedPercent:20}, secondaryWindow:{usedPercent:100}}]})', context);
  expect(list.innerHTML).toContain("width: 80%");
  expect(list.innerHTML).toContain("width: 0%");
  expect(list.innerHTML).toContain("80% left");
  expect(list.innerHTML.match(/role="progressbar"/g)?.length).toBe(2);
  vm.runInContext('renderQuotaSnapshot({additionalLimits:[{limitName:"Spark",primaryWindow:null,secondaryWindow:null}]})', context);
  expect(list.innerHTML).toContain("Unavailable");
  expect(list.innerHTML).not.toContain("100% left");
});

test("quota bars represent remaining quota for both windows", () => {
  const { context, elements } = createWebContext();
  for (const prefix of ["five-hour", "weekly"]) {
    const bar = { style: { width: "" } };
    elements.set(`bar-${prefix}`, bar);
    for (const used of [0, 20, 80, 100]) {
      vm.runInContext(`updateWindowCard("${prefix}", { usedPercent: ${used} }, { level: "fresh" })`, context);
      expect(bar.style.width).toBe(`${100 - used}%`);
    }
    vm.runInContext(`updateWindowCard("${prefix}", null)`, context);
    expect(bar.style.width).toBe("0%");
  }
});

test("HUD interval constrains typing and paste to 1–300 while allowing edits", () => {
  const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
  const start = source.indexOf('  const intervalInput = document.getElementById("hud-interval");');
  const end = source.indexOf('  document.getElementById("hud-settings-form").addEventListener', start);
  const handlers: Record<string, (event?: any) => void> = {};
  const input = { value: "5", dataset: {}, setCustomValidity() {},
    addEventListener: (name: string, handler: (event?: any) => void) => { handlers[name] = handler; },
    dispatchEvent: () => handlers.input(),
  };
  vm.runInNewContext(source.slice(start, end), { document: { getElementById: () => input }, Event });
  for (const [value, expected] of [["999999999999999999999", "300"], ["301", "300"], ["0", "1"], ["-4", "1"], ["5.8", "5"], ["1", "1"], ["300", "300"], ["", ""]]) {
    input.value = value;
    handlers.input();
    expect(input.value).toBe(expected);
  }
  for (const value of ["e", "-", ".", "+"]) {
    let prevented = false;
    handlers.beforeinput({ data: value, preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
  }
  for (const [value, expected] of [["999999999999", "300"], ["0", "1"], ["1e9", "5"], ["abc", "5"]]) {
    input.value = "5";
    handlers.paste({ clipboardData: { getData: () => value }, preventDefault() {} });
    expect(input.value).toBe(expected);
  }
  const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
  expect(html).toMatch(/id="hud-interval"[^>]*min="1" max="300" step="1"/);
});

test("countdowns over 24 hours use days and quota assessments are absent", () => {
  const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
  const formatter = source.slice(source.indexOf("function formatCountdown("), source.indexOf("function tickCountdown("));
  const context = vm.createContext({ currentLanguage: "en" });
  vm.runInContext(formatter, context);
  expect(vm.runInContext("formatCountdown(558287)", context)).toBe("6d 11h 4m 47s");
  expect(vm.runInContext("formatCountdown(86400)", context)).toBe("24h 0m 0s");
  expect(vm.runInContext("formatCountdown(86401)", context)).toBe("1d 0h 0m 1s");
  context.currentLanguage = "zh-TW";
  expect(vm.runInContext("formatCountdown(558287)", context)).toBe("6 天 11 時 4 分 47 秒");
  expect(vm.runInContext("formatCountdown(0)", context)).toBe("即將重設");
  const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
  expect(html).not.toMatch(/id="(?:label|text)-(?:five-hour|weekly)-status"/);
});

test("manual refresh skips overlapping batches without a high-frequency timer", async () => {
  const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
  const block = source.slice(source.indexOf("  async function refreshDashboard("), source.indexOf('  document.getElementById("btn-export-csv").addEventListener'));
  const handlers: Record<string, () => void> = {};
  const attributes: Record<string, string> = {};
  const button = { disabled: false, setAttribute() {}, removeAttribute() {}, addEventListener(_event: string, fn: () => void) { handlers.manual = fn; } };
  let tick: (() => void) | undefined;
  let calls = 0;
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>((resolve) => { finish = resolve; });
  const fetchData = () => { calls++; return pending; };
  vm.runInNewContext(block, {
    document: { getElementById: (id: string) => id === "btn-refresh" ? button : {
      setAttribute: (key: string, value: string) => { attributes[key] = value; },
      addEventListener: (_event: string, fn: () => void) => { handlers.toggle = fn; },
    } },
    window: { addEventListener: (_event: string, fn: () => void) => { handlers.leave = fn; } },
    setInterval: (fn: () => void, delay: number) => { expect(delay).toBe(1000); tick = fn; return 1; },
    clearInterval: () => { tick = undefined; },
    fetchQuota: fetchData, fetchSummary: fetchData, fetchHourlyStats: fetchData,
    fetchSettlementReport: fetchData, fetchResetEvents: fetchData, fetchPlanChangeEvents: fetchData,
    fetchHistory: fetchData, fetchDiagnostics: fetchData,
    currentSettlementPeriod: "daily", lastQuotaSnapshot: { updatedAt: 1 }, lastQuotaTrust: { level: "fresh" }, showFeedback() {}, uiText: (value: string) => value,
  });
  handlers.manual();
  expect(calls).toBe(1);
  handlers.manual();
  expect(calls).toBe(1);
  finish(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(7);
  handlers.manual();
  expect(calls).toBe(8);
  expect(tick).toBeUndefined();
  expect(source).not.toContain("highFrequency");
});

test("quota reset and plan history remain visible without disclosure controls", () => {
  const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
  for (const name of ["resets", "plans"]) {
    const section = html.match(new RegExp(`<section class="${name}-section card"[^>]*>[\\s\\S]*?</section>`))?.[0];
    expect(section).toBeDefined();
    expect(section).toContain(`id="${name}-table-body"`);
    expect(section).not.toMatch(/<details|<summary|\bhidden\b/);
  }
});

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

  test("header omits subtitle and successful connection copy", () => {
    const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
    const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
    expect(html).not.toContain('id="app-subtitle"');
    expect(html).toContain('id="connection-status" class="status-badge connecting" hidden');
    expect(source).not.toContain("Local service connected");
    expect(source).not.toContain("MacBook 即時監控儀表板");
    expect(source).toContain("Quota: live");
    expect(source).not.toContain("Live Stream Connected");
  });

  test("scan diagnostics do not claim complete database coverage", () => {
    const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
    expect(html).not.toContain("diagnostics-section");
    expect(html).not.toContain("Dashboard last scan");
    expect(html).not.toContain("codex-usage index --all");
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
