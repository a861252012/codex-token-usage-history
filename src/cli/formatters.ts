import type {
  QuotaSnapshot,
  UsageSummary,
  TokenRecord,
  QuotaWindow,
  SettlementRecord,
  QuotaResetEvent,
  PlanChangeEvent,
} from "../core/types.js";
import { QuotaClient } from "../core/quota-client.js";

// ANSI 終端機色彩常數
const COLOR_RESET = "\x1b[0m";
const STYLE_BOLD = "\x1b[1m";
const STYLE_DIM = "\x1b[2m";
const COLOR_GREEN = "\x1b[32m";
const COLOR_YELLOW = "\x1b[33m";
const COLOR_RED = "\x1b[31m";
const COLOR_CYAN = "\x1b[36m";
const QUOTA_FRESHNESS_MS = 2 * 60 * 1000;

function isQuotaSnapshotFresh(snapshot: QuotaSnapshot): boolean {
  const ageMs = Date.now() - snapshot.updatedAt;
  return snapshot.source !== "fallback"
    && Number.isFinite(snapshot.updatedAt)
    && snapshot.updatedAt > 0
    && ageMs >= 0
    && ageMs <= QUOTA_FRESHNESS_MS
    && !snapshot.errorReason;
}

function formatPricingProvenance(
  entries: Array<{ source: string; version: string; records: number }>
): string {
  if (entries.length === 0) return "無紀錄";
  const prefix = entries.length > 1 ? "mixed: " : "";
  return prefix + entries
    .map((entry) => `${entry.source}@${entry.version} (${formatNumber(entry.records)} 筆)`)
    .join(", ");
}

export function getColorForPercent(usedPercent: number): string {
  if (usedPercent >= 90) return COLOR_RED;
  if (usedPercent >= 70) return COLOR_YELLOW;
  return COLOR_GREEN;
}

export function formatNumber(value: number): string {
  return (value || 0).toLocaleString("en-US");
}

export function renderProgressBar(usedPercent: number, barLength = 20): string {
  const safeUsedPercent = Math.max(0, Math.min(100, Math.round(usedPercent)));
  const filledLength = Math.round((safeUsedPercent / 100) * barLength);
  const emptyLength = Math.max(0, barLength - filledLength);

  const filledBar = "█".repeat(filledLength);
  const emptyBar = "░".repeat(emptyLength);
  const statusColor = getColorForPercent(safeUsedPercent);

  return `[${statusColor}${filledBar}${COLOR_RESET}${STYLE_DIM}${emptyBar}${COLOR_RESET}] ${STYLE_BOLD}${safeUsedPercent}% 已用${COLOR_RESET} (剩餘 ${100 - safeUsedPercent}%)`;
}

export function renderWindowLine(title: string, quotaWindow: QuotaWindow | null): string {
  if (!quotaWindow) {
    return `  ${title.padEnd(14)}: ${STYLE_DIM}無資料（無法判定）${COLOR_RESET}`;
  }
  const progressBar = renderProgressBar(quotaWindow.usedPercent, 20);

  // 動態依當前時間計算剩餘倒數秒數
  const remainingSeconds = Math.max(0, Math.round((quotaWindow.resetAtMs - Date.now()) / 1000));
  const dynamicCountdown = QuotaClient.formatCountdown(remainingSeconds);
  const countdownText = `${COLOR_CYAN}重設倒數: ${dynamicCountdown}${COLOR_RESET}`;

  return `  ${STYLE_BOLD}${title.padEnd(14)}${COLOR_RESET}: ${progressBar} | ${countdownText}`;
}

