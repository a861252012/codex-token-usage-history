// Codex Token & Quota Real-Time Monitor Client
let currentLanguage = localStorage.getItem("codex_ui_lang") || "en";
let currentPage = 1;
const pageSize = 25;
let totalHistoryRecords = 0;
let currentFilterModel = "";
let currentFilterAgentRole = "";
let currentSettlementPeriod = "daily";
let lastQuotaSnapshot = null;
let filterDebounceTimer;
let visibleHistoryRecords = [];

function uiText(english, chinese) { return currentLanguage === "zh-TW" ? chinese : english; }

function showFeedback(message, tone = "success") {
  const feedback = document.getElementById("request-feedback");
  feedback.textContent = message;
  feedback.dataset.tone = tone;
  feedback.hidden = false;
}

// Requests to the same resource supersede older filters; every request has a deadline.
const resourceRequests = new Map();
async function dashboardFetch(url) {
  const key = url.split("?")[0];
  resourceRequests.get(key)?.abort();
  const controller = new AbortController();
  resourceRequests.set(key, controller);
  const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (resourceRequests.get(key) !== controller) throw new DOMException("Superseded", "AbortError");
    return { json: async () => data, ok: true };
  } finally {
    clearTimeout(timeout);
    if (resourceRequests.get(key) === controller) resourceRequests.delete(key);
  }
}

function resetFilters() {
  clearTimeout(filterDebounceTimer);
  currentFilterModel = "";
  currentFilterAgentRole = "";
  currentPage = 1;
  document.getElementById("filter-model").value = "";
  document.getElementById("filter-agent-role").value = "";
  return fetchHistory();
}

