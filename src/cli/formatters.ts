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
    return `  ${title.padEnd(14)}: ${STYLE_DIM}未配置此視窗限制${COLOR_RESET}`;
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

  const sourceDescription = snapshot.source === "wham"
    ? "官方 API"
    : snapshot.source === "cache"
      ? "本機快取"
      : "離線備援";

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
  if (snapshot.source === "cache" && snapshot.errorReason) {
    lines.push(`  快取提示      : ${COLOR_YELLOW}${snapshot.errorReason}${COLOR_RESET}`);
  }

  lines.push("");
  const isProUser = isProPlanSnapshot(snapshot);

  if (isProUser) {
    lines.push(`  五小時配額    : ${COLOR_GREEN}[Pro 方案無限額度 - 僅依週用量控管]${COLOR_RESET}`);
  } else {
    lines.push(renderWindowLine("五小時配額", snapshot.fiveHour));
  }
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

  if (snapshot.resetCredits > 0) {
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
  lines.push(`  總計請求次數  : ${STYLE_BOLD}${formatNumber(summary.requests)}${COLOR_RESET} 次`);
  lines.push(`  總計 Token 消耗: ${STYLE_BOLD}${COLOR_CYAN}${formatNumber(summary.totalTokens)}${COLOR_RESET} tokens`);
  lines.push(`  輸入 / 快取   : ${formatNumber(summary.inputTokens)} / ${STYLE_DIM}${formatNumber(summary.cachedInputTokens)} (快取)${COLOR_RESET}`);
  lines.push(`  輸出 / 推理   : ${formatNumber(summary.outputTokens)} / ${STYLE_DIM}${formatNumber(summary.reasoningOutputTokens)} (推理)${COLOR_RESET}`);
  lines.push(`  等值美元花費  : ${STYLE_BOLD}${COLOR_GREEN}${summary.formattedCostUsd} USD${COLOR_RESET} (官方 API 定價換算)`);
  lines.push(`  代理人分佈    : 主代理人 ${formatNumber(summary.mainAgentTokens)} / subAgent ${formatNumber(summary.subAgentTokens)} tokens`);
  lines.push(`  過去1小時燃燒 : ${COLOR_YELLOW}${formatNumber(summary.hourlyBurnRate)}${COLOR_RESET} tokens/hr (真實滾動視窗)`);

  if (summary.byModel.length > 0) {
    lines.push("");
    lines.push(`${STYLE_BOLD}各模型消耗分佈:${COLOR_RESET}`);

    const header = [
      "模型名稱".padEnd(24),
      "請求數".padStart(8),
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

export function renderRecentRecords(records: TokenRecord[], maxRows = 15): string {
  const lines: string[] = [];
  const divider = "-".repeat(88);

  lines.push(`${STYLE_BOLD}近期 Token 消耗流水帳紀錄 (最新 ${Math.min(records.length, maxRows)} 筆):${COLOR_RESET}`);
  lines.push(divider);

  const header = [
    "本地時間 (UTC+8)".padEnd(20),
    "模型".padEnd(18),
    "角色".padEnd(8),
    "總 Token".padStart(11),
    "輸入/輸出".padStart(15),
    "金額(USD)".padStart(10),
    "週配額".padStart(7),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

  for (const record of records.slice(0, maxRows)) {
    const localTimeString = new Date(record.timestamp).toLocaleString("zh-TW", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const inOutText = `${formatNumber(record.inputTokens)}/${formatNumber(record.outputTokens)}`;
    const quotaText = record.weeklyUsedPercent !== null && record.weeklyUsedPercent !== undefined
      ? `${record.weeklyUsedPercent}%`
      : record.weeklyUsedPct !== null && record.weeklyUsedPct !== undefined
      ? `${record.weeklyUsedPct}%`
      : "-";

    const costText = record.costUsd ? `$${record.costUsd.toFixed(3)}` : "$0.000";
    const roleText = record.agentRole || "main";

    const row = [
      localTimeString.padEnd(20),
      record.model.slice(0, 18).padEnd(18),
      roleText.slice(0, 8).padEnd(8),
      formatNumber(record.totalTokens).padStart(11),
      inOutText.padStart(15),
      costText.padStart(10),
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
  const divider = "=".repeat(92);

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
    "請求次數".padStart(8),
    "總 Token".padStart(14),
    "主代理人".padStart(13),
    "subAgent".padStart(12),
    "等值金額(USD)".padStart(13),
    "主要模型".padEnd(16),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);
  lines.push("-".repeat(92));

  for (const settlement of records) {
    const row = [
      settlement.periodKey.padEnd(14),
      formatNumber(settlement.requests).padStart(8),
      formatNumber(settlement.totalTokens).padStart(14),
      formatNumber(settlement.mainAgentTokens).padStart(13),
      formatNumber(settlement.subAgentTokens).padStart(12),
      settlement.formattedCostUsd.padStart(13),
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
    "發生時間 (UTC+8)".padEnd(20),
    "事件類型".padEnd(16),
    "可用券數".padStart(8),
    "券數變動".padStart(8),
    "說明".padEnd(26),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

  for (const event of events) {
    const deltaText = event.creditDelta > 0 ? `+${event.creditDelta}` : `${event.creditDelta}`;
    const row = [
      event.datetime.replace("T", " ").slice(0, 19).padEnd(20),
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
    "異動時間 (UTC+8)".padEnd(20),
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
      event.datetime.replace("T", " ").slice(0, 19).padEnd(20),
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
  const isProUser = isProPlanSnapshot(snapshot);

  if (snapshot.source === "fallback") {
    return "[Codex: 離線]";
  }
  if (!isProUser && snapshot.fiveHour) {
    const remainingPercent = snapshot.fiveHour.remainingPercent;
    parts.push(`5h: ${remainingPercent}%`);
  }
  if (snapshot.weekly) {
    const remainingPercent = snapshot.weekly.remainingPercent;
    parts.push(`7d: ${remainingPercent}%`);
  }
  if (parts.length === 0) return "[Codex: 線上]";
  return `[Codex ${parts.join(" | ")}]`;
}

function isProPlanSnapshot(snapshot: QuotaSnapshot): boolean {
  if (snapshot.source === "fallback") {
    return false;
  }

  const snapshotWithOptionalProTier = snapshot as QuotaSnapshot & { proTier?: boolean };
  if (typeof snapshotWithOptionalProTier.proTier === "boolean") {
    return snapshotWithOptionalProTier.proTier;
  }

  const planTypeNormalized = (snapshot.planType || "").toLowerCase();
  if (!planTypeNormalized) {
    return false;
  }

  return planTypeNormalized === "pro"
    || planTypeNormalized === "prolite"
    || planTypeNormalized.startsWith("pro")
    || planTypeNormalized.startsWith("prolite");
}
