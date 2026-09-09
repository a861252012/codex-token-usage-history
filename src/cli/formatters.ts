import type { QuotaSnapshot, UsageSummary, TokenRecord, QuotaWindow } from "../core/types.js";
import { QuotaClient } from "../core/quota-client.js";

// ANSI 終端機顏色常數
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

export function colorPercent(pct: number): string {
  if (pct >= 90) return RED;
  if (pct >= 70) return YELLOW;
  return GREEN;
}

export function formatNumber(n: number): string {
  return (n || 0).toLocaleString("en-US");
}

export function renderProgressBar(usedPercent: number, length = 20): string {
  const safeUsed = Math.max(0, Math.min(100, Math.round(usedPercent)));
  const filledLength = Math.round((safeUsed / 100) * length);
  const emptyLength = Math.max(0, length - filledLength);

  const filledBar = "█".repeat(filledLength);
  const emptyBar = "░".repeat(emptyLength);
  const color = colorPercent(safeUsed);

  return `[${color}${filledBar}${RESET}${DIM}${emptyBar}${RESET}] ${BOLD}${safeUsed}% 已用${RESET} (剩餘 ${100 - safeUsed}%)`;
}

export function renderWindowLine(title: string, win: QuotaWindow | null): string {
  if (!win) {
    return `  ${title.padEnd(14)}: ${DIM}未提供此窗口限制${RESET}`;
  }
  const bar = renderProgressBar(win.usedPercent, 20);

  // 動態依當前時間計算剩餘倒數秒數
  const diffSec = Math.max(0, Math.round((win.resetAtMs - Date.now()) / 1000));
  const dynamicCountdown = QuotaClient.formatCountdown(diffSec);
  const countdown = `${CYAN}重設倒數: ${dynamicCountdown}${RESET}`;

  return `  ${BOLD}${title.padEnd(14)}${RESET}: ${bar} | ${countdown}`;
}

export function renderQuotaStatus(snapshot: QuotaSnapshot): string {
  const lines: string[] = [];
  const divider = "=".repeat(78);

  lines.push(`${CYAN}${divider}${RESET}`);
  lines.push(`${BOLD}Codex 即時配額狀態監控${RESET} (來源: ${snapshot.source === "wham" ? "官方 API" : "本機快取"})`);
  lines.push(`${CYAN}${divider}${RESET}`);

  if (snapshot.email) {
    lines.push(`  帳號身份      : ${BOLD}${snapshot.email}${RESET} (方案: ${snapshot.planType || "一般"})`);
  } else {
    lines.push(`  方案狀態      : ${snapshot.planType || "已連線"}`);
  }

  lines.push("");
  lines.push(renderWindowLine("五小時配額", snapshot.fiveHour));
  lines.push(renderWindowLine("週用量配額", snapshot.weekly));

  if (snapshot.additionalLimits.length > 0) {
    for (const add of snapshot.additionalLimits) {
      if (add.primaryWindow) {
        lines.push(renderWindowLine(`${add.limitName} (5h)`, add.primaryWindow));
      }
      if (add.secondaryWindow) {
        lines.push(renderWindowLine(`${add.limitName} (週)`, add.secondaryWindow));
      }
    }
  }

  if (snapshot.resetCredits > 0) {
    lines.push(`  重設信用額度  : ${GREEN}${snapshot.resetCredits} 次可用${RESET}`);
  }

  lines.push(`${CYAN}${divider}${RESET}`);
  return lines.join("\n");
}

export function renderUsageSummary(summary: UsageSummary, title = "近期 Token 消耗統計"): string {
  const lines: string[] = [];
  const divider = "-".repeat(78);

  lines.push(`${BOLD}${title}${RESET}`);
  lines.push(divider);
  lines.push(`  總計請求次數  : ${BOLD}${formatNumber(summary.requests)}${RESET} 次`);
  lines.push(`  總計 Token 消耗: ${BOLD}${CYAN}${formatNumber(summary.totalTokens)}${RESET} tokens`);
  lines.push(`  輸入 / 快取   : ${formatNumber(summary.inputTokens)} / ${DIM}${formatNumber(summary.cachedInputTokens)} (快取)${RESET}`);
  lines.push(`  輸出 / 推理   : ${formatNumber(summary.outputTokens)} / ${DIM}${formatNumber(summary.reasoningOutputTokens)} (推理)${RESET}`);
  lines.push(`  過去1小時燃燒 : ${YELLOW}${formatNumber(summary.hourlyBurnRate)}${RESET} tokens/hr (真實滾動視窗)`);

  if (summary.byModel.length > 0) {
    lines.push("");
    lines.push(`${BOLD}各模型消耗分佈:${RESET}`);

    const header = [
      "模型名稱".padEnd(24),
      "請求數".padStart(8),
      "總 Token 數".padStart(16),
      "輸入 Token".padStart(14),
      "輸出 Token".padStart(12),
    ].join("  ");
    lines.push(`${DIM}${header}${RESET}`);

    for (const m of summary.byModel) {
      const row = [
        m.model.slice(0, 24).padEnd(24),
        formatNumber(m.requests).padStart(8),
        formatNumber(m.totalTokens).padStart(16),
        formatNumber(m.inputTokens).padStart(14),
        formatNumber(m.outputTokens).padStart(12),
      ].join("  ");
      lines.push(row);
    }
  }

  lines.push(divider);
  return lines.join("\n");
}

export function renderRecentRecords(records: TokenRecord[], maxRows = 15): string {
  const lines: string[] = [];
  const divider = "-".repeat(78);

  lines.push(`${BOLD}近期 Token 消耗流水帳紀錄 (最新 ${Math.min(records.length, maxRows)} 筆):${RESET}`);
  lines.push(divider);

  const header = [
    "本地時間 (UTC+8)".padEnd(20),
    "模型".padEnd(20),
    "總 Token".padStart(12),
    "輸入/輸出".padStart(16),
    "週配額".padStart(8),
  ].join("  ");
  lines.push(`${DIM}${header}${RESET}`);

  for (const r of records.slice(0, maxRows)) {
    // 轉換為在地時間字串 (如 2026/09/09 11:25:01)
    const localTimeStr = new Date(r.timestamp).toLocaleString("zh-TW", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const inOut = `${formatNumber(r.inputTokens)}/${formatNumber(r.outputTokens)}`;
    const quotaStr = r.weeklyUsedPct !== null && r.weeklyUsedPct !== undefined
      ? `${r.weeklyUsedPct}%`
      : "-";

    const row = [
      localTimeStr.padEnd(20),
      r.model.slice(0, 20).padEnd(20),
      formatNumber(r.totalTokens).padStart(12),
      inOut.padStart(16),
      quotaStr.padStart(8),
    ].join("  ");
    lines.push(row);
  }

  lines.push(divider);
  return lines.join("\n");
}

export function renderPromptString(snapshot: QuotaSnapshot): string {
  const parts: string[] = [];
  if (snapshot.fiveHour) {
    const rem = snapshot.fiveHour.remainingPercent;
    parts.push(`5h: ${rem}%`);
  }
  if (snapshot.weekly) {
    const rem = snapshot.weekly.remainingPercent;
    parts.push(`7d: ${rem}%`);
  }
  if (parts.length === 0) return "[Codex: 在線]";
  return `[Codex ${parts.join(" | ")}]`;
}
