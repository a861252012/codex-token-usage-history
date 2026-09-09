#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";
import { runLiveMonitor } from "./live-monitor.js";
import { DashboardServer } from "../server/app.js";
import { runMcpServer } from "../mcp/server.js";
import {
  getActivePricingConfig,
  getEffectiveCatalogOverview,
  getUserPricingFilePath,
} from "../core/pricing-calculator.js";
import {
  syncPricingFromUpstream,
  triggerBackgroundPricingSync,
  getPricingCacheFilePath,
} from "../core/pricing-sync.js";
import {
  renderQuotaStatus,
  renderUsageSummary,
  renderRecentRecords,
  renderSettlementTable,
  renderResetEventsTable,
  renderPlanChangeEventsTable,
  renderPromptString,
} from "./formatters.js";

const MAXIMUM_RECORD_LIMIT = 10000;

function parseIntegerOrDefault(rawValue: string | undefined, defaultValue: number): number {
  const parsedValue = parseInt(rawValue ?? String(defaultValue), 10);
  if (Number.isNaN(parsedValue)) {
    return defaultValue;
  }
  return parsedValue;
}

function parseCappedLimit(rawValue: string | undefined, defaultValue: number): number {
  const parsedValue = parseIntegerOrDefault(rawValue, defaultValue);
  if (parsedValue < 0) {
    return defaultValue;
  }
  if (parsedValue > MAXIMUM_RECORD_LIMIT) {
    return MAXIMUM_RECORD_LIMIT;
  }
  return parsedValue;
}

function escapeCsvField(fieldValue: string | number | null | undefined): string {
  if (fieldValue === null || fieldValue === undefined) return "";
  // Prevent spreadsheet programs from evaluating session-controlled values as formulas.
  const rawContent = String(fieldValue);
  const stringContent = typeof fieldValue === "string" && /^[\t\r\n ]*[=+\-@]/.test(rawContent)
    ? `'${rawContent}`
    : rawContent;
  if (stringContent.includes(",") || stringContent.includes("\"") || stringContent.includes("\n") || stringContent.includes("\r")) {
    return `"${stringContent.replace(/"/g, "\"\"")}"`;
  }
  return stringContent;
}

function shouldPrintHelp(argumentList: string[], commandName: string): boolean {
  if (commandName === "help") {
    return true;
  }
  if (argumentList[0] === "--help" || argumentList[0] === "-h") {
    return true;
  }
  if (commandName === "status") {
    for (const argument of argumentList) {
      if (argument === "--help" || argument === "-h") {
        return true;
      }
    }
  }
  return false;
}

function printHelpText(): void {
  console.log("Codex Token 用量歷史");
  console.log("");
  console.log("用法: codex-usage [命令] [選項]");
  console.log("");
  console.log("可用命令:");
  console.log("  status      顯示即時配額與本日消耗概覽（預設）");
  console.log("  live        終端機即時動態監控");
  console.log("  hud         啟動原生置頂懸浮列");
  console.log("  dashboard   啟動 Web 即時儀表板");
  console.log("  report      多週期結算報表");
  console.log("  resets      配額重置與重置券歷史");
  console.log("  plans       帳號方案變更歷程");
  console.log("  history     消耗流水帳歷史紀錄");
  console.log("  index       掃描並索引 Session 檔案");
  console.log("  pricing     顯示或同步模型定價");
  console.log("  reprice     依最新定價重算歷史金額");
  console.log("  prompt      輸出供 Shell Prompt 使用的狀態字串");
  console.log("  mcp         啟動 MCP 伺服器");
  console.log("");
  console.log("使用 codex-usage --help 或 -h 顯示此說明。");
}

