import readline from "node:readline";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { renderQuotaStatus, renderUsageSummary, renderRecentRecords } from "./formatters.js";
import type { QuotaSnapshot } from "../core/types.js";

export async function runLiveMonitor(): Promise<void> {
  const database = new HistoryDatabase();
  await database.init();

  const quotaClient = new QuotaClient(undefined, database);
  const sessionIndexer = new SessionIndexer(database);
  const sessionWatcher = new SessionWatcher(sessionIndexer, quotaClient);

  let currentSnapshot: QuotaSnapshot = await quotaClient.getQuotaSnapshot();
  let exitingActive = false;

  sessionWatcher.on("quotaUpdated", (quotaSnapshot: QuotaSnapshot) => {
    currentSnapshot = quotaSnapshot;
    renderMonitorDashboard();
  });

  sessionWatcher.on("newRecords", () => {
    renderMonitorDashboard();
  });

  sessionWatcher.start(30_000);

  // 初次清屏並隱藏游標
  process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");

  function restoreScreen(): void {
    process.stdout.write("\x1b[?25h\n");
  }

  function renderMonitorDashboard(): void {
    if (exitingActive) return;

    // 平滑原地覆寫，消除全螢幕閃爍 (No-Flicker Repositioning)
    process.stdout.write("\x1b[H");

    const header = [
      "==============================================================================",
      " [Codex 即時額度與 Token 消耗監控中心]   (按 'r' 重新整理 | 'q' 退出畫面)",
      "==============================================================================",
    ].join("\n");

    const quotaSection = renderQuotaStatus(currentSnapshot);

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todaySummary = database.getSummary(todayMidnight.getTime());
    const summarySection = renderUsageSummary(todaySummary, "本日 Token 消耗統計 (從 00:00 起算)");

    const { records: recentRecords } = database.queryRecords({ limit: 8 });
    const recordsSection = renderRecentRecords(recentRecords, 8);

    const fullOutput = [
      header,
      quotaSection,
      "",
      summarySection,
      "",
      recordsSection,
      "\n 即時監控中... (當 Codex APP 或 CLI 產生新對話時將自動更新)\x1b[J",
    ].join("\n");

    process.stdout.write(fullOutput);
  }

  renderMonitorDashboard();

  // 每 1 秒平滑重繪動態倒數秒數
  const tickInterval = setInterval(() => {
    renderMonitorDashboard();
  }, 1000);

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on("keypress", async (keyString, pressedKey) => {
      if (pressedKey.ctrl && pressedKey.name === "c") {
        performCleanup();
        return;
      }
      if (pressedKey.name === "q") {
        performCleanup();
        return;
      }
      if (pressedKey.name === "r") {
        currentSnapshot = await quotaClient.getQuotaSnapshot(true);
        sessionIndexer.indexRecent(1);
        renderMonitorDashboard();
      }
    });
  }

  function performCleanup(): void {
    if (exitingActive) return;
    exitingActive = true;
    clearInterval(tickInterval);
    sessionWatcher.stop();
    database.close();
    restoreScreen();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }

  process.on("SIGINT", performCleanup);
  process.on("SIGTERM", performCleanup);
}
