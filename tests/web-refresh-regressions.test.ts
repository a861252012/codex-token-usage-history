import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");

test("SSE reconnect restores usage panels and quota events refresh their dependent tables", () => {
  const calls: Array<[string, unknown[]]> = [];
  let stream: any;
  const status = { hidden: true, textContent: "", className: "" };
  const context = vm.createContext({
    localStorage: { getItem: () => "en" },
    document: { getElementById: () => status, querySelectorAll: () => [] },
    EventSource: class {
      handlers: Record<string, (event: any) => void> = {};
      constructor() { stream = this; }
      addEventListener(name: string, handler: (event: any) => void) { this.handlers[name] = handler; }
    },
    setTimeout, clearTimeout, AbortController, DOMException,
    recordCall: (name: string, args: unknown[]) => { calls.push([name, args]); },
  });
  vm.runInContext(source.split("// Initialization")[0], context);
  for (const name of ["fetchSummary", "fetchHourlyStats", "fetchSettlementReport", "fetchHistory", "fetchResetEvents", "fetchPlanChangeEvents", "renderQuotaSnapshot"]) {
    vm.runInContext(`${name} = (...args) => recordCall(${JSON.stringify(name)}, args);`, context);
  }
  vm.runInContext('currentPage = 2; currentFilterModel = "gpt"; currentSettlementPeriod = "weekly"; setupSse();', context);
  stream.onopen();
  expect(calls).toEqual([]);
  stream.onerror();
  expect(status.hidden).toBe(false);
  stream.onopen();
  expect(status.hidden).toBe(true);
  expect(calls.map(([name]) => name)).toEqual(["fetchSummary", "fetchHourlyStats", "fetchSettlementReport", "fetchHistory"]);
  expect(calls[2][1]).toEqual(["weekly", "reconnect:1"]);
  expect(vm.runInContext('[currentPage, currentFilterModel]', context)).toEqual([2, "gpt"]);
  calls.length = 0;
  const snapshot = { updatedAt: 1234, planType: "pro", resetCredits: 1 };
  stream.handlers.quota({ data: JSON.stringify(snapshot) });
  expect(calls).toEqual([
    ["renderQuotaSnapshot", [snapshot]],
    ["fetchResetEvents", [1234]],
    ["fetchPlanChangeEvents", [1234]],
  ]);
});

test("reconnect supersedes an outstanding request instead of reusing its stale result", async () => {
  let stream: any;
  const requests: Array<{ signal: AbortSignal; resolve: (value: any) => void }> = [];
  const rendered: unknown[] = [];
  const context = vm.createContext({
    localStorage: { getItem: () => "en" },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    EventSource: class {
      constructor() { stream = this; }
      addEventListener() {}
    },
    fetch: (_url: string, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
      requests.push({ signal, resolve });
      signal.addEventListener("abort", () => reject(signal.reason));
    }),
    recordRendered: (value: unknown) => { rendered.push(value); },
    setTimeout, clearTimeout, AbortController, DOMException,
  });
  vm.runInContext(source.split("// Initialization")[0], context);
  vm.runInContext(`
    fetchSummary = withRequestFeedback(async () => {
      const response = await dashboardFetch("/api/summary");
      recordRendered(await response.json());
    });
    fetchHourlyStats = fetchSettlementReport = fetchHistory = () => {};
    setupSse();
  `, context);
  const oldRequest = vm.runInContext("fetchSummary()", context);
  stream.onerror();
  stream.onopen();
  expect(requests).toHaveLength(2);
  expect(requests[0].signal.aborted).toBe(true);
  const newRequest = vm.runInContext('fetchSummary("reconnect:1")', context);
  requests[1].resolve({ ok: true, json: async () => ({ totalTokens: 100 }) });
  await Promise.all([oldRequest, newRequest]);
  expect(rendered).toEqual([{ totalTokens: 100 }]);
});