async function main(): Promise<void> {
  const argumentList = process.argv.slice(2);
  const commandName = argumentList[0] && !argumentList[0].startsWith("-") ? argumentList[0] : "status";

  if (shouldPrintHelp(argumentList, commandName)) {
    printHelpText();
    return;
  }

  // 背景靜默檢查遠端開源定價庫 (非阻塞，不影響前景效能)
  if (commandName !== "mcp" && commandName !== "pricing") {
    triggerBackgroundPricingSync();
  }

  // 1. 即時終端機動態監控 (TUI)
  if (commandName === "live" || commandName === "watch") {
    await runLiveMonitor();
    return;
  }

  // 2. 原生置頂懸浮膠囊列 (Always-on-Top Floating HUD)
  if (commandName === "hud" || commandName === "bar" || commandName === "pet") {
    const hudExecutablePath = fileURLToPath(new URL("../../bin/codex-hud", import.meta.url));
    if (!existsSync(hudExecutablePath)) {
      console.error("[錯誤] 找不到置頂懸浮列執行檔 bin/codex-hud，請先執行 scripts/build-hud.sh 進行編譯。");
      process.exitCode = 1;
      return;
    }
    const hudProcess = spawn(hudExecutablePath, [], { detached: true, stdio: "ignore" });
    hudProcess.once("error", (executionError) => {
      console.error(`[錯誤] 無法啟動置頂懸浮列: ${executionError.message}`);
    });
    hudProcess.unref();
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
    const limitCount = parseCappedLimit(values.limit, 14);

    const database = new HistoryDatabase();
    await database.init();

    // 增量掃描最新紀錄
    const indexer = new SessionIndexer(database);
    indexer.indexRecent(3);

    const settlementRecords = database.getSettlementRecords(periodType, limitCount);
    const planChangeEvents = database.getPlanChangeEvents(10);

    if (values.json) {
      console.log(JSON.stringify({ settlements: settlementRecords, planChanges: planChangeEvents }, null, 2));
      database.close();
      return;
    }

    console.log(renderSettlementTable(settlementRecords, periodType));
    if (planChangeEvents.length > 0) {
      console.log();
      console.log(renderPlanChangeEventsTable(planChangeEvents));
    }
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

    const limitCount = parseIntegerOrDefault(values.limit, 20);
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

  // 6. 查詢 OpenAI 帳號方案變更歷程 (升級/降級)
  if (commandName === "plans" || commandName === "tiers") {
    const { values } = parseArgs({
      args: argumentList.slice(1),
      options: {
        limit: { type: "string", short: "l", default: "20" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const limitCount = parseIntegerOrDefault(values.limit, 20);
    const database = new HistoryDatabase();
    await database.init();

    const planChanges = database.getPlanChangeEvents(limitCount);

    if (values.json) {
      console.log(JSON.stringify(planChanges, null, 2));
      database.close();
      return;
    }

    console.log(renderPlanChangeEventsTable(planChanges));
    database.close();
    return;
  }

  // 7. 依據最新定價設定重新計算歷史消耗紀錄金額 (Reprice)
  if (commandName === "reprice" || commandName === "recalculate-costs") {
    const database = new HistoryDatabase();
    await database.init();
    const config = getActivePricingConfig();
    const sourceDescription = config.pricingSource === "user-config"
      ? "自訂設定檔 (~/.codex/pricing.json)"
      : config.pricingSource === "upstream-cache"
        ? "開源社群快取 (~/.codex/pricing_cache.json)"
        : "內建預設費率";
    console.log(`[計價] 當前定價版本: ${config.pricingVersion} (${sourceDescription})`);
    console.log(`[計價] 開始重新計算歷史消耗紀錄金額...`);
    const count = database.recalculateAllCosts();
    console.log(`[完成] 已成功重新計價 ${count} 筆歷史紀錄。`);
    database.close();
    return;
  }

  // 8. 官方與開源定價庫管理 (Pricing Update / Show)
  if (commandName === "pricing" || commandName === "price") {
    const subAction = argumentList[1]?.toLowerCase();

    if (subAction === "update" || subAction === "sync" || subAction === "pull") {
      console.log("[同步] 正在連線至 LiteLLM 全球開源模型定價資料庫...");
      const result = await syncPricingFromUpstream(true);
      if (result.success) {
        console.log(`[成功] ${result.message}`);
        console.log(`[快取檔案] ${getPricingCacheFilePath()}`);
        console.log(`[提示] 執行 'codex-usage reprice' 可依最新費率批次更新歷史資料庫。`);
      } else {
        console.error(`[失敗] ${result.message}`);
      }
      return;
    }

    // 預設行為: 顯示當前生效定價資訊與核心模型費率
    const { pricingVersion, pricingSource, summary } = getActivePricingConfig();
    const overviewList = getEffectiveCatalogOverview();

    console.log("==================================================================================");
    console.log(`  OpenAI 模型等值 API 定價決策總覽 (版本: ${pricingVersion})`);
    console.log("==================================================================================");
    console.log(`  主要來源模式: ${pricingSource}`);
    console.log(`  - 使用者自訂設定: ${getUserPricingFilePath()} (${summary.userConfigCount > 0 ? `已登錄 ${summary.userConfigCount} 項` : "未啟用"})`);
    console.log(`  - 開源社群快取檔: ${getPricingCacheFilePath()} (${summary.upstreamCacheCount > 0 ? `已快取 ${summary.upstreamCacheCount} 個模型` : "未快取"})`);
    console.log(`  - 內建基準模型量: ${summary.builtinCount} 個`);
    console.log("----------------------------------------------------------------------------------");
    console.log("  核心模型當前生效費率 (每 1,000,000 Tokens 美元換算):");
    console.log("  模型前綴                輸入(USD)    快取輸入    輸出(USD)    推論輸出    決策來源");
    console.log("  --------------------------------------------------------------------------------");

    for (const item of overviewList) {
      const namePadded = item.modelPrefix.padEnd(22, " ");
      const inPadded = (`$${item.inputPer1M.toFixed(4)}`).padEnd(12, " ");
      const cachePadded = (`$${item.cachedInputPer1M.toFixed(4)}`).padEnd(12, " ");
      const outPadded = (`$${item.outputPer1M.toFixed(4)}`).padEnd(12, " ");
      const reasonPadded = (`$${item.reasoningOutputPer1M.toFixed(4)}`).padEnd(12, " ");
      const sourceDesc = item.source === "user-config"
        ? "自訂設定"
        : item.source === "upstream-cache"
          ? "社群快取"
          : item.source === "builtin"
            ? "內建標準"
            : "通用備援";

      console.log(`  ${namePadded} ${inPadded} ${cachePadded} ${outPadded} ${reasonPadded} ${sourceDesc}`);
    }

    console.log("----------------------------------------------------------------------------------");
    console.log("  操作提示:");
    console.log("  - 強制同步開源庫: codex-usage pricing update");
    console.log("  - 重新計算歷史值: codex-usage reprice");
    console.log("==================================================================================");
    return;
  }

  // 6. 整合儀表板 (統一匯總命令: 預設啟動 Web 即時儀表板，並支援 --terminal 與 --report 切換)
  if (
    commandName === "dashboard" ||
    commandName === "board" ||
    commandName === "web" ||
    commandName === "ui" ||
    commandName === "serve"
  ) {
    const { values } = parseArgs({
      args: argumentList.slice(1),
      options: {
        port: { type: "string", short: "p", default: "10200" },
        host: { type: "string", short: "h", default: "127.0.0.1" },
        open: { type: "boolean", default: true },
        "no-open": { type: "boolean", default: false },
        terminal: { type: "boolean", short: "t", default: false },
        tui: { type: "boolean", default: false },
        report: { type: "boolean", short: "r", default: false },
        period: { type: "string", default: "daily" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    // 模式 A: 終端機 TUI 即時動態儀表板
    if (values.terminal || values.tui) {
      await runLiveMonitor();
      return;
    }

    // 模式 B: 終端機多週期結算報表儀表板
    if (values.report) {
      const periodType = (values.period || "daily") as "daily" | "weekly" | "monthly" | "yearly";
      const database = new HistoryDatabase();
      await database.init();
      const indexer = new SessionIndexer(database);
      indexer.indexRecent(3);

      const settlementRecords = database.getSettlementRecords(periodType, 14);
      const planChangeEvents = database.getPlanChangeEvents(10);

      if (values.json) {
        console.log(JSON.stringify({ settlements: settlementRecords, planChanges: planChangeEvents }, null, 2));
        database.close();
        return;
      }

      console.log(renderSettlementTable(settlementRecords, periodType));
      if (planChangeEvents.length > 0) {
        console.log();
        console.log(renderPlanChangeEventsTable(planChangeEvents));
      }
      database.close();
      return;
    }

    // 模式 C (預設): 現代化即時 Web 儀表板 (支援 SSE、即時額度、圖表與歷程)
    const port = parseIntegerOrDefault(values.port, 10200);
    const host = values.host || "127.0.0.1";
    const database = new HistoryDatabase();
    const server = new DashboardServer(database, { port, host });

    try {
      const serverUrl = await server.start();
      console.log(`==============================================================================`);
      console.log(`[成功] Codex Token 儀表板已啟動: ${serverUrl}`);
      console.log(`[說明] 支援即時額度監控、24小時消耗圖表、多週期結算與方案歷程`);
      console.log(`[提示] 可透過 'codex-usage dashboard --terminal' 切換至終端機動態儀表板`);
      console.log(`[操作] 按 Ctrl+C 停止伺服器`);
      console.log(`==============================================================================`);

      const shouldOpenBrowser = values.open !== false && values["no-open"] !== true;
      if (shouldOpenBrowser) {
        const browserProcess = spawn("open", [serverUrl], { detached: true, stdio: "ignore" });
        browserProcess.once("error", (executionError) => {
          console.error(`[警告] 無法自動開啟瀏覽器: ${executionError.message}`);
        });
        browserProcess.unref();
      }
    } catch (serverError: any) {
      console.error(`[錯誤] 儀表板啟動失敗: ${serverError.message}`);
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
      : indexer.indexRecent(parseIntegerOrDefault(values.days, 7));
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

    const limit = parseCappedLimit(values.limit, 25);
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
          escapeCsvField(record.datetime),
          escapeCsvField(record.model),
          escapeCsvField(record.agentRole || "main"),
          escapeCsvField(record.totalTokens),
          escapeCsvField(record.inputTokens),
          escapeCsvField(record.cachedInputTokens),
          escapeCsvField(record.outputTokens),
          escapeCsvField(record.reasoningOutputTokens),
          escapeCsvField(record.costUsd?.toFixed(4) ?? "0.0000"),
          escapeCsvField(record.weeklyUsedPercent ?? record.weeklyUsedPct ?? ""),
          escapeCsvField(record.sessionId),
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

    console.log(renderQuotaStatus(quotaSnapshot));
    console.log("");
    console.log(renderUsageSummary(todaySummary, "本日 Token 消耗統計 (從 00:00 起算)"));
    console.log("");
    console.log(renderRecentRecords(recentRecords, 8));
    console.log(`\n提示: 執行 'codex-usage dashboard' 可開啟完整儀表板，'codex-usage hud' 可跳出置頂懸浮球邊用邊看。`);
    database.close();
  }
}

main().catch((runtimeError) => {
  console.error(`[未處理錯誤]: ${runtimeError.message}`);
  process.exit(1);
});
