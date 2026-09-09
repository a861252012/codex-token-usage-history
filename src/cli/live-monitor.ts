import readline from "node:readline";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { renderQuotaStatus, renderUsageSummary, renderRecentRecords } from "./formatters.js";
import type { QuotaSnapshot } from "../core/types.js";

export async function runLiveMonitor(): Promise<void> {
  const db = new HistoryDatabase();
  await db.init();

  const quotaClient = new QuotaClient();
  const indexer = new SessionIndexer(db);
  const watcher = new SessionWatcher(indexer, quotaClient);

  let currentSnapshot: QuotaSnapshot = await quotaClient.getQuotaSnapshot();
  let isExiting = false;

  watcher.on("quotaUpdated", (snap: QuotaSnapshot) => {
    currentSnapshot = snap;
    render();
  });

  watcher.on("newRecords", () => {
    render();
  });

  watcher.start(30_000);

  // 初次清屏並隱藏游標
  process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");

  function restoreScreen(): void {
    process.stdout.write("\x1b[?25h\n");
  }

  function render(): void {
    if (isExiting) return;

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
    const todaySummary = db.getSummary(todayMidnight.getTime());
    const summarySection = renderUsageSummary(todaySummary, "本日 Token 消耗統計 (從 00:00 起算)");

    const { records } = db.queryRecords({ limit: 8 });
    const recordsSection = renderRecentRecords(records, 8);

    const fullOutput = [
      header,
      quotaSection,
      "",
      summarySection,
      "",
      recordsSection,
      "\n 即時監控中... (當 Codex APP 或 CLI 產生新對話時將自動刷新)\x1b[J",
    ].join("\n");

    process.stdout.write(fullOutput);
  }

  render();

  // 每 1 秒平滑重繪動態倒數秒數
  const tickInterval = setInterval(() => {
    render();
  }, 1000);

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on("keypress", async (str, key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        return;
      }
      if (key.name === "q") {
        cleanup();
        return;
      }
      if (key.name === "r") {
        currentSnapshot = await quotaClient.getQuotaSnapshot(true);
        indexer.indexRecent(1);
        render();
      }
    });
  }

  function cleanup(): void {
    if (isExiting) return;
    isExiting = true;
    clearInterval(tickInterval);
    watcher.stop();
    db.close();
    restoreScreen();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
