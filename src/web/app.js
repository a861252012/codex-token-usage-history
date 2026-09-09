// Codex Token & Quota Real-Time Monitor Client
let currentLanguage = localStorage.getItem("codex_ui_lang") || "en";
let currentPage = 1;
const pageSize = 25;
let totalHistoryRecords = 0;
let currentFilterModel = "";
let currentFilterAgentRole = "";
let currentSettlementPeriod = "daily";

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
    historyTitle: "Token Usage Transaction Log",
    btnDaily: "Daily",
    btnWeekly: "Weekly",
    btnMonthly: "Monthly",
    btnYearly: "Yearly",
    proUnlimitedTitle: "Pro Unlimited",
    proUnlimitedDesc: "No 5-hour quota restriction on Pro tier. Only weekly cap applies.",
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
    historyTitle: "Token 消耗歷史紀錄流水帳",
    btnDaily: "每日結算",
    btnWeekly: "每週結算",
    btnMonthly: "每月結算",
    btnYearly: "每年結算",
    proUnlimitedTitle: "Pro 方案無限額度",
    proUnlimitedDesc: "OpenAI Pro 方案不設 5 小時額度上限，僅依據週用量總額控管。",
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

  const updateText = (id, text) => {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  };

  updateText("app-title", texts.appTitle);
  updateText("app-subtitle", texts.appSubtitle);
  updateText("btn-refresh", texts.refreshBtn);
  updateText("label-card-five-hour", texts.cardFiveHour);
  updateText("tag-card-five-hour", texts.tagFiveHour);
  updateText("label-five-hour-reset", texts.resetIn);
  updateText("label-five-hour-status", texts.statusLabel);
  updateText("label-card-weekly", texts.cardWeekly);
  updateText("label-weekly-reset", texts.resetCountdown);
  updateText("label-weekly-status", texts.statusLabel);
  updateText("label-card-today", texts.cardToday);
  updateText("tag-card-today", texts.tagToday);
  updateText("label-today-cost", texts.todayCost);
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
  updateText("label-history-title", texts.historyTitle);
  updateText("btn-export-csv", texts.exportCsv);
  updateText("btn-prev-page", texts.prevPage);
  updateText("btn-next-page", texts.nextPage);
  updateText("desc-pro-unlimited", texts.proUnlimitedDesc);

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
  return (numericValue || 0).toLocaleString("en-US");
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
    if (progressBar) progressBar.style.width = "0%";
    if (textUsed) textUsed.textContent = currentLanguage === "zh-TW" ? "無限制" : "Unlimited";
    if (textRemaining) textRemaining.textContent = currentLanguage === "zh-TW" ? "無限制" : "Unlimited";
    if (textReset) textReset.textContent = "—";
    if (textStatus) {
      textStatus.textContent = "Optimal";
      textStatus.className = "meta-value ok";
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

  if (quotaWindow.resetAfterSeconds !== undefined && quotaWindow.resetAfterSeconds > 0) {
    const targetMilliseconds = Date.now() + quotaWindow.resetAfterSeconds * 1000;
    if (windowPrefix === "five-hour") {
      fiveHourResetTimestamp = targetMilliseconds;
    } else if (windowPrefix === "weekly") {
      weeklyResetTimestamp = targetMilliseconds;
    }
    if (textReset) {
      textReset.textContent = formatCountdown(quotaWindow.resetAfterSeconds);
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

  const isProTier = (quotaSnapshot.planType || "").toLowerCase().includes("pro") || quotaSnapshot.fiveHour == null;

  const standardFiveHour = document.getElementById("standard-five-hour-content");
  const proFiveHour = document.getElementById("pro-five-hour-content");
  if (standardFiveHour && proFiveHour) {
    if (isProTier) {
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
    accountBadge.textContent = `${quotaSnapshot.email || "Local User"} (${quotaSnapshot.planType || "prolite"})`;
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
            <div style="font-weight: 600; margin-bottom: 6px; color: #fff;">${additionalLimit.limitName}</div>
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
    const response = await fetch(`/api/quota${force ? "?force=true" : ""}`);
    if (!response.ok) return;
    const quotaSnapshot = await response.json();
    renderQuotaSnapshot(quotaSnapshot);
  } catch (caughtError) {
    console.error("Failed to fetch quota snapshot:", caughtError);
  }
}

async function fetchSummary() {
  try {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const response = await fetch(`/api/summary?since=${todayMidnight.getTime()}`);
    if (!response.ok) return;
    const summary = await response.json();

    document.getElementById("text-today-tokens").textContent = formatNumber(summary.totalTokens);
    document.getElementById("text-today-cost").textContent = `$${summary.formattedCostUsd || "0.00"} USD`;
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
                <span><strong>${modelStats.model}</strong> (${formatNumber(modelStats.requests)} calls)</span>
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
    console.error("Failed to fetch summary:", caughtError);
  }
}

async function fetchHourlyStats() {
  try {
    const response = await fetch("/api/stats/hourly?hours=24");
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
    console.error("Failed to fetch hourly stats:", caughtError);
  }
}

async function fetchSettlementReport(period = "daily") {
  try {
    currentSettlementPeriod = period;
    const response = await fetch(`/api/settlement?period=${encodeURIComponent(period)}&limit=14`);
    if (!response.ok) return;
    const data = await response.json();

    const infoTag = document.getElementById("settlement-info-tag");
    if (infoTag) {
      infoTag.textContent = `${period.toUpperCase()} (14 entries)`;
    }

    const tbody = document.getElementById("settlement-table-body");
    if (!tbody) return;

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center">No settlement records found</td></tr>`;
      return;
    }

    tbody.innerHTML = data.records.map((record) => {
      return `
        <tr>
          <td><strong>${record.periodKey}</strong></td>
          <td><strong>${formatNumber(record.totalTokens)}</strong></td>
          <td style="color: var(--color-cyan); font-weight: 600;">$${record.formattedCostUsd}</td>
          <td>${formatNumber(record.inputTokens)} / <span style="color: var(--text-secondary);">${formatNumber(record.cachedInputTokens)}</span></td>
          <td>${formatNumber(record.outputTokens)} / <span style="color: var(--text-secondary);">${formatNumber(record.reasoningOutputTokens)}</span></td>
          <td>${formatNumber(record.mainAgentTokens)}</td>
          <td>${formatNumber(record.subAgentTokens)}</td>
          <td>${formatNumber(record.requests)}</td>
        </tr>
      `;
    }).join("");
  } catch (caughtError) {
    console.error("Failed to fetch settlement report:", caughtError);
  }
}

async function fetchResetEvents() {
  try {
    const response = await fetch("/api/resets?limit=20");
    if (!response.ok) return;
    const data = await response.json();

    const countTag = document.getElementById("resets-count-tag");
    if (countTag) {
      countTag.textContent = `${data.count || 0} events`;
    }

    const tbody = document.getElementById("resets-table-body");
    if (!tbody) return;

    if (!data.events || data.events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">No reset events recorded yet</td></tr>`;
      return;
    }

    tbody.innerHTML = data.events.map((event) => {
      const timeString = event.datetime ? event.datetime.replace("T", " ").slice(0, 19) : "—";
      const deltaText = event.creditDelta > 0 ? `+${event.creditDelta}` : `${event.creditDelta}`;
      const deltaClass = event.creditDelta > 0 ? "style=\"color: var(--color-green); font-weight: bold;\"" : "";

      return `
        <tr>
          <td>${timeString}</td>
          <td><span class="badge">${event.eventType}</span></td>
          <td>5h: ${event.previousFiveHourUsedPercent.toFixed(1)}% | 7d: ${event.previousWeeklyUsedPercent.toFixed(1)}%</td>
          <td>5h: ${event.newFiveHourUsedPercent.toFixed(1)}% | 7d: ${event.newWeeklyUsedPercent.toFixed(1)}%</td>
          <td ${deltaClass}>${deltaText} (Bal: ${event.availableCredits})</td>
          <td>${event.description}</td>
        </tr>
      `;
    }).join("");
  } catch (caughtError) {
    console.error("Failed to fetch reset events:", caughtError);
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

    const response = await fetch(url);
    if (!response.ok) return;
    const data = await response.json();

    totalHistoryRecords = data.total;
    document.getElementById("history-total-count").textContent = `${formatNumber(data.total)} records`;

    const tbody = document.getElementById("history-table-body");
    if (!tbody) return;

    if (data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center">No matching records found</td></tr>`;
      return;
    }

    tbody.innerHTML = data.records.map((record) => {
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
          <td><span class="badge">${record.model}</span></td>
          <td><strong>${formatNumber(record.totalTokens)}</strong></td>
          <td style="color: var(--color-cyan); font-weight: 500;">${costText}</td>
          <td>${formatNumber(record.inputTokens)}</td>
          <td style="color: var(--text-secondary);">${formatNumber(record.cachedInputTokens)}</td>
          <td>${formatNumber(record.outputTokens)}</td>
          <td style="color: var(--text-secondary);">${formatNumber(record.reasoningOutputTokens)}</td>
          <td>${weeklyQuota}</td>
          <td style="font-family: monospace; font-size: 11px;">${shortId}</td>
        </tr>
      `;
    }).join("");

    updatePagination();
  } catch (caughtError) {
    console.error("Failed to fetch history records:", caughtError);
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
  const stringContent = String(fieldValue);
  if (stringContent.includes(",") || stringContent.includes("\"") || stringContent.includes("\n") || stringContent.includes("\r")) {
    return `"${stringContent.replace(/"/g, "\"\"")}"`;
  }
  return stringContent;
}

async function exportCsv() {
  try {
    let url = "/api/history?limit=5000";
    if (currentFilterModel) {
      url += `&model=${encodeURIComponent(currentFilterModel)}`;
    }
    if (currentFilterAgentRole) {
      url += `&agent_role=${encodeURIComponent(currentFilterAgentRole)}`;
    }

    const response = await fetch(url);
    const data = await response.json();
    if (!data.records || data.records.length === 0) {
      alert("No usage records available to export");
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
  } catch (caughtError) {
    alert(`Export failed: ${caughtError.message}`);
  }
}

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
  fetchHistory();
  setupSse();

  setInterval(tickCountdown, 1000);

  document.getElementById("btn-refresh").addEventListener("click", () => {
    fetchQuota(true);
    fetchSummary();
    fetchHourlyStats();
    fetchSettlementReport(currentSettlementPeriod);
    fetchResetEvents();
    fetchHistory();
  });

  document.getElementById("btn-export-csv").addEventListener("click", exportCsv);

  const modelInput = document.getElementById("filter-model");
  let debounceTimer;
  modelInput.addEventListener("input", (event) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
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