test("manual refresh reads reset and plan events after quota has persisted them", async () => {
  const block = source.slice(source.indexOf("  async function refreshDashboard("), source.indexOf('  document.getElementById("btn-export-csv").addEventListener'));
  let finishQuota!: (value: boolean) => void;
  let persisted = 0;
  const rows: number[] = [];
  const feedback: string[] = [];
  const button = { disabled: false, setAttribute() {}, removeAttribute() {}, addEventListener() {} };
  const context = vm.createContext({
    document: { getElementById: () => button },
    fetchQuota: () => new Promise<boolean>((resolve) => { finishQuota = resolve; }),
    fetchResetEvents: async () => { rows.push(persisted); return true; },
    fetchPlanChangeEvents: async () => { rows.push(persisted); return true; },
    fetchSummary: async () => true, fetchHourlyStats: async () => true,
    fetchSettlementReport: async () => true, fetchHistory: async () => true,
    currentSettlementPeriod: "daily", lastQuotaSnapshot: { updatedAt: 1234 },
    lastQuotaTrust: { level: "fresh" }, uiText: (value: string) => value,
    showFeedback: (message: string) => feedback.push(message),
  });
  vm.runInContext(block, context);
  const refresh = vm.runInContext("refreshDashboard()", context);
  expect(rows).toEqual([]);
  expect(button.disabled).toBe(true);
  persisted = 1;
  finishQuota(true);
  await refresh;
  expect(rows).toEqual([1, 1]);
  expect(feedback).toEqual(["Data refreshed with a live quota snapshot."]);
  expect(button.disabled).toBe(false);

  const failedRefresh = vm.runInContext("refreshDashboard()", context);
  finishQuota(false);
  await failedRefresh;
  expect(feedback.at(-1)).toBe("Some data could not be refreshed. Please retry.");
  expect(button.disabled).toBe(false);
});

