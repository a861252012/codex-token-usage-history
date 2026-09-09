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
  renderPromptString,
} from "./formatters.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "status";

  // 1. 即時終端機監控 (TUI)
  if (command === "live" || command === "watch") {
    await runLiveMonitor();
    return;
  }

  // 2. MCP 伺服器 (供 Codex APP 與 CLI 呼叫)
  if (command === "mcp") {
    await runMcpServer();
    return;
  }

  // 3. 啟動 Web 儀表板與 API 伺服器
  if (command === "serve") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        port: { type: "string", short: "p", default: "10200" },
        host: { type: "string", short: "h", default: "127.0.0.1" },
        open: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const port = parseInt(values.port || "10200", 10);
    const host = values.host || "127.0.0.1";
    const db = new HistoryDatabase();
    const server = new DashboardServer(db, { port, host });

    try {
      const url = await server.start();
      console.log(`==============================================================================`);
      console.log(`[成功] Codex Token 歷史與配額儀表板已啟動: ${url}`);
      console.log(`[說明] 支援 Server-Sent Events 即時推送，請在瀏覽器中檢視即時狀態與圖表`);
      console.log(`[操作] 按 Ctrl+C 停止伺服器`);
      console.log(`==============================================================================`);

      if (values.open) {
        exec(`open "${url}"`);
      }
    } catch (err: any) {
      console.error(`[錯誤] 伺服器啟動失敗: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // 4. Shell Prompt 狀態字串 (供 zsh/bash 整合)
  if (command === "prompt") {
    const quotaClient = new QuotaClient();
    const snap = await quotaClient.getQuotaSnapshot(false);
    console.log(renderPromptString(snap));
    return;
  }

  // 5. 手動掃描與增量索引
  if (command === "index") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        all: { type: "boolean", short: "a", default: false },
        days: { type: "string", short: "d", default: "7" },
      },
    });

    const db = new HistoryDatabase();
    await db.init();
    const indexer = new SessionIndexer(db);

    console.log(`[掃描] 開始索引 ${values.all ? "所有歷史" : `最近 ${values.days} 天`} Session 檔案...`);
    const res = values.all ? indexer.indexAll() : indexer.indexRecent(parseInt(values.days || "7", 10));
    console.log(`[完成] 掃描 ${res.filesScanned} 個檔案，新增索引 ${res.recordsInserted} 筆紀錄 (耗時 ${res.durationMs}ms)`);
    db.close();
    return;
  }

  // 6. 查詢消耗流水帳歷史紀錄
  if (command === "history") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        limit: { type: "string", short: "l", default: "25" },
        model: { type: "string", short: "m" },
        since: { type: "string", short: "s" },
        json: { type: "boolean", default: false },
        csv: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const db = new HistoryDatabase();
    await db.init();

    // 預先輕量掃描以確保最新資料
    const indexer = new SessionIndexer(db);
    indexer.indexRecent(1);

    const limit = parseInt(values.limit || "25", 10);
    let sinceMs: number | undefined;

    if (values.since) {
      if (values.since.endsWith("h")) {
        const hours = parseFloat(values.since);
        sinceMs = Date.now() - hours * 3600 * 1000;
      } else if (values.since.endsWith("d")) {
        const days = parseFloat(values.since);
        sinceMs = Date.now() - days * 86400 * 1000;
      } else {
        sinceMs = new Date(values.since).getTime();
      }
    }

    const { total, records } = db.queryRecords({
      limit,
      model: values.model,
      sinceMs,
    });

    if (values.json) {
      console.log(JSON.stringify({ total, records }, null, 2));
      db.close();
      return;
    }

    if (values.csv) {
      const headers = ["時間", "模型", "總Token", "輸入Token", "快取Token", "輸出Token", "推理Token", "週配額快照", "SessionID"];
      console.log(headers.join(","));
      for (const r of records) {
        console.log([
          `"${r.datetime}"`,
          `"${r.model}"`,
          r.totalTokens,
          r.inputTokens,
          r.cachedInputTokens,
          r.outputTokens,
          r.reasoningOutputTokens,
          r.weeklyUsedPct ?? "",
          `"${r.sessionId}"`,
        ].join(","));
      }
      db.close();
      return;
    }

    console.log(`[查詢] 總共有 ${total} 筆紀錄 (顯示最新 ${records.length} 筆):`);
    console.log(renderRecentRecords(records, limit));
    db.close();
    return;
  }

  // 7. 預設命令: status 顯示即時概覽
  {
    const { values } = parseArgs({
      args: args.filter((a) => a !== "status"),
      options: {
        force: { type: "boolean", short: "f", default: false },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const quotaClient = new QuotaClient();
    const db = new HistoryDatabase();
    await db.init();

    // 增量掃描最新紀錄
    const indexer = new SessionIndexer(db);
    indexer.indexRecent(2);

    const snapshot = await quotaClient.getQuotaSnapshot(values.force === true);

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const summary = db.getSummary(todayMidnight.getTime());
    const { records } = db.queryRecords({ limit: 8 });

    if (values.json) {
      console.log(JSON.stringify({ snapshot, todaySummary: summary, recentRecords: records }, null, 2));
      db.close();
      return;
    }

    console.log(renderQuotaStatus(snapshot));
    console.log("");
    console.log(renderUsageSummary(summary, "本日 Token 消耗統計 (從 00:00 起算)"));
    console.log("");
    console.log(renderRecentRecords(records, 8));
    console.log(`\n提示: 執行 'codex-usage live' 可開啟即時監控畫面，執行 'codex-usage serve' 可開啟 Web 儀表板。`);
    db.close();
  }
}

main().catch((err) => {
  console.error(`[未處理錯誤]: ${err.message}`);
  process.exit(1);
});
