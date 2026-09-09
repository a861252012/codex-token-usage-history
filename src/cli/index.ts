#!/usr/bin/env node
import { parseArgs } from "node:util";
import { exec } from "node:child_process";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";
import { runLiveMonitor } from "./live-monitor.js";
import { DashboardServer } from "../server/app.js";
import { runMcpServer } from "../mcp/server.js";
import {
  renderQuotaStatus,
  renderUsageSummary,
  renderRecentRecords,
  renderSettlementTable,
  renderResetEventsTable,
  renderPromptString,
} from "./formatters.js";

async function main(): Promise<void> {
  const argumentList = process.argv.slice(2);
  const commandName = argumentList[0] && !argumentList[0].startsWith("-") ? argumentList[0] : "status";

  // 1. 即時終端機動態監控 (TUI)
  if (commandName === "live" || commandName === "watch") {
    await runLiveMonitor();
    return;
  }

  // 2. 原生置頂懸浮膠囊列 (Always-on-Top Floating HUD)
  if (commandName === "hud" || commandName === "bar" || commandName === "pet") {
    const hudExecutablePath = new URL("../../bin/codex-hud", import.meta.url).pathname;
    exec(`"${hudExecutablePath}" &`, (executionError) => {
      if (executionError) {
        console.error(`[錯誤] 無法啟動置頂懸浮列: ${executionError.message}`);
      }
    });
    console.log("[成功] 已啟動 MacBook 原生置頂懸浮列 (Always-on-Top Floating HUD)");
    console.log("[說明] 懸浮列已置頂顯示於螢幕上方，滑鼠可直接拖曳移動位置，點擊本體可切換心情面板，按右上角 × 可關閉。");
    return;
  }

  // 3. MCP 伺服器 (供 Codex APP 與 CLI 工具呼叫)
  if (commandName === "mcp") {
    await runMcpServer();
    return;
  }

  // 4. 多週期結算報表 (每日、每週、每月、每年)
  if (commandName === "report" || commandName === "settle" || commandName === "settlement") {
    const { values } = parseArgs({
      args: argumentList.slice(1),
      options: {
        period: { type: "string", short: "p", default: "daily" },
        limit: { type: "string", short: "l", default: "14" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const periodType = (values.period || "daily") as "daily" | "weekly" | "monthly" | "yearly";
    const limitCount = parseInt(values.limit || "14", 10);

    const database = new HistoryDatabase();
    await database.init();

    // 增量掃描最新紀錄
    const indexer = new SessionIndexer(database);
    indexer.indexRecent(3);

    const settlementRecords = database.getSettlementRecords(periodType, limitCount);

    if (values.json) {
      console.log(JSON.stringify(settlementRecords, null, 2));
      database.close();
      return;
    }

    console.log(renderSettlementTable(settlementRecords, periodType));
    database.close();
    return;
  }

  // 5. 查詢 OpenAI 配額重置事件與重置券歷史
  if (commandName === "resets" || commandName === "credits") {
    const { values } = parseArgs({
      args: argumentList.slice(1),
      options: {
        limit: { type: "string", short: "l", default: "20" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const limitCount = parseInt(values.limit || "20", 10);
    const database = new HistoryDatabase();
    await database.init();

    const resetEvents = database.getResetEvents(limitCount);

    if (values.json) {
      console.log(JSON.stringify(resetEvents, null, 2));
      database.close();
      return;
    }

    console.log(renderResetEventsTable(resetEvents));
    database.close();
    return;
  }

  // 6. 啟動 Web 儀表板與 API 伺服器
  if (commandName === "serve") {
    const { values } = parseArgs({
      args: argumentList.slice(1),
      options: {
        port: { type: "string", short: "p", default: "10200" },
        host: { type: "string", short: "h", default: "127.0.0.1" },
        open: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const port = parseInt(values.port || "10200", 10);
    const host = values.host || "127.0.0.1";
    const database = new HistoryDatabase();
    const server = new DashboardServer(database, { port, host });

    try {
      const serverUrl = await server.start();
      console.log(`==============================================================================`);
      console.log(`[成功] Codex Token 歷史與配額儀表板已啟動: ${serverUrl}`);
      console.log(`[說明] 支援 Server-Sent Events 即時推播與多週期結算圖表，請在瀏覽器中檢視`);
      console.log(`[操作] 按 Ctrl+C 停止伺服器`);
      console.log(`==============================================================================`);

      if (values.open) {
        exec(`open "${serverUrl}"`);
      }
    } catch (serverError: any) {
      console.error(`[錯誤] 伺服器啟動失敗: ${serverError.message}`);
      process.exit(1);
    }
    return;
  }

  // 7. Shell Prompt 狀態字串 (供 zsh / bash 整合)
  if (commandName === "prompt") {
    const quotaClient = new QuotaClient();
    const quotaSnapshot = await quotaClient.getQuotaSnapshot(false);
    console.log(renderPromptString(quotaSnapshot));
    return;
  }

  // 8. 手動掃描與增量索引
  if (commandName === "index") {
    const { values } = parseArgs({
      args: argumentList.slice(1),
      options: {
        all: { type: "boolean", short: "a", default: false },
        days: { type: "string", short: "d", default: "7" },
      },
    });

    const database = new HistoryDatabase();
    await database.init();
    const indexer = new SessionIndexer(database);

    console.log(`[掃描] 開始索引 ${values.all ? "所有歷史" : `最近 ${values.days} 天`} Session 檔案...`);
    const scanResult = values.all
      ? indexer.indexAll()
      : indexer.indexRecent(parseInt(values.days || "7", 10));
    console.log(`[完成] 掃描 ${scanResult.filesScanned} 個檔案，新增索引 ${scanResult.recordsInserted} 筆紀錄 (耗時 ${scanResult.durationMs}ms)`);
    database.close();
    return;
  }

  // 9. 查詢消耗流水帳歷史紀錄
  if (commandName === "history") {
    const { values } = parseArgs({
      args: argumentList.slice(1),
      options: {
        limit: { type: "string", short: "l", default: "25" },
        model: { type: "string", short: "m" },
        role: { type: "string", short: "r" },
        since: { type: "string", short: "s" },
        json: { type: "boolean", default: false },
        csv: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const database = new HistoryDatabase();
    await database.init();

    // 預先輕量掃描以確保最新資料
    const indexer = new SessionIndexer(database);
    indexer.indexRecent(1);

    const limit = parseInt(values.limit || "25", 10);
    let sinceTimestampMs: number | undefined;

    if (values.since) {
      if (values.since.endsWith("h")) {
        const hours = parseFloat(values.since);
        sinceTimestampMs = Date.now() - hours * 3600 * 1000;
      } else if (values.since.endsWith("d")) {
        const days = parseFloat(values.since);
        sinceTimestampMs = Date.now() - days * 86400 * 1000;
      } else {
        sinceTimestampMs = new Date(values.since).getTime();
      }
    }

    const { total, records } = database.queryRecords({
      limit,
      model: values.model,
      agentRole: values.role,
      sinceMs: sinceTimestampMs,
    });

    if (values.json) {
      console.log(JSON.stringify({ total, records }, null, 2));
      database.close();
      return;
    }

    if (values.csv) {
      const headers = ["時間", "模型", "角色", "總Token", "輸入Token", "快取Token", "輸出Token", "推理Token", "等值金額(USD)", "週配額快照", "SessionID"];
      console.log(headers.join(","));
      for (const record of records) {
        console.log([
          `"${record.datetime}"`,
          `"${record.model}"`,
          `"${record.agentRole || "main"}"`,
          record.totalTokens,
          record.inputTokens,
          record.cachedInputTokens,
          record.outputTokens,
          record.reasoningOutputTokens,
          record.costUsd?.toFixed(4) ?? "0.0000",
          record.weeklyUsedPercent ?? record.weeklyUsedPct ?? "",
          `"${record.sessionId}"`,
        ].join(","));
      }
      database.close();
      return;
    }

    console.log(`[查詢] 總共有 ${total} 筆紀錄 (顯示最新 ${records.length} 筆):`);
    console.log(renderRecentRecords(records, limit));
    database.close();
    return;
  }

  // 10. 預設命令: status 顯示即時概覽
  {
    const { values } = parseArgs({
      args: argumentList.filter((arg) => arg !== "status"),
      options: {
        force: { type: "boolean", short: "f", default: false },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const database = new HistoryDatabase();
    await database.init();
    const quotaClient = new QuotaClient(undefined, database);

    // 增量掃描最新紀錄
    const sessionIndexer = new SessionIndexer(database);
    sessionIndexer.indexRecent(2);

    const quotaSnapshot = await quotaClient.getQuotaSnapshot(values.force === true);

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todaySummary = database.getSummary(todayMidnight.getTime());
    const { records: recentRecords } = database.queryRecords({ limit: 8 });

    if (values.json) {
      console.log(JSON.stringify({ snapshot: quotaSnapshot, todaySummary, recentRecords }, null, 2));
      database.close();
      return;
    }

    console.log(renderQuotaStatus(snapshot));
    console.log("");
    console.log(renderUsageSummary(summary, "本日 Token 消耗統計 (從 00:00 起算)"));
    console.log("");
    console.log(renderRecentRecords(records, 8));
    console.log(`\n提示: 執行 'codex-usage hud' 可跳出置頂懸浮列邊用邊看，'codex-usage report' 可查看多週期結算，'codex-usage serve' 可開啟 Web 儀表板。`);
    database.close();
  }
}

main().catch((runtimeError) => {
  console.error(`[未處理錯誤]: ${runtimeError.message}`);
  process.exit(1);
});