for (const status of [200, 500]) {
  test(`manual refresh follows repeated SSE replacements and reports their HTTP ${status} result`, async () => {
    const requests: Array<{ resolve: (response: any) => void }> = [];
    const feedback: Array<[string, string]> = [];
    let stream: any;
    let finished = false;
    const button = { disabled: false, setAttribute() {}, removeAttribute() {}, addEventListener() {} };
    const context = vm.createContext({
      localStorage: { getItem: () => "en" },
      document: { getElementById: (id: string) => id === "btn-refresh" ? button : null, querySelectorAll: () => [] },
      EventSource: class {
        constructor() { stream = this; }
        addEventListener() {}
      },
      fetch: (_url: string, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
        requests.push({ resolve });
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
      recordFeedback: (message: string, tone: string) => feedback.push([message, tone]),
      setTimeout, clearTimeout, AbortController, DOMException,
    });
    vm.runInContext(source.split("// Initialization")[0], context);
    vm.runInContext(`
      fetchQuota = fetchHourlyStats = fetchSettlementReport = fetchResetEvents = fetchPlanChangeEvents = fetchHistory = async () => true;
      fetchSummary = withRequestFeedback(async () => { await dashboardFetch("/api/summary"); });
      showFeedback = (message, tone = "success") => recordFeedback(message, tone);
      lastQuotaTrust = { level: "fresh" };
      setupSse();
    `, context);
    const manual = source.slice(source.indexOf("  async function refreshDashboard("), source.indexOf('  document.getElementById("btn-export-csv").addEventListener'));
    vm.runInContext(manual, context);
    const refresh = vm.runInContext("refreshDashboard()", context).then(() => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let attempt = 0; attempt < 2; attempt++) {
      stream.onerror();
      stream.onopen();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(finished).toBe(false);
      expect(button.disabled).toBe(true);
      expect(feedback).toEqual([]);
    }
    expect(requests).toHaveLength(3);
    requests[2].resolve({ ok: status === 200, status, json: async () => ({}) });
    await refresh;
    expect(button.disabled).toBe(false);
    expect(feedback.at(-1)).toEqual(status === 200
      ? ["Data refreshed with a live quota snapshot.", "success"]
      : ["Some data could not be refreshed. Please retry.", "danger"]);
  });
}

test("a late superseded response follows the already completed latest request", async () => {
  const finishes: Array<() => void> = [];
  const context = vm.createContext({
    document: { querySelectorAll: () => [] }, currentLanguage: "en",
    task: () => new Promise<void>((resolve) => finishes.push(resolve)),
  });
  const wrapper = source.slice(source.indexOf("function withRequestFeedback("), source.indexOf("// Countdown Target Timestamps"));
  vm.runInContext(`${wrapper}\nconst refresh = withRequestFeedback(task);`, context);
  const oldRequest = vm.runInContext('refresh("old")', context);
  const latestRequest = vm.runInContext('refresh("new")', context);
  finishes[1]();
  expect(await latestRequest).toBe(true);
  finishes[0]();
  expect(await oldRequest).toBe(true);
});

for (const timezone of ["America/New_York", "Asia/Kolkata"]) {
  test(`hourly API and chart count each token once in ${timezone}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-hourly-regression-"));
    try {
      const script = join(directory, "hourly.ts");
      writeFileSync(script, `
        import { HistoryDatabase } from ${JSON.stringify(join(import.meta.dir, "../src/core/history-db.ts"))};
        import { readFileSync } from "node:fs";
        import vm from "node:vm";
        const database = new HistoryDatabase(":memory:");
        await database.init();
        const now = Date.parse("2026-11-01T08:30:00Z");
        Date.now = () => now;
        for (const [datetime, totalTokens, turnId] of [["2026-11-01T05:15:00Z", 40, "a"], ["2026-11-01T06:15:00Z", 60, "b"]]) {
          database.insertRecord({ timestamp: Date.parse(datetime), datetime, totalTokens, turnId,
            sessionId: "s", threadId: "s", model: "test", inputTokens: totalTokens,
            cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 });
        }
        const rows = database.getHourlyStats(24);
        const source = readFileSync(${JSON.stringify(join(import.meta.dir, "../src/web/app.js"))}, "utf8");
        const nodes = new Map(["chart-total-tokens", "hourly-chart-container", "chart-tooltip"].map(id => [id, { innerHTML: "", textContent: "", querySelectorAll: () => [] }]));
        const context = vm.createContext({
          document: { getElementById: id => nodes.get(id) },
          dashboardFetch: async () => ({ ok: true, json: async () => rows }),
          Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
          uiText: value => value, formatNumber: value => String(value),
        });
        vm.runInContext(source.slice(source.indexOf("async function fetchHourlyStats()"), source.indexOf("async function fetchSettlementReport(")), context);
        await vm.runInContext("fetchHourlyStats()", context);
        console.log(JSON.stringify({ rows, total: nodes.get("chart-total-tokens").textContent,
          html: nodes.get("hourly-chart-container").innerHTML }));
        database.close();
      `);
      const result = spawnSync(process.execPath, [script], {
        env: { ...process.env, CODEX_HOME: directory, TZ: timezone },
        encoding: "utf8", timeout: 5000,
      });
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.rows.map((row: any) => row.hourStartMs)).toEqual([
        Date.parse("2026-11-01T05:00:00Z"), Date.parse("2026-11-01T06:00:00Z"),
      ]);
      expect(output.rows.map((row: any) => row.tokens)).toEqual([40, 60]);
      expect(output.total).toBe("24h total: 100 tokens");
      expect(output.html).toContain('data-tokens="40"');
      expect(output.html).toContain('data-tokens="60"');
      expect(output.rows.map((row: any) => row.hour)).toEqual(timezone === "America/New_York"
        ? ["2026-11-01 01:00", "2026-11-01 01:00"]
        : ["2026-11-01 10:30", "2026-11-01 11:30"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
