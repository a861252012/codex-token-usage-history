// Optional tooling: run against `bun run demo`, with Playwright available via NODE_PATH.
const { chromium } = require("playwright");
const { mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const directory = resolve(__dirname, "../docs/screenshots");
  mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:10201", { waitUntil: "domcontentloaded" });
    await page.locator("#account-badge").filter({ hasText: "demo@example.com" }).waitFor();
    await page.waitForFunction(() => document.querySelector("#text-today-tokens").textContent !== "0");
    await page.locator("#hourly-chart-container svg").waitFor();
    assert.ok(!(await page.locator("#pricing-meta").textContent()).includes("undefined"));
    await page.waitForFunction(() => !document.querySelector('tbody[aria-busy="true"]'));
    await page.screenshot({ path: resolve(directory, "dashboard-en.png"), animations: "disabled" });

    await page.locator('[data-lang="zh-TW"]').click();
    await page.locator("#app-title").filter({ hasText: "Codex Token 額度與消耗歷史" }).waitFor();
    assert.match(await page.locator("#text-weekly-used").textContent(), /已用/);
    assert.match(await page.locator("#filter-agent-role option[value=subagent]").textContent(), /僅/);
    assert.ok(await page.locator("#pricing-meta").count(), "Language changes must preserve pricing metadata");
    await page.waitForFunction(() => !document.querySelector('tbody[aria-busy="true"]'));
    await page.screenshot({ path: resolve(directory, "dashboard-zh-tw.png"), animations: "disabled" });

    await page.locator('[data-period="weekly"]').click();
    await page.waitForFunction(() => document.querySelector("#settlement-info-tag").textContent.includes("WEEKLY"));
    await page.locator("#settlement-table-body tr").first().waitFor();
    await page.locator("#settlement-table-body").evaluate((node) => node.closest("section").scrollIntoView());
    await page.screenshot({ path: resolve(directory, "weekly-report.png"), animations: "disabled" });

    const filtered = page.waitForResponse((response) => response.url().includes("/api/history?") && response.url().includes("agent_role=subagent"));
    await page.locator("#filter-agent-role").selectOption("subagent");
    const response = await filtered;
    const data = await response.json();
    assert.ok(data.records.length > 0 && data.records.every((record) => record.agentRole === "subagent"));
    await page.waitForFunction(() => [...document.querySelectorAll("#history-table-body tr")].every((row) => row.textContent.includes("subAgent")));
    await page.locator("#history").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(directory, "subagent-history.png"), animations: "disabled" });
    await page.locator("[data-record-index]").first().click();
    assert.equal(await page.locator("#record-dialog").isVisible(), true);
    assert.match(await page.locator("#record-details").textContent(), /demo-/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#record-dialog").isVisible(), false);
    let exportRequests = 0;
    await page.route("**/api/history?limit=5000*", async (route) => {
      exportRequests++;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#btn-export-csv").click();
    assert.equal(await page.locator("#btn-export-csv").isDisabled(), true);
    await page.locator("#btn-export-csv").evaluate((button) => button.click());
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /^codex_token_usage.*\.csv$/);
    assert.equal(await download.failure(), null);
    assert.equal(exportRequests, 1, "Export must not download twice");
    await page.unroute("**/api/history?limit=5000*");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile page must not overflow horizontally");
    await page.screenshot({ path: resolve(directory, "dashboard-mobile.png"), animations: "disabled" });
    await page.evaluate(() => { updateWindowCard("weekly", null); tickCountdown(); });
    assert.equal(await page.locator("#text-weekly-used").textContent(), "尚無資料");
    assert.equal(await page.locator("#text-weekly-reset").textContent(), "—");
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator("#btn-reset-filters").click();
    await page.waitForFunction(() => !document.querySelector("#history-table-body").hasAttribute("aria-busy"));

    // Slow and failed responses exercise the actual UI without touching user data.
    await page.route("**/api/history?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.locator("#filter-model").fill("no-such-demo-model");
    await page.locator("#history-table-body .skeleton").first().waitFor();
    assert.equal(await page.locator("#btn-next-page").isDisabled(), true);
    await page.locator("#history-table-body .empty-state").waitFor();
    assert.match(await page.locator("#page-indicator").textContent(), /1 \/ 1/);
    await page.locator("#history-table-body .empty-state button").click();
    await page.waitForFunction(() => document.querySelector("#history-total-count").textContent.includes("336"));
    await page.unroute("**/api/history?*");

    await page.route("**/api/history?*", (route) => route.fulfill({ status: 500, body: "test failure" }));
    await page.locator("#filter-model").fill("gpt");
    await page.locator("#history-table-body .empty-state strong").filter({ hasText: "無法載入" }).waitFor();
    assert.equal(await page.locator("#request-feedback").getAttribute("data-tone"), "danger");
    await page.unroute("**/api/history?*");
    await page.locator("#history-table-body .empty-state button").click();
    await page.waitForFunction(() => !document.querySelector("#history-table-body .empty-state") && !document.querySelector("#history-table-body").hasAttribute("aria-busy"));

    let forcedRequests = 0;
    await page.route("**/api/quota?force=true", async (route) => {
      forcedRequests++;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.locator("#btn-refresh").click();
    assert.equal(await page.locator("#btn-refresh").isDisabled(), true);
    await page.locator("#btn-refresh").evaluate((button) => button.click());
    await page.waitForFunction(() => !document.querySelector("#btn-refresh").disabled);
    assert.equal(forcedRequests, 1, "Refresh must not submit twice");
    assert.equal(await page.locator("#request-feedback").getAttribute("data-tone"), "success");
    await page.route("**/api/history?*", async (route) => {
      if (route.request().url().includes("model=gpt-6")) await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    const olderRequest = page.waitForRequest((request) => request.url().includes("model=gpt-6"));
    await page.locator("#filter-model").fill("gpt-6");
    await olderRequest;
    await page.locator("#filter-model").fill("gpt-5.6");
    await page.waitForFunction(() => !document.querySelector('#history-table-body[aria-busy]') && document.querySelector("#history-table-body").textContent.includes("gpt-5.6"));
    await page.waitForTimeout(1300);
    assert.ok(!(await page.locator("#history-table-body").textContent()).includes("gpt-6"), "Late responses must not overwrite newer filters");
    await page.unroute("**/api/history?*");
    assert.deepEqual(errors, [], "Dashboard should have no uncaught browser errors");
    console.log("PASS: dashboard, language, weekly report, CSV, mobile, skeleton, empty state, reset, failure/retry, refresh deduplication.");
    console.log(`Screenshots: ${directory}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
