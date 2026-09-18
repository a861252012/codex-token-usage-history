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

const ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * 剝離 ANSI 控制序列
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * 取得單一 Unicode 碼位的終端機顯示寬度
 * ASCII / 半形字元 = 1，全形字元 / CJK 表意文字 = 2，控制字元 / 組合符號 = 0
 */
export function getCharacterWidth(codePoint: number): number {
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  // 組合標記 / 零寬字元 (Combining marks, Zero Width characters)
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    codePoint === 0x200b ||
    codePoint === 0xfeff
  ) {
    return 0;
  }
  // East Asian Wide / Fullwidth (全形字元與 CJK)
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // 諺文聲母
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK 部首、標點、符號 (含全形空白 0x3000)
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // 平假名、片假名
    (codePoint >= 0x3105 && codePoint <= 0x312f) || // 注音符號
    (codePoint >= 0x3130 && codePoint <= 0x318f) || // 諺文相容字母
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK 擴展 A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK 統一表意文字
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // 彝文
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // 諺文音節
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK 互換表意文字
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // 直排形式
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK 相容形式 (全形標點)
    (codePoint >= 0xff01 && codePoint <= 0xff60) || // 全形 ASCII 變體
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // 全形符號
    (codePoint >= 0x1f300 && codePoint <= 0x1f6ff) || // 表情符號與雜項圖形
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) || // 補充符號與圖形
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)    // CJK 擴展 B~I
  ) {
    return 2;
  }
  return 1;
}

/**
 * 計算字串於終端機中的真實顯示欄寬 (自動排除 ANSI 序列並依 East Asian Width 計量)
 */
export function getStringDisplayWidth(text: string): number {
  const cleanText = stripAnsi(text);
  let totalWidth = 0;
  for (const char of cleanText) {
    const codePoint = char.codePointAt(0) || 0;
    totalWidth += getCharacterWidth(codePoint);
  }
  return totalWidth;
}

/**
 * 依終端機顯示欄寬截斷字串，避免在全形字中間切斷導致顯示錯位
 */
export function truncateDisplay(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let currentWidth = 0;
  let result = "";
  let hasAnsi = false;

  const tokens = text.split(/(\x1b\[[0-9;?]*[ -/]*[@-~])/);
  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith("\x1b[")) {
      hasAnsi = true;
      result += token;
      continue;
    }
    for (const char of token) {
      const codePoint = char.codePointAt(0) || 0;
      const charWidth = getCharacterWidth(codePoint);
      if (currentWidth + charWidth > maxWidth) {
        if (hasAnsi && !result.endsWith(COLOR_RESET)) {
          result += COLOR_RESET;
        }
        return result;
      }
      result += char;
      currentWidth += charWidth;
    }
  }
  return result;
}

/**
 * 右側補白 (Pad End) 至指定顯示欄寬
 */
export function padEndDisplay(text: string, targetWidth: number, padChar = " "): string {
  const currentWidth = getStringDisplayWidth(text);
  if (currentWidth >= targetWidth) return text;
  return text + padChar.repeat(targetWidth - currentWidth);
}

/**
 * 左側補白 (Pad Start) 至指定顯示欄寬
 */
export function padStartDisplay(text: string, targetWidth: number, padChar = " "): string {
  const currentWidth = getStringDisplayWidth(text);
  if (currentWidth >= targetWidth) return text;
  return padChar.repeat(targetWidth - currentWidth) + text;
}

/**
 * 依目標欄寬進行安全截斷與補白，確保輸出精確吻合目標終端機寬度
 */