export function renderQuotaStatus(snapshot: QuotaSnapshot): string {
  const lines: string[] = [];
  const divider = "=".repeat(78);

  const isFresh = isQuotaSnapshotFresh(snapshot);
  const sourceDescription = snapshot.source === "wham"
    ? isFresh ? "官方 API（即時）" : "官方 API（已過期）"
    : snapshot.source === "cache"
      ? isFresh ? "本機快取（2 分鐘內）" : "本機快取（已過期）"
      : "無可用資料";

  lines.push(`${COLOR_CYAN}${divider}${COLOR_RESET}`);
  lines.push(`${STYLE_BOLD}Codex 即時配額狀態監控${COLOR_RESET} (來源: ${sourceDescription})`);
  lines.push(`${COLOR_CYAN}${divider}${COLOR_RESET}`);

  if (snapshot.source === "fallback") {
    lines.push(`  連線狀態      : ${COLOR_YELLOW}離線或尚未登入，無法取得官方配額${COLOR_RESET}`);
  } else if (snapshot.email) {
    lines.push(`  帳號身份      : ${STYLE_BOLD}${snapshot.email}${COLOR_RESET} (方案: ${snapshot.planType || "一般"})`);
  } else {
    lines.push(`  方案狀態      : ${snapshot.planType || "已連線"}`);
  }
  if (snapshot.source !== "fallback" && snapshot.updatedAt > 0) {
    lines.push(`  資料更新時間  : ${new Date(snapshot.updatedAt).toLocaleString("zh-TW", { hour12: false })}`);
  }
  if (snapshot.errorReason) {
    lines.push(`  取得失敗原因  : ${COLOR_YELLOW}${snapshot.errorReason}${COLOR_RESET}`);
  }

  lines.push("");
  lines.push(renderWindowLine("五小時配額", snapshot.fiveHour));
  lines.push(renderWindowLine("週用量配額", snapshot.weekly));

  if (snapshot.additionalLimits.length > 0) {
    for (const additionalLimit of snapshot.additionalLimits) {
      if (additionalLimit.primaryWindow) {
        lines.push(renderWindowLine(`${additionalLimit.limitName} (5h)`, additionalLimit.primaryWindow));
      }
      if (additionalLimit.secondaryWindow) {
        lines.push(renderWindowLine(`${additionalLimit.limitName} (週)`, additionalLimit.secondaryWindow));
      }
    }
  }

  if (snapshot.resetCreditsKnown === true && snapshot.resetCredits > 0) {
    lines.push(`  重設信用額度  : ${COLOR_GREEN}${snapshot.resetCredits} 次可用${COLOR_RESET}`);
  }

  lines.push(`${COLOR_CYAN}${divider}${COLOR_RESET}`);
  return lines.join("\n");
}

export function renderUsageSummary(summary: UsageSummary, title = "近期 Token 消耗統計"): string {
  const lines: string[] = [];
  const divider = "-".repeat(78);

  lines.push(`${STYLE_BOLD}${title}${COLOR_RESET}`);
  lines.push(divider);
  lines.push(`  Token 紀錄筆數: ${STYLE_BOLD}${formatNumber(summary.requests)}${COLOR_RESET} 筆`);
  lines.push(`  總計 Token 消耗: ${STYLE_BOLD}${COLOR_CYAN}${formatNumber(summary.totalTokens)}${COLOR_RESET} tokens`);
  lines.push(`  輸入 / 快取   : ${formatNumber(summary.inputTokens)} / ${STYLE_DIM}${formatNumber(summary.cachedInputTokens)} (快取)${COLOR_RESET}`);
  lines.push(`  輸出 / 推理   : ${formatNumber(summary.outputTokens)} / ${STYLE_DIM}${formatNumber(summary.reasoningOutputTokens)} (推理)${COLOR_RESET}`);
  lines.push(`  等值美元花費  : ${STYLE_BOLD}${COLOR_GREEN}${summary.formattedCostUsd} USD${COLOR_RESET} (API 定價換算估值)`);
  lines.push(`  定價依據      : ${formatPricingProvenance(summary.pricingProvenance)}`);
  lines.push(`  代理人分佈    : 主代理人 ${formatNumber(summary.mainAgentTokens)} / subAgent ${formatNumber(summary.subAgentTokens)} / 未知 ${formatNumber(summary.unknownAgentTokens)} tokens`);
  lines.push(`  過去1小時燃燒 : ${COLOR_YELLOW}${formatNumber(summary.hourlyBurnRate)}${COLOR_RESET} tokens/hr (真實滾動視窗)`);

  if (summary.byModel.length > 0) {
    lines.push("");
    lines.push(`${STYLE_BOLD}各模型消耗分佈:${COLOR_RESET}`);

    const header = [
      "模型名稱".padEnd(24),
      "紀錄數".padStart(8),
      "總 Token 數".padStart(15),
      "輸入 Token".padStart(13),
      "輸出 Token".padStart(11),
      "等值金額".padStart(10),
    ].join("  ");
    lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

    for (const modelStats of summary.byModel) {
      const costText = `$${modelStats.costUsd.toFixed(2)}`;
      const row = [
        modelStats.model.slice(0, 24).padEnd(24),
        formatNumber(modelStats.requests).padStart(8),
        formatNumber(modelStats.totalTokens).padStart(15),
        formatNumber(modelStats.inputTokens).padStart(13),
        formatNumber(modelStats.outputTokens).padStart(11),
        costText.padStart(10),
      ].join("  ");
      lines.push(row);
    }
  }

  lines.push(divider);
  return lines.join("\n");
}

function formatLocalTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString("sv-SE", { hour12: false });
}

export function renderRecentRecords(records: TokenRecord[], maxRows = 15): string {
  const lines: string[] = [];
  const divider = "-".repeat(114);

  lines.push(`${STYLE_BOLD}近期 Token 消耗流水帳紀錄 (最新 ${Math.min(records.length, maxRows)} 筆):${COLOR_RESET}`);
  lines.push(divider);

  const header = [
    "本機時間".padEnd(20),
    "模型".padEnd(18),
    "角色".padEnd(8),
    "總 Token".padStart(11),
    "輸入/輸出".padStart(15),
    "金額(USD)".padStart(10),
    "定價來源@版本".padEnd(22),
    "週配額".padStart(7),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

  for (const record of records.slice(0, maxRows)) {
    const localTimeString = formatLocalTimestamp(record.timestamp);

    const inOutText = `${formatNumber(record.inputTokens)}/${formatNumber(record.outputTokens)}`;
    const quotaText = record.weeklyUsedPercent !== null && record.weeklyUsedPercent !== undefined
      ? `${record.weeklyUsedPercent}%`
      : record.weeklyUsedPct !== null && record.weeklyUsedPct !== undefined
      ? `${record.weeklyUsedPct}%`
      : "-";

    const costText = record.costUsd ? `$${record.costUsd.toFixed(3)}` : "$0.000";
    const roleText = record.agentRole || "unknown";
    const pricingText = `${record.pricingSource || "unknown"}@${record.pricingVersion || "unknown"}`;

    const row = [
      localTimeString.padEnd(20),
      record.model.slice(0, 18).padEnd(18),
      roleText.slice(0, 8).padEnd(8),
      formatNumber(record.totalTokens).padStart(11),
      inOutText.padStart(15),
      costText.padStart(10),
      pricingText.slice(0, 22).padEnd(22),
      quotaText.padStart(7),
    ].join("  ");
    lines.push(row);
  }

  lines.push(divider);
  return lines.join("\n");
}

/**
 * 渲染多週期結算報表表格 (每日、每週、每月、每年)
 */
export function renderSettlementTable(records: SettlementRecord[], periodType: string): string {
  const lines: string[] = [];
  const divider = "=".repeat(132);

  const periodTitleMap: Record<string, string> = {
    daily: "每日結算報表 (Daily)",
    weekly: "每週結算報表 (Weekly)",
    monthly: "每月結算報表 (Monthly)",
    yearly: "每年結算報表 (Yearly)",
  };

  const tableTitle = periodTitleMap[periodType] || "多週期結算報表";

  lines.push(`${COLOR_CYAN}${divider}${COLOR_RESET}`);
  lines.push(`${STYLE_BOLD}${tableTitle}${COLOR_RESET}`);
  lines.push(`${COLOR_CYAN}${divider}${COLOR_RESET}`);

  if (records.length === 0) {
    lines.push("查無結算資料。");
    return lines.join("\n");
  }

  const header = [
    "結算週期".padEnd(14),
    "紀錄筆數".padStart(8),
    "總 Token".padStart(14),
    "主代理人".padStart(13),
    "subAgent".padStart(12),
    "未知角色".padStart(12),
    "等值金額(USD)".padStart(13),
    "定價來源".padEnd(24),
    "主要模型".padEnd(16),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);
  lines.push("-".repeat(132));

  for (const settlement of records) {
    const row = [
      settlement.periodKey.padEnd(14),
      formatNumber(settlement.requests).padStart(8),
      formatNumber(settlement.totalTokens).padStart(14),
      formatNumber(settlement.mainAgentTokens).padStart(13),
      formatNumber(settlement.subAgentTokens).padStart(12),
      formatNumber(settlement.unknownAgentTokens).padStart(12),
      settlement.formattedCostUsd.padStart(13),
      formatPricingProvenance(settlement.pricingProvenance).slice(0, 24).padEnd(24),
      settlement.topModel.slice(0, 16).padEnd(16),
    ].join("  ");
    lines.push(row);
  }

  lines.push(`${COLOR_CYAN}${divider}${COLOR_RESET}`);
  return lines.join("\n");
}

/**
 * 渲染 OpenAI 配額重置事件與重置券變動歷史
 */
export function renderResetEventsTable(events: QuotaResetEvent[]): string {
  const lines: string[] = [];
  const divider = "-".repeat(84);

  lines.push(`${STYLE_BOLD}OpenAI 配額重置與重置券變動歷史紀錄 (最新 ${events.length} 筆):${COLOR_RESET}`);
  lines.push(divider);

  if (events.length === 0) {
    lines.push("目前尚無配額重置或重置券變動事件。");
    return lines.join("\n");
  }

  const header = [
    "發生時間 (本機)".padEnd(20),
    "事件類型".padEnd(16),
    "可用券數".padStart(8),
    "券數變動".padStart(8),
    "說明".padEnd(26),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

  for (const event of events) {
    const deltaText = event.creditDelta > 0 ? `+${event.creditDelta}` : `${event.creditDelta}`;
    const row = [
      formatLocalTimestamp(event.timestamp).padEnd(20),
      event.eventType.slice(0, 16).padEnd(16),
      formatNumber(event.availableCredits).padStart(8),
      deltaText.padStart(8),
      event.description.slice(0, 26).padEnd(26),
    ].join("  ");
    lines.push(row);
  }

  lines.push(divider);
  return lines.join("\n");
}

/**
 * 渲染 OpenAI 帳號方案調整歷程表格 (升級/降級紀錄)
 */
export function renderPlanChangeEventsTable(events: PlanChangeEvent[]): string {
  const lines: string[] = [];
  const divider = "-".repeat(84);

  lines.push(`${STYLE_BOLD}OpenAI 帳號方案升降級歷程 (Plan Changes):${COLOR_RESET}`);
  lines.push(divider);

  if (events.length === 0) {
    lines.push("目前尚無方案調整紀錄（帳號方案維持現狀）。");
    return lines.join("\n");
  }

  const header = [
    "異動時間 (本機)".padEnd(20),
    "變更前方案".padEnd(14),
    "變更後方案".padEnd(14),
    "異動類型".padEnd(12),
    "詳細說明".padEnd(22),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

  for (const event of events) {
    let typeColored: string = event.changeType;
    if (event.changeType === "upgrade") {
      typeColored = `${COLOR_GREEN}升級 (Upgrade)${COLOR_RESET}`;
    } else if (event.changeType === "downgrade") {
      typeColored = `${COLOR_RED}降級 (Downgrade)${COLOR_RESET}`;
    } else {
      typeColored = "方案變更";
    }

    const row = [
      formatLocalTimestamp(event.timestamp).padEnd(20),
      event.previousPlan.padEnd(14),
      event.newPlan.padEnd(14),
      typeColored.padEnd(21),
      event.description.slice(0, 22).padEnd(22),
    ].join("  ");
    lines.push(row);
  }

  lines.push(divider);
  return lines.join("\n");
}

export function renderPromptString(snapshot: QuotaSnapshot): string {
  const parts: string[] = [];

  if (snapshot.source === "fallback") {
    return "[Codex: 配額無法取得]";
  }
  if (!isQuotaSnapshotFresh(snapshot)) {
    return "[Codex: 配額已過期]";
  }
  if (snapshot.fiveHour) {
    const remainingPercent = snapshot.fiveHour.remainingPercent;
    parts.push(`5h: ${remainingPercent}%`);
  } else {
    parts.push("5h: ?");
  }
  if (snapshot.weekly) {
    const remainingPercent = snapshot.weekly.remainingPercent;
    parts.push(`7d: ${remainingPercent}%`);
  } else {
    parts.push("7d: ?");
  }
  const sourceLabel = snapshot.source === "cache" ? "快取 | " : "";
  return `[Codex ${sourceLabel}${parts.join(" | ")}]`;
}
