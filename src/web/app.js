// Codex 額度與 Token 消耗即時監控前端邏輯
let currentPage = 1;
const pageSize = 25;
let totalHistoryRecords = 0;
let currentFilterModel = "";
let currentFilterAgentRole = "";
let currentSettlementPeriod = "daily";

// 倒數計時目標時間戳記 (毫秒)
let fiveHourResetTimestamp = 0;
let weeklyResetTimestamp = 0;

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
    return "即將重設";
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
    if (textUsed) textUsed.textContent = "未配置限制";
    if (textRemaining) textRemaining.textContent = "無額外限制";
    if (textReset) textReset.textContent = "—";
    if (textStatus) {
      textStatus.textContent = "未啟用";
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
  if (textUsed) textUsed.textContent = `已用 ${usedPercent}%`;
  if (textRemaining) textRemaining.textContent = `剩餘 ${remainingPercent}%`;

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
      textStatus.textContent = "額度即將耗盡";
      textStatus.className = "meta-value danger";
    } else if (usedPercent >= 80) {
      textStatus.textContent = "額度偏低注意";
      textStatus.className = "meta-value warn";
    } else {
      textStatus.textContent = "額度充裕正常";
      textStatus.className = "meta-value ok";
    }
  }
}

function renderQuotaSnapshot(quotaSnapshot) {
  if (!quotaSnapshot) return;

  const accountBadge = document.getElementById("account-badge");
  if (accountBadge) {
    accountBadge.textContent = `${quotaSnapshot.email || "本機使用者"} (${quotaSnapshot.planType || "prolite"})`;
  }

  const voucherBadge = document.getElementById("voucher-badge");
  if (voucherBadge) {
    voucherBadge.textContent = `重置券: ${quotaSnapshot.resetCredits || 0} 張`;
  }

  updateWindowCard("five-hour", quotaSnapshot.fiveHour);
  updateWindowCard("weekly", quotaSnapshot.weekly);

  // 附加配額處理
  const additionalLimitsSection = document.getElementById("additional-limits-section");
  const additionalLimitsList = document.getElementById("additional-limits-list");
  if (additionalLimitsSection && additionalLimitsList) {
    if (quotaSnapshot.additionalLimits && quotaSnapshot.additionalLimits.length > 0) {
      additionalLimitsSection.style.display = "block";
      additionalLimitsList.innerHTML = quotaSnapshot.additionalLimits.map((additionalLimit) => {
        const primaryText = additionalLimit.primaryWindow ? `${additionalLimit.primaryWindow.usedPercent}% (剩餘 ${additionalLimit.primaryWindow.remainingPercent}%)` : "無";
        const secondaryText = additionalLimit.secondaryWindow ? `${additionalLimit.secondaryWindow.usedPercent}% (剩餘 ${additionalLimit.secondaryWindow.remainingPercent}%)` : "無";
        return `
          <div class="card" style="padding: 12px; margin-bottom: 0;">
            <div style="font-weight: 600; margin-bottom: 6px;">${additionalLimit.limitName}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              5小時: <strong>${primaryText}</strong> | 週用量: <strong>${secondaryText}</strong>
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
    console.error("無法取得配額快照:", caughtError);
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

    // 代理人角色分佈計算
    const mainAgentTokens = summary.mainAgentTokens || 0;
    const subAgentTokens = summary.subAgentTokens || 0;
    const totalAgentTokens = mainAgentTokens + subAgentTokens;
    const mainPercent = totalAgentTokens > 0 ? Math.round((mainAgentTokens / totalAgentTokens) * 100) : 100;
    const subPercent = 100 - mainPercent;
    document.getElementById("text-today-agents").textContent = `主 ${mainPercent}% / 子 ${subPercent}% (${formatNumber(subAgentTokens)} tokens)`;

    document.getElementById("text-today-requests").textContent = `${formatNumber(summary.requests)} 次`;
    document.getElementById("text-today-burn-rate").textContent = `${formatNumber(summary.hourlyBurnRate)} / hr`;

    // 渲染模型分佈條
    const container = document.getElementById("model-bars-container");
    if (container && summary.byModel) {
      if (summary.byModel.length === 0) {
        container.innerHTML = `<div style="color: var(--text-secondary); font-size: 13px;">本日尚無模型消耗紀錄</div>`;
      } else {
        const maxTokens = Math.max(...summary.byModel.map((modelStats) => modelStats.totalTokens), 1);
        container.innerHTML = summary.byModel.map((modelStats) => {
          const barPercent = Math.round((modelStats.totalTokens / maxTokens) * 100);
          return `
            <div class="model-bar-row">
              <div class="model-bar-info">
                <span><strong>${modelStats.model}</strong> (${formatNumber(modelStats.requests)} 請求)</span>
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
    console.error("無法取得統計彙總:", caughtError);
  }
}

// 取得並渲染過去 24 小時 Token 燃燒趨勢圖 (純 SVG)
async function fetchHourlyStats() {
  try {
    const response = await fetch("/api/stats/hourly?hours=24");
    if (!response.ok) return;
    const hourlyData = await response.json();

    const chartContainer = document.getElementById("hourly-chart-container");
    if (!chartContainer) return;

    // 建立過去 24 小時連續時間序列 (補齊零消耗小時)
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
      totalLabel.textContent = `近 24 小時累計: ${formatNumber(total24hTokens)} tokens`;
    }

    // 繪製 SVG 直方圖
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

      // 每 3 個小時標註一次時間刻度
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

    // 綁定 Hover 顯示 Tooltip
    const tooltip = document.getElementById("chart-tooltip");
    const bars = chartContainer.querySelectorAll(".chart-bar");

    bars.forEach((bar) => {
      bar.addEventListener("mouseenter", () => {
        const time = bar.getAttribute("data-time");
        const tokens = parseInt(bar.getAttribute("data-tokens") || "0", 10);
        const requests = parseInt(bar.getAttribute("data-requests") || "0", 10);

        tooltip.innerHTML = `<strong>${time}</strong><br>消耗: ${formatNumber(tokens)} tokens (${formatNumber(requests)} 次請求)`;
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
    console.error("無法取得每小時統計圖表:", caughtError);
  }
}

// 取得多週期結算報表
async function fetchSettlementReport(period = "daily") {
  try {
    currentSettlementPeriod = period;
    const response = await fetch(`/api/settlement?period=${encodeURIComponent(period)}&limit=14`);
    if (!response.ok) return;
    const data = await response.json();

    const periodLabels = {
      daily: "每日結算模式 (最近 14 天)",
      weekly: "每週結算模式 (最近 14 週)",
      monthly: "每月結算模式 (最近 12 個月)",
      yearly: "每年結算模式 (所有年份)",
    };

    const infoTag = document.getElementById("settlement-info-tag");
    if (infoTag) {
      infoTag.textContent = periodLabels[period] || `${period} 結算`;
    }

    const tbody = document.getElementById("settlement-table-body");
    if (!tbody) return;

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center">查無結算紀錄</td></tr>`;
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
          <td>${formatNumber(record.requests)} 次</td>
        </tr>
      `;
    }).join("");
  } catch (caughtError) {
    console.error("無法取得多週期結算報表:", caughtError);
  }
}

// 取得配額重置與重置券歷史事件
async function fetchResetEvents() {
  try {
    const response = await fetch("/api/resets?limit=20");
    if (!response.ok) return;
    const data = await response.json();

    const countTag = document.getElementById("resets-count-tag");
    if (countTag) {
      countTag.textContent = `${data.count || 0} 筆事件`;
    }

    const tbody = document.getElementById("resets-table-body");
    if (!tbody) return;

    if (!data.events || data.events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">目前尚無配額重置或重置券事件</td></tr>`;
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
          <td ${deltaClass}>${deltaText} (餘 ${event.availableCredits})</td>
          <td>${event.description}</td>
        </tr>
      `;
    }).join("");
  } catch (caughtError) {
    console.error("無法取得配額重置紀錄:", caughtError);
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
    document.getElementById("history-total-count").textContent = `${formatNumber(data.total)} 筆紀錄`;

    const tbody = document.getElementById("history-table-body");
    if (!tbody) return;

    if (data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center">查無符合條件的消耗紀錄</td></tr>`;
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
        ? "<span class=\"badge\" style=\"background: rgba(210, 153, 34, 0.2); color: var(--color-yellow);\">subAgent</span>"
        : "<span class=\"badge\" style=\"background: rgba(88, 166, 255, 0.15); color: var(--color-blue);\">主程式</span>";

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
    console.error("無法取得歷史紀錄:", caughtError);
  }
}

function updatePagination() {
  const maxPage = Math.max(1, Math.ceil(totalHistoryRecords / pageSize));
  document.getElementById("page-indicator").textContent = `第 ${currentPage} / ${maxPage} 頁`;
  document.getElementById("btn-prev-page").disabled = currentPage <= 1;
  document.getElementById("btn-next-page").disabled = currentPage >= maxPage;
}

function setupSse() {
  const statusElement = document.getElementById("connection-status");
  const eventSource = new EventSource("/api/stream");

  eventSource.onopen = () => {
    if (statusElement) {
      statusElement.textContent = "即時串流連線中";
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

    // 若處於第 1 頁，直接自動更新；若在後續頁面，顯示提示列避免畫面跳動
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
      statusElement.textContent = "重新連線中...";
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

// 匯出 CSV 功能 (連動當前搜尋模型與角色篩選，遵循 RFC 4180 標準)
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
      alert("目前查無符合條件之消耗紀錄");
      return;
    }

    const headers = ["時間", "角色", "模型", "總Token", "等值美元", "輸入Token", "快取Token", "輸出Token", "推理Token", "週配額快照", "SessionID"];
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
    alert(`匯出失敗: ${caughtError.message}`);
  }
}

// 初始化綁定
document.addEventListener("DOMContentLoaded", () => {
  fetchQuota();
  fetchSummary();
  fetchHourlyStats();
  fetchSettlementReport("daily");
  fetchResetEvents();
  fetchHistory();
  setupSse();

  // 每一秒鐘更新用戶端倒數計時
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

  // 週期切換按鈕綁定
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