// Shared by all data panels: local skeletons, retry actions and request coalescing.
function withRequestFeedback(task, { table, columns, buttons = [] } = {}) {
  let pending;
  let signature;
  let version = 0;
  return (...args) => {
    const nextSignature = JSON.stringify([args, currentLanguage, ...(table === "history" ? [currentPage, currentFilterModel, currentFilterAgentRole] : [])]);
    if (pending && signature === nextSignature) return pending;
    signature = nextSignature;
    const ticket = ++version;
    const tbody = table && document.getElementById(`${table}-table-body`);
    const controls = buttons.flatMap((selector) => [...document.querySelectorAll(selector)]);
    controls.forEach((button) => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
    if (tbody) {
      tbody.setAttribute("aria-busy", "true");
      tbody.setAttribute("aria-label", uiText("Loading records", "正在載入紀錄"));
      tbody.innerHTML = Array.from({ length: 4 }, () => `<tr>${'<td><div class="skeleton" aria-hidden="true"></div></td>'.repeat(columns)}</tr>`).join("");
    }
    const renderState = (error) => {
      if (!tbody) return;
      tbody.innerHTML = `<tr><td colspan="${columns}"><div class="empty-state"><strong>${error ? uiText("Unable to load records", "無法載入紀錄") : uiText("No records found", "目前沒有符合的紀錄")}</strong><p>${error ? uiText("Check the local service and try again.", "請確認本機服務正常後重試。") : uiText("Try resetting filters or index your local sessions with: codex-usage index --all", "可重設篩選；若尚未索引，請執行 codex-usage index --all。")}</p><button class="btn btn-secondary">${error ? uiText("Retry", "重新載入") : table === "history" ? uiText("Reset filters", "重設條件") : uiText("Refresh records", "重新查詢")}</button></div></td></tr>`;
      tbody.querySelector("button").onclick = () => !error && table === "history" ? resetFilters() : wrappedRetry();
    };
    const wrappedRetry = () => table === "history" ? fetchHistory() : table === "settlement" ? fetchSettlementReport(currentSettlementPeriod) : table === "resets" ? fetchResetEvents() : fetchPlanChangeEvents();
    pending = task(...args).then(() => {
      if (ticket !== version) return;
      if (tbody?.rows.length === 1 && tbody.rows[0].cells.length === 1) renderState(false);
      return true;
    }).catch((error) => {
      if (ticket !== version || error.name === "AbortError") return false;
      renderState(true);
      showFeedback(uiText("Some data could not be loaded. Please retry.", "部分資料載入失敗，請重新載入。"), "danger");
      return false;
    }).finally(() => {
      if (ticket !== version) return;
      pending = null;
      controls.forEach((button) => { button.disabled = false; button.removeAttribute("aria-busy"); });
      tbody?.removeAttribute("aria-busy");
      tbody?.removeAttribute("aria-label");
      if (table === "history") updatePagination();
    });
    return pending;
  };
}

// Countdown Target Timestamps (ms)
let fiveHourResetTimestamp = 0;
let weeklyResetTimestamp = 0;

// Localization Dictionaries
const i18nDictionary = {
  en: {
    appTitle: "Codex Token & Quota Monitor",
    appSubtitle: "Real-time Dashboard for macOS & Codex",
    refreshBtn: "Refresh",
    cardFiveHour: "5-Hour Quota",
    tagFiveHour: "5-Hour Window",
    resetIn: "Reset In",
    statusLabel: "Status",
    cardWeekly: "Weekly Quota",
    tagWeekly: "7-Day Rolling Window",
    resetCountdown: "Reset Countdown",
    cardToday: "Today's Token Usage",
    tagToday: "Since 00:00",
    todayCost: "API Cost (USD):",
    todayInput: "Input / Cached:",
    todayOutput: "Output / Reasoning:",
    todayAgents: "Agents (Main / Sub):",
    todayRequests: "Total Requests:",
    todayBurn: "Hourly Burn Rate:",
    settlementTitle: "Multi-Period Settlement Report",
    chartTitle: "24-Hour Token Burn Activity",
    chartTag: "Hourly Breakdown",
    modelsTitle: "Token Distribution by Model",
    resetsTitle: "OpenAI Quota Resets & Voucher History",
    plansTitle: "Account Plan Transitions",
    historyTitle: "Token Usage Transaction Log",
    btnDaily: "Daily",
    btnWeekly: "Weekly",
    btnMonthly: "Monthly",
    btnYearly: "Yearly",
    proUnlimitedTitle: "Weekly Window",
    proUnlimitedDesc: "No 5-hour window was returned in this snapshot. Check the weekly quota below.",
    exportCsv: "Export CSV",
    prevPage: "Previous",
    nextPage: "Next",
    allAgents: "All Agents",
    mainAgentOnly: "Main Agent Only",
    subAgentOnly: "subAgent Only",
  },
  "zh-TW": {
    appTitle: "Codex Token 額度與消耗歷史",
    appSubtitle: "MacBook 即時監控儀表板",
    refreshBtn: "立即重新整理",
    cardFiveHour: "五小時短週期額度",
    tagFiveHour: "5小時時間視窗",
    resetIn: "重設倒數",
    statusLabel: "狀態評估",
    cardWeekly: "週用量長週期額度",
    tagWeekly: "7天滾動時間視窗",
    resetCountdown: "重設倒數",
    cardToday: "本日 Token 消耗統計",
    tagToday: "今日累計",
    todayCost: "等值 API 金額:",
    todayInput: "輸入 / 快取:",
    todayOutput: "輸出 / 推理:",
    todayAgents: "代理人分佈 (主/子):",
    todayRequests: "總請求次數:",
    todayBurn: "每小時消耗率:",
    settlementTitle: "Token 消耗多週期結算報表",
    chartTitle: "過去 24 小時 Token 燃燒趨勢",
    chartTag: "每小時分布",
    modelsTitle: "各模型 Token 消耗比例",
    resetsTitle: "OpenAI 配額重置與重置券變動歷史",
    plansTitle: "帳號方案調整歷程 (升級/降級紀錄)",
    historyTitle: "Token 消耗歷史紀錄流水帳",
    btnDaily: "每日結算",
    btnWeekly: "每週結算",
    btnMonthly: "每月結算",
    btnYearly: "每年結算",
    proUnlimitedTitle: "週用量視窗",
    proUnlimitedDesc: "此快照未提供五小時視窗，請參考週用量額度。",
    exportCsv: "匯出 CSV",
    prevPage: "上一頁",
    nextPage: "下一頁",
    allAgents: "全部角色",
    mainAgentOnly: "僅主程式",
    subAgentOnly: "僅 subAgent",
  },
};

function setLanguage(targetLanguage) {
  currentLanguage = targetLanguage;
  localStorage.setItem("codex_ui_lang", targetLanguage);

  document.querySelectorAll(".btn-lang").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-lang") === targetLanguage);
  });

  const texts = i18nDictionary[targetLanguage] || i18nDictionary.en;
  document.documentElement.lang = targetLanguage;

  const updateText = (id, text) => {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  };

  updateText("app-title", texts.appTitle);
  updateText("breadcrumb-current", uiText("Usage overview", "用量總覽"));
  updateText("filter-title", uiText("History filters", "歷史紀錄篩選"));
  updateText("filter-help", uiText("Applies to transaction history and CSV export. Overview cards remain unchanged.", "僅套用至歷史紀錄與 CSV 匯出，不影響總覽卡片與結算報表。"));
  updateText("label-filter-model", uiText("Search model", "即時搜尋模型"));
  updateText("label-filter-role", uiText("Agent role", "代理人角色"));
  updateText("btn-reset-filters", uiText("Reset filters", "重設條件"));
  updateText("link-history", uiText("View history", "查看歷史結果"));
  updateText("th-hist-session", uiText("Actions", "操作"));
  updateText("app-subtitle", texts.appSubtitle);
  updateText("btn-refresh", texts.refreshBtn);
  updateText("label-card-five-hour", texts.cardFiveHour);
  updateText("tag-card-five-hour", texts.tagFiveHour);
  updateText("label-five-hour-reset", texts.resetIn);
  updateText("label-five-hour-status", texts.statusLabel);
  updateText("label-card-weekly", texts.cardWeekly);
  updateText("tag-weekly", texts.tagWeekly);
  updateText("label-weekly-reset", texts.resetCountdown);
  updateText("label-weekly-status", texts.statusLabel);
  updateText("label-card-today", texts.cardToday);
  updateText("tag-card-today", texts.tagToday);
  const costLabel = document.getElementById("label-today-cost");
  if (costLabel) {
    const metaChild = costLabel.querySelector("#pricing-meta") || document.getElementById("pricing-meta");
    costLabel.textContent = (texts.todayCost || "API Cost (USD):") + " ";
    if (metaChild) {
      costLabel.appendChild(metaChild);
    }
  }
  updateText("label-today-input", texts.todayInput);
  updateText("label-today-output", texts.todayOutput);
  updateText("label-today-agents", texts.todayAgents);
  updateText("label-today-requests", texts.todayRequests);
  updateText("label-today-burn", texts.todayBurn);
  updateText("label-settlement-title", texts.settlementTitle);
  updateText("label-chart-title", texts.chartTitle);
  updateText("tag-chart", texts.chartTag);
  updateText("label-models-title", texts.modelsTitle);
  updateText("label-resets-title", texts.resetsTitle);
  updateText("label-plans-title", texts.plansTitle);
  updateText("label-history-title", texts.historyTitle);
  updateText("btn-export-csv", texts.exportCsv);
  updateText("btn-prev-page", texts.prevPage);
  updateText("btn-next-page", texts.nextPage);
  updateText("desc-pro-unlimited", texts.proUnlimitedDesc);
  updateText("title-pro-window", texts.proUnlimitedTitle);
  document.querySelectorAll("#filter-agent-role option").forEach((option) => {
    option.textContent = option.value === "subagent" ? texts.subAgentOnly : option.value === "main" ? texts.mainAgentOnly : texts.allAgents;
  });
  const connectionStatus = document.getElementById("connection-status");
  if (connectionStatus?.classList.contains("connected")) {
    connectionStatus.textContent = targetLanguage === "zh-TW" ? "即時串流連線中" : "Live Stream Connected";
  }
  if (lastQuotaSnapshot) renderQuotaSnapshot(lastQuotaSnapshot);

  const periodButtons = document.querySelectorAll(".btn-period");
  periodButtons.forEach((button) => {
    const period = button.getAttribute("data-period");
    if (period === "daily") button.textContent = texts.btnDaily;
    if (period === "weekly") button.textContent = texts.btnWeekly;
    if (period === "monthly") button.textContent = texts.btnMonthly;
    if (period === "yearly") button.textContent = texts.btnYearly;
  });

  fetchSettlementReport(currentSettlementPeriod);
  fetchHistory();
}