export function fitDisplay(text: string, targetWidth: number, align: "left" | "right" = "left"): string {
  const truncated = truncateDisplay(text, targetWidth);
  return align === "right"
    ? padStartDisplay(truncated, targetWidth)
    : padEndDisplay(truncated, targetWidth);
}

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
    return `  ${padEndDisplay(title, 14)}: ${STYLE_DIM}無資料（無法判定）${COLOR_RESET}`;
  }
  const progressBar = renderProgressBar(quotaWindow.usedPercent, 20);

  // 動態依當前時間計算剩餘倒數秒數
  const remainingSeconds = Math.max(0, Math.round((quotaWindow.resetAtMs - Date.now()) / 1000));
  const dynamicCountdown = QuotaClient.formatCountdown(remainingSeconds);
  const countdownText = `${COLOR_CYAN}重設倒數: ${dynamicCountdown}${COLOR_RESET}`;

  return `  ${STYLE_BOLD}${padEndDisplay(title, 14)}${COLOR_RESET}: ${progressBar} | ${countdownText}`;
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
    lines.push(`  ${padEndDisplay("連線狀態", 14)}: ${COLOR_YELLOW}離線或尚未登入，無法取得官方配額${COLOR_RESET}`);
  } else if (snapshot.email) {
    lines.push(`  ${padEndDisplay("帳號身份", 14)}: ${STYLE_BOLD}${snapshot.email}${COLOR_RESET} (方案: ${snapshot.planType || "一般"})`);
  } else {
    lines.push(`  ${padEndDisplay("方案狀態", 14)}: ${snapshot.planType || "已連線"}`);
  }
  if (snapshot.source !== "fallback" && snapshot.updatedAt > 0) {
    lines.push(`  ${padEndDisplay("資料更新時間", 14)}: ${new Date(snapshot.updatedAt).toLocaleString("zh-TW", { hour12: false })}`);
  }
  if (snapshot.errorReason) {
    lines.push(`  ${padEndDisplay("取得失敗原因", 14)}: ${COLOR_YELLOW}${snapshot.errorReason}${COLOR_RESET}`);
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
    lines.push(`  ${padEndDisplay("重設信用額度", 14)}: ${COLOR_GREEN}${snapshot.resetCredits} 次可用${COLOR_RESET}`);
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
      fitDisplay("模型名稱", 24),
      padStartDisplay("紀錄數", 8),
      padStartDisplay("總 Token 數", 15),
      padStartDisplay("輸入 Token", 13),
      padStartDisplay("輸出 Token", 11),
      padStartDisplay("等值金額", 10),
    ].join("  ");
    lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

    for (const modelStats of summary.byModel) {
      const costText = `$${modelStats.costUsd.toFixed(2)}`;
      const row = [
        fitDisplay(modelStats.model, 24),
        padStartDisplay(formatNumber(modelStats.requests), 8),
        padStartDisplay(formatNumber(modelStats.totalTokens), 15),
        padStartDisplay(formatNumber(modelStats.inputTokens), 13),
        padStartDisplay(formatNumber(modelStats.outputTokens), 11),
        padStartDisplay(costText, 10),
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
  const divider = "-".repeat(125);

  lines.push(`${STYLE_BOLD}近期 Token 消耗流水帳紀錄 (最新 ${Math.min(records.length, maxRows)} 筆):${COLOR_RESET}`);
  lines.push(divider);

  const header = [
    fitDisplay("本機時間", 20),
    fitDisplay("模型", 18),
    fitDisplay("角色", 8),
    padStartDisplay("總 Token", 11),
    padStartDisplay("輸入/輸出", 15),
    padStartDisplay("金額(USD)", 10),
    fitDisplay("定價來源@版本", 22),
    padStartDisplay("週配額", 7),
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
      fitDisplay(localTimeString, 20),
      fitDisplay(record.model, 18),
      fitDisplay(roleText, 8),
      padStartDisplay(formatNumber(record.totalTokens), 11),
      padStartDisplay(inOutText, 15),
      padStartDisplay(costText, 10),
      fitDisplay(pricingText, 22),
      padStartDisplay(quotaText, 7),
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
  const divider = "=".repeat(140);

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
    fitDisplay("結算週期", 14),
    padStartDisplay("紀錄筆數", 8),
    padStartDisplay("總 Token", 14),
    padStartDisplay("主代理人", 13),
    padStartDisplay("subAgent", 12),
    padStartDisplay("未知角色", 12),
    padStartDisplay("等值金額(USD)", 13),
    fitDisplay("定價來源", 24),
    fitDisplay("主要模型", 16),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);
  lines.push("-".repeat(140));

  for (const settlement of records) {
    const row = [
      fitDisplay(settlement.periodKey, 14),
      padStartDisplay(formatNumber(settlement.requests), 8),
      padStartDisplay(formatNumber(settlement.totalTokens), 14),
      padStartDisplay(formatNumber(settlement.mainAgentTokens), 13),
      padStartDisplay(formatNumber(settlement.subAgentTokens), 12),
      padStartDisplay(formatNumber(settlement.unknownAgentTokens), 12),
      padStartDisplay(settlement.formattedCostUsd, 13),
      fitDisplay(formatPricingProvenance(settlement.pricingProvenance), 24),
      fitDisplay(settlement.topModel, 16),
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
  const divider = "-".repeat(86);

  lines.push(`${STYLE_BOLD}OpenAI 配額重置與重置券變動歷史紀錄 (最新 ${events.length} 筆):${COLOR_RESET}`);
  lines.push(divider);

  if (events.length === 0) {
    lines.push("目前尚無配額重置或重置券變動事件。");
    return lines.join("\n");
  }

  const header = [
    fitDisplay("發生時間 (本機)", 20),
    fitDisplay("事件類型", 16),
    padStartDisplay("可用券數", 8),
    padStartDisplay("券數變動", 8),
    fitDisplay("說明", 26),
  ].join("  ");
  lines.push(`${STYLE_DIM}${header}${COLOR_RESET}`);

  for (const event of events) {
    const deltaText = event.creditDelta > 0 ? `+${event.creditDelta}` : `${event.creditDelta}`;
    const row = [
      fitDisplay(formatLocalTimestamp(event.timestamp), 20),
      fitDisplay(event.eventType, 16),
      padStartDisplay(formatNumber(event.availableCredits), 8),
      padStartDisplay(deltaText, 8),
      fitDisplay(event.description, 26),
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
  const divider = "-".repeat(92);

  lines.push(`${STYLE_BOLD}OpenAI 帳號方案升降級歷程 (Plan Changes):${COLOR_RESET}`);
  lines.push(divider);

  if (events.length === 0) {
    lines.push("目前尚無方案調整紀錄（帳號方案維持現狀）。");
    return lines.join("\n");
  }

  const header = [
    fitDisplay("異動時間 (本機)", 20),
    fitDisplay("變更前方案", 14),
    fitDisplay("變更後方案", 14),
    fitDisplay("異動類型", 16),
    fitDisplay("詳細說明", 22),
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
      fitDisplay(formatLocalTimestamp(event.timestamp), 20),
      fitDisplay(event.previousPlan, 14),
      fitDisplay(event.newPlan, 14),
      fitDisplay(typeColored, 16),
      fitDisplay(event.description, 22),
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