function formatNumber(numericValue) {
  const parsedValue = Number(numericValue || 0);
  return Number.isFinite(parsedValue) ? parsedValue.toLocaleString("en-US") : "0";
}

function escapeHtml(rawValue) {
  if (rawValue === null || rawValue === undefined) return "";
  return String(rawValue)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUsdDisplay(value) {
  if (value === null || value === undefined || value === "") {
    return "$0.00";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "$0.00";
    if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
  }
  const stringValue = String(value).trim();
  if (stringValue.startsWith("$")) return stringValue;
  return `$${stringValue}`;
}

function formatPercentDisplay(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function isProPlanType(planType) {
  const normalizedPlan = String(planType || "").trim().toLowerCase();
  if (!normalizedPlan) return false;
  if (normalizedPlan === "pro" || normalizedPlan === "prolite") return true;
  if (!normalizedPlan.startsWith("pro")) return false;
  const remainder = normalizedPlan.slice(3);
  if (remainder === "lite") return true;
  return remainder.length > 0 && !/^[a-z]/.test(remainder);
}

function looksLikeErrorPlanType(planType) {
  const planText = String(planType || "").trim();
  if (!planText) return false;
  if (/\s/.test(planText)) return true;
  if (/[：:]/.test(planText)) return true;
  if (/error|fail|unable|cannot|invalid|offline|timeout|unauthor/i.test(planText)) return true;
  if (/無法|連線|錯誤|失敗|未登入/.test(planText)) return true;
  return false;
}

function getColorForPercent(percentageValue) {
  if (percentageValue >= 90) return "var(--color-red)";
  if (percentageValue >= 70) return "var(--color-yellow)";
  return "var(--color-green)";
}

function formatCountdown(totalSeconds) {
  if (totalSeconds <= 0) {
    return currentLanguage === "zh-TW" ? "即將重設" : "Ready";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function tickCountdown() {
  const currentTimeMilliseconds = Date.now();

  if (fiveHourResetTimestamp > 0) {
    const remainingSeconds = Math.max(0, Math.floor((fiveHourResetTimestamp - currentTimeMilliseconds) / 1000));
    const textElement = document.getElementById("text-five-hour-reset");
    if (textElement) {
      textElement.textContent = formatCountdown(remainingSeconds);
    }
  }

  if (weeklyResetTimestamp > 0) {
    const remainingSeconds = Math.max(0, Math.floor((weeklyResetTimestamp - currentTimeMilliseconds) / 1000));
    const textElement = document.getElementById("text-weekly-reset");
    if (textElement) {
      textElement.textContent = formatCountdown(remainingSeconds);
    }
  }
}

function updateWindowCard(windowPrefix, quotaWindow) {
  const progressBar = document.getElementById(`bar-${windowPrefix}`);
  const textUsed = document.getElementById(`text-${windowPrefix}-used`);
  const textRemaining = document.getElementById(`text-${windowPrefix}-rem`);
  const textReset = document.getElementById(`text-${windowPrefix}-reset`);
  const textStatus = document.getElementById(`text-${windowPrefix}-status`);

  if (!quotaWindow) {
    if (windowPrefix === "five-hour") fiveHourResetTimestamp = 0;
    if (windowPrefix === "weekly") weeklyResetTimestamp = 0;
    if (progressBar) progressBar.style.width = "0%";
    if (textUsed) textUsed.textContent = currentLanguage === "zh-TW" ? "尚無資料" : "Unavailable";
    if (textRemaining) textRemaining.textContent = "—";
    if (textReset) textReset.textContent = "—";
    if (textStatus) {
      textStatus.textContent = "—";
      textStatus.className = "meta-value";
    }
    return;
  }

  const usedPercent = Math.round(quotaWindow.usedPercent);
  const remainingPercent = Math.max(0, 100 - usedPercent);

  if (progressBar) {
    progressBar.style.width = `${usedPercent}%`;
    progressBar.style.backgroundColor = getColorForPercent(usedPercent);
  }
  if (textUsed) {
    textUsed.textContent = currentLanguage === "zh-TW" ? `已用 ${usedPercent}%` : `Used ${usedPercent}%`;
  }
  if (textRemaining) {
    textRemaining.textContent = currentLanguage === "zh-TW" ? `剩餘 ${remainingPercent}%` : `${remainingPercent}% left`;
  }

  let targetMilliseconds = 0;
  if (typeof quotaWindow.resetAtMs === "number" && quotaWindow.resetAtMs > 0) {
    targetMilliseconds = quotaWindow.resetAtMs;
  } else if (typeof quotaWindow.resetAfterSeconds === "number" && quotaWindow.resetAfterSeconds > 0) {
    const existingTimestamp = windowPrefix === "five-hour" ? fiveHourResetTimestamp : weeklyResetTimestamp;
    if (existingTimestamp > Date.now()) {
      targetMilliseconds = existingTimestamp;
    } else {
      targetMilliseconds = Date.now() + quotaWindow.resetAfterSeconds * 1000;
    }
  }

  if (targetMilliseconds > 0) {
    if (windowPrefix === "five-hour") {
      fiveHourResetTimestamp = targetMilliseconds;
    } else if (windowPrefix === "weekly") {
      weeklyResetTimestamp = targetMilliseconds;
    }
    if (textReset) {
      const remainingSeconds = Math.max(0, Math.floor((targetMilliseconds - Date.now()) / 1000));
      textReset.textContent = formatCountdown(remainingSeconds);
    }
  } else if (textReset) {
    textReset.textContent = quotaWindow.resetCountdown || "—";
  }

  if (textStatus) {
    if (usedPercent >= 95) {
      textStatus.textContent = currentLanguage === "zh-TW" ? "額度即將耗盡" : "Critical";
      textStatus.className = "meta-value danger";
    } else if (usedPercent >= 80) {
      textStatus.textContent = currentLanguage === "zh-TW" ? "額度偏低注意" : "Warning";
      textStatus.className = "meta-value warn";
    } else {
      textStatus.textContent = currentLanguage === "zh-TW" ? "額度充足正常" : "Optimal";
      textStatus.className = "meta-value ok";
    }
  }
}

function renderQuotaSnapshot(quotaSnapshot) {
  if (!quotaSnapshot) return;
  lastQuotaSnapshot = quotaSnapshot;

  const isProTier = quotaSnapshot.source !== "fallback" && (
    quotaSnapshot.proTier === true || isProPlanType(quotaSnapshot.planType)
  );

  const standardFiveHour = document.getElementById("standard-five-hour-content");
  const proFiveHour = document.getElementById("pro-five-hour-content");
  if (standardFiveHour && proFiveHour) {
    if (isProTier && !quotaSnapshot.fiveHour) {
      standardFiveHour.style.display = "none";
      proFiveHour.style.display = "block";
    } else {
      standardFiveHour.style.display = "block";
      proFiveHour.style.display = "none";
      updateWindowCard("five-hour", quotaSnapshot.fiveHour);
    }
  }

  const accountBadge = document.getElementById("account-badge");
  if (accountBadge) {
    const emailLabel = quotaSnapshot.email || "Local User";
    let planLabel = quotaSnapshot.planType || "prolite";
    if (quotaSnapshot.source === "fallback") {
      planLabel = "offline";
    } else if (looksLikeErrorPlanType(quotaSnapshot.planType)) {
      planLabel = "—";
    }
    accountBadge.textContent = `${emailLabel} (${planLabel})`;
  }

  const voucherBadge = document.getElementById("voucher-badge");
  if (voucherBadge) {
    voucherBadge.textContent = currentLanguage === "zh-TW"
      ? `重置券: ${quotaSnapshot.resetCredits || 0} 張`
      : `Reset Credits: ${quotaSnapshot.resetCredits || 0}`;
  }

  updateWindowCard("weekly", quotaSnapshot.weekly);

  // Additional Limits (Spark, etc.)
  const additionalLimitsSection = document.getElementById("additional-limits-section");
  const additionalLimitsList = document.getElementById("additional-limits-list");
  if (additionalLimitsSection && additionalLimitsList) {
    if (quotaSnapshot.additionalLimits && quotaSnapshot.additionalLimits.length > 0) {
      additionalLimitsSection.style.display = "block";
      additionalLimitsList.innerHTML = quotaSnapshot.additionalLimits.map((additionalLimit) => {
        const primaryText = additionalLimit.primaryWindow ? `${additionalLimit.primaryWindow.usedPercent}% (${additionalLimit.primaryWindow.remainingPercent}% left)` : "N/A";
        const secondaryText = additionalLimit.secondaryWindow ? `${additionalLimit.secondaryWindow.usedPercent}% (${additionalLimit.secondaryWindow.remainingPercent}% left)` : "N/A";
        return `
          <div class="card" style="padding: 14px; margin-bottom: 0;">
            <div style="font-weight: 600; margin-bottom: 6px; color: #fff;">${escapeHtml(additionalLimit.limitName)}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              5h: <strong>${primaryText}</strong> | 7d: <strong>${secondaryText}</strong>
            </div>
          </div>
        `;
      }).join("");
    } else {
      additionalLimitsSection.style.display = "none";
    }
  }
}

async function fetchQuota(force = false) {
  try {
    const response = await dashboardFetch(`/api/quota${force ? "?force=true" : ""}`);
    if (!response.ok) return;
    const quotaSnapshot = await response.json();
    renderQuotaSnapshot(quotaSnapshot);
  } catch (caughtError) {
    throw caughtError;
  }
}

async function fetchSummary() {
  try {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const response = await dashboardFetch(`/api/summary?since=${todayMidnight.getTime()}`);
    if (!response.ok) return;
    const summary = await response.json();

    document.getElementById("text-today-tokens").textContent = formatNumber(summary.totalTokens);
    document.getElementById("text-today-cost").textContent = `~${formatUsdDisplay(summary.formattedCostUsd)} USD`;

    const pricingMetaElem = document.getElementById("pricing-meta");
    if (pricingMetaElem && summary.pricing) {
      const sourceLabel = summary.pricing.source === "user-config" ? "自訂定價" : "內建定價";
      pricingMetaElem.textContent = `(${summary.pricing.version})`;
      pricingMetaElem.title = `定價版本: ${summary.pricing.version} (${sourceLabel} ~/.codex/pricing.json)`;
    }

    document.getElementById("text-today-input").textContent = `${formatNumber(summary.inputTokens)} / ${formatNumber(summary.cachedInputTokens)}`;
    document.getElementById("text-today-output").textContent = `${formatNumber(summary.outputTokens)} / ${formatNumber(summary.reasoningOutputTokens)}`;

    const mainAgentTokens = summary.mainAgentTokens || 0;
    const subAgentTokens = summary.subAgentTokens || 0;
    const totalAgentTokens = mainAgentTokens + subAgentTokens;
    const mainPercent = totalAgentTokens > 0 ? Math.round((mainAgentTokens / totalAgentTokens) * 100) : 100;
    const subPercent = 100 - mainPercent;
    document.getElementById("text-today-agents").textContent = `Main ${mainPercent}% / Sub ${subPercent}% (${formatNumber(subAgentTokens)} tokens)`;

    document.getElementById("text-today-requests").textContent = `${formatNumber(summary.requests)} calls`;
    document.getElementById("text-today-burn-rate").textContent = `${formatNumber(summary.hourlyBurnRate)} / hr`;

    // Model breakdown bars
    const container = document.getElementById("model-bars-container");
    if (container && summary.byModel) {
      if (summary.byModel.length === 0) {
        container.innerHTML = `<div style="color: var(--text-secondary); font-size: 13px;">No token usage recorded today</div>`;
      } else {
        const maxTokens = Math.max(...summary.byModel.map((modelStats) => modelStats.totalTokens), 1);
        container.innerHTML = summary.byModel.map((modelStats) => {
          const barPercent = Math.round((modelStats.totalTokens / maxTokens) * 100);
          return `
            <div class="model-bar-row">
              <div class="model-bar-info">
                <span><strong>${escapeHtml(modelStats.model)}</strong> (${formatNumber(modelStats.requests)} calls)</span>
                <span>${formatNumber(modelStats.totalTokens)} tokens ($${(modelStats.costUsd || 0).toFixed(2)})</span>
              </div>
              <div class="model-bar-track">
                <div class="model-bar-val" style="width: ${barPercent}%;"></div>
              </div>
            </div>
          `;
        }).join("");
      }
    }
  } catch (caughtError) {
    throw caughtError;
  }
}

async function fetchHourlyStats() {
  try {
    const response = await dashboardFetch("/api/stats/hourly?hours=24");
    if (!response.ok) return;
    const hourlyData = await response.json();

    const chartContainer = document.getElementById("hourly-chart-container");
    if (!chartContainer) return;

    const now = new Date();
    const hourlySlots = [];
    const statsMap = new Map();

    for (const item of hourlyData) {
      statsMap.set(item.hour, item);
    }

    let total24hTokens = 0;

    for (let index = 23; index >= 0; index -= 1) {
      const slotDate = new Date(now.getTime() - index * 3600 * 1000);
      const year = slotDate.getFullYear();
      const month = String(slotDate.getMonth() + 1).padStart(2, "0");
      const day = String(slotDate.getDate()).padStart(2, "0");
      const hour = String(slotDate.getHours()).padStart(2, "0");
      const key = `${year}-${month}-${day} ${hour}:00`;

      const found = statsMap.get(key);
      const tokens = found ? found.tokens : 0;
      const requests = found ? found.requests : 0;
      total24hTokens += tokens;

      hourlySlots.push({
        key,
        displayHour: `${hour}:00`,
        tokens,
        requests,
        current: index === 0,
      });
    }

    const totalLabel = document.getElementById("chart-total-tokens");
    if (totalLabel) {
      totalLabel.textContent = `24h Total: ${formatNumber(total24hTokens)} tokens`;
    }

    const width = 1000;
    const height = 180;
    const paddingLeft = 10;
    const paddingRight = 10;
    const paddingTop = 20;
    const paddingBottom = 30;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const maxTokens = Math.max(...hourlySlots.map((slot) => slot.tokens), 1000);
    const slotCount = hourlySlots.length;
    const colWidth = chartWidth / slotCount;
    const barWidth = Math.max(8, colWidth - 6);

    let barsSvg = "";
    let labelsSvg = "";

    hourlySlots.forEach((slot, index) => {
      const barHeight = slot.tokens > 0 ? Math.max(4, Math.round((slot.tokens / maxTokens) * chartHeight)) : 0;
      const x = paddingLeft + index * colWidth + (colWidth - barWidth) / 2;
      const y = paddingTop + chartHeight - barHeight;
      const barClass = slot.current ? "chart-bar current-hour" : "chart-bar";

      barsSvg += `
        <rect class="${barClass}"
              x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3"
              data-time="${slot.key}" data-tokens="${slot.tokens}" data-requests="${slot.requests}" />
      `;

      if (index % 3 === 0 || index === slotCount - 1) {
        const textX = paddingLeft + index * colWidth + colWidth / 2;
        labelsSvg += `
          <text class="chart-axis-text" x="${textX}" y="${height - 8}">${slot.displayHour}</text>
        `;
      }
    });

    const svgHtml = `
      <svg class="hourly-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <line class="chart-axis-line" x1="${paddingLeft}" y1="${paddingTop + chartHeight}" x2="${width - paddingRight}" y2="${paddingTop + chartHeight}" />
        ${barsSvg}
        ${labelsSvg}
      </svg>
      <div id="chart-tooltip" class="chart-tooltip" style="display: none;"></div>
    `;

    chartContainer.innerHTML = svgHtml;

    const tooltip = document.getElementById("chart-tooltip");
    const bars = chartContainer.querySelectorAll(".chart-bar");

    bars.forEach((bar) => {
      bar.addEventListener("mouseenter", () => {
        const time = bar.getAttribute("data-time");
        const tokens = parseInt(bar.getAttribute("data-tokens") || "0", 10);
        const requests = parseInt(bar.getAttribute("data-requests") || "0", 10);

        tooltip.innerHTML = `<strong>${time}</strong><br>Tokens: ${formatNumber(tokens)} (${formatNumber(requests)} calls)`;
        tooltip.style.display = "block";

        const containerRect = chartContainer.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        const left = barRect.left - containerRect.left + barRect.width / 2;
        const top = barRect.top - containerRect.top;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      });

      bar.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });
  } catch (caughtError) {
    throw caughtError;
  }
}

async function fetchSettlementReport(period = "daily") {
  try {
    currentSettlementPeriod = period;
    const response = await dashboardFetch(`/api/settlement?period=${encodeURIComponent(period)}&limit=14`);
    if (!response.ok) return;
    const data = await response.json();

    const infoTag = document.getElementById("settlement-info-tag");
    if (infoTag) {
      infoTag.textContent = `${period.toUpperCase()} (${(data.settlements || data.records || []).length} ${uiText("entries", "筆")})`;
    }

    const tbody = document.getElementById("settlement-table-body");
    if (!tbody) return;

    const settlementRecords = data.settlements || data.records || [];
    if (!settlementRecords.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center">No settlement records found</td></tr>`;
      return;
    }

    tbody.innerHTML = settlementRecords.map((record) => {
      return `
        <tr>
          <td><strong>${escapeHtml(record.periodKey)}</strong></td>
          <td><strong>${formatNumber(record.totalTokens)}</strong></td>
          <td style="color: var(--color-cyan); font-weight: 600;">${formatUsdDisplay(record.formattedCostUsd)}</td>
          <td>${formatNumber(record.inputTokens)} / <span style="color: var(--text-secondary);">${formatNumber(record.cachedInputTokens)}</span></td>
          <td>${formatNumber(record.outputTokens)} / <span style="color: var(--text-secondary);">${formatNumber(record.reasoningOutputTokens)}</span></td>
          <td>${formatNumber(record.mainAgentTokens)}</td>
          <td>${formatNumber(record.subAgentTokens)}</td>
          <td>${formatNumber(record.requests)}</td>
        </tr>
      `;
    }).join("");
  } catch (caughtError) {
    throw caughtError;
  }
}

async function fetchResetEvents() {
  try {
    const response = await dashboardFetch("/api/resets?limit=20");
    if (!response.ok) return;
    const data = await response.json();

    const events = Array.isArray(data) ? data : (data.events || []);
    const count = Array.isArray(data) ? data.length : (data.count ?? events.length);

    const countTag = document.getElementById("resets-count-tag");
    if (countTag) {
      countTag.textContent = `${count} events`;
    }

    const tbody = document.getElementById("resets-table-body");
    if (!tbody) return;

    if (!events.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">No reset events recorded yet</td></tr>`;
      return;
    }

    tbody.innerHTML = events.map((event) => {
      const timeString = event.datetime ? event.datetime.replace("T", " ").slice(0, 19) : "—";
      const deltaText = event.creditDelta > 0 ? `+${event.creditDelta}` : `${event.creditDelta}`;
      const deltaClass = event.creditDelta > 0 ? "style=\"color: var(--color-green); font-weight: bold;\"" : "";

      return `
        <tr>
          <td>${timeString}</td>
          <td><span class="badge">${escapeHtml(event.eventType)}</span></td>
          <td>5h: ${formatPercentDisplay(event.previousFiveHourUsedPercent)} | 7d: ${formatPercentDisplay(event.previousWeeklyUsedPercent)}</td>
          <td>5h: ${formatPercentDisplay(event.newFiveHourUsedPercent)} | 7d: ${formatPercentDisplay(event.newWeeklyUsedPercent)}</td>
          <td ${deltaClass}>${deltaText} (Bal: ${event.availableCredits})</td>
          <td>${escapeHtml(event.description)}</td>
        </tr>
      `;
    }).join("");
  } catch (caughtError) {
    throw caughtError;
  }
}

async function fetchPlanChangeEvents() {
  try {
    const response = await dashboardFetch("/api/plan-changes?limit=20");
    if (!response.ok) return;
    const planChanges = await response.json();

    const countTag = document.getElementById("plans-count-tag");
    if (countTag) {
      countTag.textContent = `${planChanges.length} events`;
    }

    const tbody = document.getElementById("plans-table-body");
    if (!tbody) return;

    if (!planChanges || planChanges.length === 0) {
      const emptyMsg = currentLanguage === "zh-TW"
        ? "目前尚無方案調整紀錄（帳號維持現有方案）"
        : "No plan transitions recorded yet (maintaining current plan)";
      tbody.innerHTML = `<tr><td colspan="5" class="text-center">${emptyMsg}</td></tr>`;
      return;
    }

    tbody.innerHTML = planChanges.map((event) => {
      const timeString = event.datetime ? event.datetime.replace("T", " ").slice(0, 19) : "—";
      let badgeStyle = "background: rgba(59, 130, 246, 0.15); color: #60a5fa;";
      let typeLabel = "Change";
      if (event.changeType === "upgrade") {
        badgeStyle = "background: rgba(34, 197, 94, 0.15); color: #4ade80;";
        typeLabel = currentLanguage === "zh-TW" ? "方案升級" : "Upgrade";
      } else if (event.changeType === "downgrade") {
        badgeStyle = "background: rgba(239, 68, 68, 0.15); color: #f87171;";
        typeLabel = currentLanguage === "zh-TW" ? "方案降級" : "Downgrade";
      }

      return `
        <tr>
          <td>${timeString}</td>
          <td><span class="badge" style="${badgeStyle}">${typeLabel}</span></td>
          <td><strong>${escapeHtml((event.previousPlan || "—").toUpperCase())}</strong></td>
          <td><strong>${escapeHtml((event.newPlan || "—").toUpperCase())}</strong></td>
          <td>${escapeHtml(event.description || "—")}</td>
        </tr>
      `;
    }).join("");
  } catch (caughtError) {
    throw caughtError;
  }
}

async function fetchHistory() {
  try {
    const offset = (currentPage - 1) * pageSize;
    let url = `/api/history?limit=${pageSize}&offset=${offset}`;
    if (currentFilterModel) {
      url += `&model=${encodeURIComponent(currentFilterModel)}`;
    }
    if (currentFilterAgentRole) {
      url += `&agent_role=${encodeURIComponent(currentFilterAgentRole)}`;
    }

    const response = await dashboardFetch(url);
    if (!response.ok) return;
    const data = await response.json();

    totalHistoryRecords = data.total;
    visibleHistoryRecords = data.records;
    updatePagination();
    document.getElementById("history-total-count").textContent = `${formatNumber(data.total)} records`;

    const tbody = document.getElementById("history-table-body");
    if (!tbody) return;

    if (data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center">No matching records found</td></tr>`;
      return;
    }

    tbody.innerHTML = data.records.map((record, index) => {
      const timeString = record.datetime ? record.datetime.replace("T", " ").slice(0, 19) : "—";
      const weeklyQuota = record.weeklyUsedPercent !== null && record.weeklyUsedPercent !== undefined
        ? `${record.weeklyUsedPercent}%`
        : record.weeklyUsedPct !== null && record.weeklyUsedPct !== undefined
        ? `${record.weeklyUsedPct}%`
        : "—";
      const shortId = record.sessionId ? `${record.sessionId.slice(0, 8)}...` : "—";
      const costText = record.costUsd ? `$${record.costUsd.toFixed(3)}` : "$0.000";
      const roleBadge = record.agentRole === "subagent"
        ? "<span class=\"badge\" style=\"background: rgba(245, 158, 11, 0.15); color: var(--color-yellow);\">subAgent</span>"
        : "<span class=\"badge\" style=\"background: rgba(56, 189, 248, 0.15); color: var(--color-blue);\">Main</span>";

      return `
        <tr>
          <td>${timeString}</td>
          <td>${roleBadge}</td>
          <td><span class="badge">${escapeHtml(record.model)}</span></td>
          <td><strong>${formatNumber(record.totalTokens)}</strong></td>
          <td style="color: var(--color-cyan); font-weight: 500;">${costText}</td>
          <td>${formatNumber(record.inputTokens)}</td>
          <td style="color: var(--text-secondary);">${formatNumber(record.cachedInputTokens)}</td>
          <td>${formatNumber(record.outputTokens)}</td>
          <td style="color: var(--text-secondary);">${formatNumber(record.reasoningOutputTokens)}</td>
          <td>${weeklyQuota}</td>
          <td><button class="btn btn-sm" data-record-index="${index}" aria-label="${uiText("View record", "查看紀錄")} ${escapeHtml(shortId)}">${uiText("View", "查看")}</button></td>
        </tr>
      `;
    }).join("");

    updatePagination();
  } catch (caughtError) {
    throw caughtError;
  }
}

function updatePagination() {
  const maxPage = Math.max(1, Math.ceil(totalHistoryRecords / pageSize));
  document.getElementById("page-indicator").textContent = currentLanguage === "zh-TW"
    ? `第 ${currentPage} / ${maxPage} 頁`
    : `Page ${currentPage} of ${maxPage}`;
  document.getElementById("btn-prev-page").disabled = currentPage <= 1;
  document.getElementById("btn-next-page").disabled = currentPage >= maxPage;
}

function setupSse() {
  const statusElement = document.getElementById("connection-status");
  const eventSource = new EventSource("/api/stream");

  eventSource.onopen = () => {
    if (statusElement) {
      statusElement.textContent = currentLanguage === "zh-TW" ? "即時串流連線中" : "Live Stream Connected";
      statusElement.className = "status-badge connected";
    }
  };

  eventSource.addEventListener("quota", (event) => {
    try {
      const quotaSnapshot = JSON.parse(event.data);
      renderQuotaSnapshot(quotaSnapshot);
    } catch {}
  });

  eventSource.addEventListener("records", () => {
    fetchSummary();
    fetchHourlyStats();
    fetchSettlementReport(currentSettlementPeriod);
    fetchResetEvents();

    if (currentPage === 1) {
      fetchHistory();
    } else {
      const noticeBanner = document.getElementById("new-records-notification");
      if (noticeBanner) {
        noticeBanner.style.display = "flex";
      }
    }
  });

  eventSource.onerror = () => {
    if (statusElement) {
      statusElement.textContent = currentLanguage === "zh-TW" ? "重新連線中..." : "Reconnecting...";
      statusElement.className = "status-badge connecting";
    }
  };
}

function escapeCsvField(fieldValue) {
  if (fieldValue === null || fieldValue === undefined) return "";
  const rawContent = String(fieldValue);
  const stringContent = typeof fieldValue === "string" && /^[\t\r\n ]*[=+\-@]/.test(rawContent)
    ? `'${rawContent}`
    : rawContent;
  if (stringContent.includes(",") || stringContent.includes("\"") || stringContent.includes("\n") || stringContent.includes("\r")) {
    return `"${stringContent.replace(/"/g, "\"\"")}"`;
  }
  return stringContent;
}

async function exportCsv() {
  const button = document.getElementById("btn-export-csv");
  if (button.getAttribute("aria-busy") === "true") return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    let url = "/api/history?limit=5000";
    if (currentFilterModel) {
      url += `&model=${encodeURIComponent(currentFilterModel)}`;
    }
    if (currentFilterAgentRole) {
      url += `&agent_role=${encodeURIComponent(currentFilterAgentRole)}`;
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.records || data.records.length === 0) {
      showFeedback(uiText("No records to export. Reset filters and try again.", "目前沒有可匯出的紀錄，請重設條件後重試。"), "danger");
      return;
    }

    const headers = ["Timestamp", "Role", "Model", "TotalTokens", "CostUSD", "InputTokens", "CachedTokens", "OutputTokens", "ReasoningTokens", "WeeklyQuota", "SessionID"];
    const rows = data.records.map((record) => [
      escapeCsvField(record.datetime),
      escapeCsvField(record.agentRole || "main"),
      escapeCsvField(record.model),
      escapeCsvField(record.totalTokens),
      escapeCsvField(record.costUsd ?? 0),
      escapeCsvField(record.inputTokens),
      escapeCsvField(record.cachedInputTokens),
      escapeCsvField(record.outputTokens),
      escapeCsvField(record.reasoningOutputTokens),
      escapeCsvField(record.weeklyUsedPercent ?? record.weeklyUsedPct ?? ""),
      escapeCsvField(record.sessionId)
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", downloadUrl);

    const modelSuffix = currentFilterModel ? `_${currentFilterModel.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
    const dateString = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `codex_token_usage${modelSuffix}_${dateString}.csv`);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
    showFeedback(uiText(`CSV prepared: ${data.records.length} records (maximum 5,000).`, `CSV 已產生：${data.records.length} 筆（上限 5,000 筆）。`));
  } catch (caughtError) {
    showFeedback(uiText("Export failed. Please retry.", "匯出失敗，請稍後重試。"), "danger");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

fetchQuota = withRequestFeedback(fetchQuota);
fetchSummary = withRequestFeedback(fetchSummary);
fetchHourlyStats = withRequestFeedback(fetchHourlyStats);
fetchSettlementReport = withRequestFeedback(fetchSettlementReport, { table: "settlement", columns: 8, buttons: [".btn-period"] });
fetchResetEvents = withRequestFeedback(fetchResetEvents, { table: "resets", columns: 6 });
fetchPlanChangeEvents = withRequestFeedback(fetchPlanChangeEvents, { table: "plans", columns: 5 });
fetchHistory = withRequestFeedback(fetchHistory, { table: "history", columns: 11, buttons: ["#btn-prev-page", "#btn-next-page", "#btn-load-new-records", "#btn-reset-filters"] });

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  setLanguage(currentLanguage);

  document.querySelectorAll(".btn-lang").forEach((button) => {
    button.addEventListener("click", () => {
      const targetLang = button.getAttribute("data-lang");
      if (targetLang) setLanguage(targetLang);
    });
  });

  fetchQuota();
  fetchSummary();
  fetchHourlyStats();
  fetchSettlementReport("daily");
  fetchResetEvents();
  fetchPlanChangeEvents();
  fetchHistory();
  setupSse();

  setInterval(tickCountdown, 1000);

  document.getElementById("btn-refresh").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const results = await Promise.all([fetchQuota(true), fetchSummary(), fetchHourlyStats(), fetchSettlementReport(currentSettlementPeriod), fetchResetEvents(), fetchPlanChangeEvents(), fetchHistory()]);
    showFeedback(results.every(Boolean) ? uiText("Data refreshed.", "資料已更新。") : uiText("Some data could not be refreshed. Please retry.", "部分資料未能更新，請重試。"), results.every(Boolean) ? "success" : "danger");
    button.disabled = false;
    button.removeAttribute("aria-busy");
  });

  document.getElementById("btn-export-csv").addEventListener("click", exportCsv);

  const modelInput = document.getElementById("filter-model");
  document.getElementById("history-table-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-record-index]");
    if (!button) return;
    const record = visibleHistoryRecords[Number(button.dataset.recordIndex)];
    if (!record) return;
    document.getElementById("record-dialog-title").textContent = uiText("Record details", "紀錄明細");
    document.getElementById("btn-close-details").textContent = uiText("Close", "關閉");
    const fields = [["Session ID", record.sessionId], ["Thread ID", record.threadId], ["Turn ID", record.turnId], [uiText("Time", "時間"), record.datetime], [uiText("Model", "模型"), record.model], [uiText("Agent role", "代理人角色"), record.agentRole], ["Tokens", formatNumber(record.totalTokens)], [uiText("Estimated cost (USD)", "估算費用（美元）"), formatUsdDisplay(record.costUsd)]];
    document.getElementById("record-details").innerHTML = fields.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "—")}</dd>`).join("");
    document.getElementById("record-dialog").showModal();
  });
  document.getElementById("btn-reset-filters").addEventListener("click", resetFilters);
  modelInput.addEventListener("input", (event) => {
    clearTimeout(filterDebounceTimer);
    currentFilterModel = event.target.value.trim();
    currentPage = 1;
    filterDebounceTimer = setTimeout(() => {
      currentFilterModel = event.target.value.trim();
      currentPage = 1;
      fetchHistory();
    }, 300);
  });

  const agentRoleSelect = document.getElementById("filter-agent-role");
  if (agentRoleSelect) {
    agentRoleSelect.addEventListener("change", (event) => {
      currentFilterAgentRole = event.target.value;
      currentPage = 1;
      fetchHistory();
    });
  }

  const periodButtons = document.querySelectorAll(".btn-period");
  periodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      periodButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      const selectedPeriod = button.getAttribute("data-period") || "daily";
      fetchSettlementReport(selectedPeriod);
    });
  });

  const noticeBanner = document.getElementById("new-records-notification");
  const loadNewButton = document.getElementById("btn-load-new-records");
  if (loadNewButton && noticeBanner) {
    loadNewButton.addEventListener("click", () => {
      currentPage = 1;
      noticeBanner.style.display = "none";
      fetchHistory();
    });
  }

  document.getElementById("btn-prev-page").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      fetchHistory();
    }
  });

  document.getElementById("btn-next-page").addEventListener("click", () => {
    const maxPage = Math.max(1, Math.ceil(totalHistoryRecords / pageSize));
    if (currentPage < maxPage) {
      currentPage += 1;
      fetchHistory();
    }
  });
});
