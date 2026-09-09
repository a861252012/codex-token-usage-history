// Codex 額度與 Token 消耗即時監控前端邏輯
let currentPage = 1;
const pageSize = 25;
let totalHistoryRecords = 0;
let currentFilterModel = "";

// 倒數計時目標時間戳記 (毫秒)
let fiveHourResetTimestamp = 0;
let weeklyResetTimestamp = 0;

function formatNum(num) {
  return (num || 0).toLocaleString("en-US");
}

function getProgressColor(pct) {
  if (pct >= 90) return "var(--color-red)";
  if (pct >= 70) return "var(--color-yellow)";
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
  const now = Date.now();

  if (fiveHourResetTimestamp > 0) {
    const remSec = Math.max(0, Math.floor((fiveHourResetTimestamp - now) / 1000));
    const textEl = document.getElementById("text-five-hour-reset");
    if (textEl) {
      textEl.textContent = formatCountdown(remSec);
    }
  }

  if (weeklyResetTimestamp > 0) {
    const remSec = Math.max(0, Math.floor((weeklyResetTimestamp - now) / 1000));
    const textEl = document.getElementById("text-weekly-reset");
    if (textEl) {
      textEl.textContent = formatCountdown(remSec);
    }
  }
}

function updateWindowCard(prefix, win) {
  const bar = document.getElementById(`bar-${prefix}`);
  const textUsed = document.getElementById(`text-${prefix}-used`);
  const textRem = document.getElementById(`text-${prefix}-rem`);
  const textReset = document.getElementById(`text-${prefix}-reset`);
  const textStatus = document.getElementById(`text-${prefix}-status`);

  if (!win) {
    if (bar) bar.style.width = "0%";
    if (textUsed) textUsed.textContent = "未配置限制";
    if (textRem) textRem.textContent = "無窗口";
    if (textReset) textReset.textContent = "—";
    if (textStatus) {
      textStatus.textContent = "未啟用";
      textStatus.className = "meta-value";
    }
    return;
  }

  const used = Math.round(win.usedPercent);
  const rem = Math.max(0, 100 - used);

  if (bar) {
    bar.style.width = `${used}%`;
    bar.style.backgroundColor = getProgressColor(used);
  }
  if (textUsed) textUsed.textContent = `已用 ${used}%`;
  if (textRem) textRem.textContent = `剩餘 ${rem}%`;

  if (win.resetAfterSeconds !== undefined && win.resetAfterSeconds > 0) {
    const targetMs = Date.now() + win.resetAfterSeconds * 1000;
    if (prefix === "five-hour") {
      fiveHourResetTimestamp = targetMs;
    } else if (prefix === "weekly") {
      weeklyResetTimestamp = targetMs;
    }
    if (textReset) {
      textReset.textContent = formatCountdown(win.resetAfterSeconds);
    }
  } else if (textReset) {
    textReset.textContent = win.resetCountdown || "—";
  }

  if (textStatus) {
    if (used >= 95) {
      textStatus.textContent = "額度即將耗盡";
      textStatus.className = "meta-value danger";
    } else if (used >= 80) {
      textStatus.textContent = "額度偏低注意";
      textStatus.className = "meta-value warn";
    } else {
      textStatus.textContent = "額度充裕正常";
      textStatus.className = "meta-value ok";
    }
  }
}

function renderQuotaSnapshot(snap) {
  if (!snap) return;

  const badge = document.getElementById("account-badge");
  if (badge) {
    badge.textContent = `${snap.email || "本機使用者"} (${snap.planType || "prolite"})`;
  }

  updateWindowCard("five-hour", snap.fiveHour);
  updateWindowCard("weekly", snap.weekly);

  // 附加配額處理
  const addSec = document.getElementById("additional-limits-section");
  const addList = document.getElementById("additional-limits-list");
  if (addSec && addList) {
    if (snap.additionalLimits && snap.additionalLimits.length > 0) {
      addSec.style.display = "block";
      addList.innerHTML = snap.additionalLimits.map((add) => {
        const p5 = add.primaryWindow ? `${add.primaryWindow.usedPercent}% (剩餘 ${add.primaryWindow.remainingPercent}%)` : "無";
        const pw = add.secondaryWindow ? `${add.secondaryWindow.usedPercent}% (剩餘 ${add.secondaryWindow.remainingPercent}%)` : "無";
        return `
          <div class="card" style="padding: 12px; margin-bottom: 0;">
            <div style="font-weight: 600; margin-bottom: 6px;">${add.limitName}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              5小時: <strong>${p5}</strong> | 週用量: <strong>${pw}</strong>
            </div>
          </div>
        `;
      }).join("");
    } else {
      addSec.style.display = "none";
    }
  }
}

async function fetchQuota(force = false) {
  try {
    const res = await fetch(`/api/quota${force ? "?force=true" : ""}`);
    if (!res.ok) return;
    const snap = await res.json();
    renderQuotaSnapshot(snap);
  } catch (err) {
    console.error("無法取得配額快照:", err);
  }
}

async function fetchSummary() {
  try {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const res = await fetch(`/api/summary?since=${todayMidnight.getTime()}`);
    if (!res.ok) return;
    const summary = await res.json();

    document.getElementById("text-today-tokens").textContent = formatNum(summary.totalTokens);
    document.getElementById("text-today-input").textContent = `${formatNum(summary.inputTokens)} / ${formatNum(summary.cachedInputTokens)}`;
    document.getElementById("text-today-output").textContent = `${formatNum(summary.outputTokens)} / ${formatNum(summary.reasoningOutputTokens)}`;
    document.getElementById("text-today-requests").textContent = `${formatNum(summary.requests)} 次`;
    document.getElementById("text-today-burn-rate").textContent = `${formatNum(summary.hourlyBurnRate)} / hr`;

    // 渲染模型分佈條
    const container = document.getElementById("model-bars-container");
    if (container && summary.byModel) {
      if (summary.byModel.length === 0) {
        container.innerHTML = `<div style="color: var(--text-secondary); font-size: 13px;">本日尚無模型消耗紀錄</div>`;
      } else {
        const maxTokens = Math.max(...summary.byModel.map((m) => m.totalTokens), 1);
        container.innerHTML = summary.byModel.map((m) => {
          const pct = Math.round((m.totalTokens / maxTokens) * 100);
          return `
            <div class="model-bar-row">
              <div class="model-bar-info">
                <span><strong>${m.model}</strong> (${formatNum(m.requests)} 請求)</span>
                <span>${formatNum(m.totalTokens)} tokens</span>
              </div>
              <div class="model-bar-track">
                <div class="model-bar-val" style="width: ${pct}%;"></div>
              </div>
            </div>
          `;
        }).join("");
      }
    }
  } catch (err) {
    console.error("無法取得統計彙總:", err);
  }
}

// 取得並渲染過去 24 小時 Token 燃燒趨勢圖 (純 SVG)
async function fetchHourlyStats() {
  try {
    const res = await fetch("/api/stats/hourly?hours=24");
    if (!res.ok) return;
    const data = await res.json();

    const chartContainer = document.getElementById("hourly-chart-container");
    if (!chartContainer) return;

    // 建立過去 24 小時連續時間序列 (補齊零消耗小時)
    const now = new Date();
    const hourlySlots = [];
    const statsMap = new Map();

    for (const item of data) {
      statsMap.set(item.hour, item);
    }

    let total24hTokens = 0;

    for (let i = 23; i >= 0; i -= 1) {
      const slotDate = new Date(now.getTime() - i * 3600 * 1000);
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
        current: i === 0,
      });
    }

    const totalLabel = document.getElementById("chart-total-tokens");
    if (totalLabel) {
      totalLabel.textContent = `近 24 小時累計: ${formatNum(total24hTokens)} tokens`;
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

    const maxTokens = Math.max(...hourlySlots.map((s) => s.tokens), 1000);
    const slotCount = hourlySlots.length;
    const colWidth = chartWidth / slotCount;
    const barWidth = Math.max(8, colWidth - 6);

    let barsSvg = "";
    let labelsSvg = "";

    hourlySlots.forEach((slot, idx) => {
      const barHeight = slot.tokens > 0 ? Math.max(4, Math.round((slot.tokens / maxTokens) * chartHeight)) : 0;
      const x = paddingLeft + idx * colWidth + (colWidth - barWidth) / 2;
      const y = paddingTop + chartHeight - barHeight;
      const barClass = slot.current ? "chart-bar current-hour" : "chart-bar";

      barsSvg += `
        <rect class="${barClass}"
              x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3"
              data-time="${slot.key}" data-tokens="${slot.tokens}" data-requests="${slot.requests}" />
      `;

      // 每 3 個小時標註一次時間刻度
      if (idx % 3 === 0 || idx === slotCount - 1) {
        const textX = paddingLeft + idx * colWidth + colWidth / 2;
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
        const reqs = parseInt(bar.getAttribute("data-requests") || "0", 10);

        tooltip.innerHTML = `<strong>${time}</strong><br>消耗: ${formatNum(tokens)} tokens (${formatNum(reqs)} 次請求)`;
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
  } catch (err) {
    console.error("無法取得每小時統計圖表:", err);
  }
}

async function fetchHistory() {
  try {
    const offset = (currentPage - 1) * pageSize;
    let url = `/api/history?limit=${pageSize}&offset=${offset}`;
    if (currentFilterModel) {
      url += `&model=${encodeURIComponent(currentFilterModel)}`;
    }

    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    totalHistoryRecords = data.total;
    document.getElementById("history-total-count").textContent = `${formatNum(data.total)} 筆紀錄`;

    const tbody = document.getElementById("history-table-body");
    if (!tbody) return;

    if (data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center">查無符合條件的消耗紀錄</td></tr>`;
      return;
    }

    tbody.innerHTML = data.records.map((r) => {
      const timeStr = r.datetime ? r.datetime.replace("T", " ").slice(0, 19) : "—";
      const weeklyQuota = r.weeklyUsedPct !== null && r.weeklyUsedPct !== undefined
        ? `${r.weeklyUsedPct}%`
        : "—";
      const shortId = r.sessionId ? `${r.sessionId.slice(0, 8)}...` : "—";

      return `
        <tr>
          <td>${timeStr}</td>
          <td><span class="badge">${r.model}</span></td>
          <td><strong>${formatNum(r.totalTokens)}</strong></td>
          <td>${formatNum(r.inputTokens)}</td>
          <td style="color: var(--text-secondary);">${formatNum(r.cachedInputTokens)}</td>
          <td>${formatNum(r.outputTokens)}</td>
          <td style="color: var(--text-secondary);">${formatNum(r.reasoningOutputTokens)}</td>
          <td>${weeklyQuota}</td>
          <td style="font-family: monospace; font-size: 11px;">${shortId}</td>
        </tr>
      `;
    }).join("");

    updatePagination();
  } catch (err) {
    console.error("無法取得歷史紀錄:", err);
  }
}

function updatePagination() {
  const maxPage = Math.max(1, Math.ceil(totalHistoryRecords / pageSize));
  document.getElementById("page-indicator").textContent = `第 ${currentPage} / ${maxPage} 頁`;
  document.getElementById("btn-prev-page").disabled = currentPage <= 1;
  document.getElementById("btn-next-page").disabled = currentPage >= maxPage;
}

function setupSse() {
  const statusEl = document.getElementById("connection-status");
  const sse = new EventSource("/api/stream");

  sse.onopen = () => {
    if (statusEl) {
      statusEl.textContent = "即時串流連線中";
      statusEl.className = "status-badge connected";
    }
  };

  sse.addEventListener("quota", (e) => {
    try {
      const snap = JSON.parse(e.data);
      renderQuotaSnapshot(snap);
    } catch {}
  });

  sse.addEventListener("records", () => {
    fetchSummary();
    fetchHourlyStats();

    // 若處於第 1 頁，直接自動更新；若在後續頁面，顯示提示列避免視圖跳動
    if (currentPage === 1) {
      fetchHistory();
    } else {
      const noticeBanner = document.getElementById("new-records-notification");
      if (noticeBanner) {
        noticeBanner.style.display = "flex";
      }
    }
  });

  sse.onerror = () => {
    if (statusEl) {
      statusEl.textContent = "重新連線中...";
      statusEl.className = "status-badge connecting";
    }
  };
}

function escapeCsvField(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes("\"") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

// 匯出 CSV 功能 (連動當前搜尋模型與標準 RFC 4180 格式)
async function exportCsv() {
  try {
    let url = "/api/history?limit=5000";
    if (currentFilterModel) {
      url += `&model=${encodeURIComponent(currentFilterModel)}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    if (!data.records || data.records.length === 0) {
      alert("目前查無符合條件之消耗紀錄");
      return;
    }

    const headers = ["時間", "模型", "總Token", "輸入Token", "快取Token", "輸出Token", "推理Token", "週配額快照", "SessionID"];
    const rows = data.records.map((r) => [
      escapeCsvField(r.datetime),
      escapeCsvField(r.model),
      escapeCsvField(r.totalTokens),
      escapeCsvField(r.inputTokens),
      escapeCsvField(r.cachedInputTokens),
      escapeCsvField(r.outputTokens),
      escapeCsvField(r.reasoningOutputTokens),
      escapeCsvField(r.weeklyUsedPct ?? ""),
      escapeCsvField(r.sessionId)
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", downloadUrl);

    const modelSuffix = currentFilterModel ? `_${currentFilterModel.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `codex_token_usage${modelSuffix}_${dateStr}.csv`);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    alert(`匯出失敗: ${err.message}`);
  }
}

// 初始化綁定
document.addEventListener("DOMContentLoaded", () => {
  fetchQuota();
  fetchSummary();
  fetchHourlyStats();
  fetchHistory();
  setupSse();

  // 每一秒鐘更新客戶端倒數計時
  setInterval(tickCountdown, 1000);

  document.getElementById("btn-refresh").addEventListener("click", () => {
    fetchQuota(true);
    fetchSummary();
    fetchHourlyStats();
    fetchHistory();
  });

  document.getElementById("btn-export-csv").addEventListener("click", exportCsv);

  const modelInput = document.getElementById("filter-model");
  let debounceTimer;
  modelInput.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentFilterModel = e.target.value.trim();
      currentPage = 1;
      fetchHistory();
    }, 300);
  });

  const noticeBanner = document.getElementById("new-records-notification");
  const loadNewBtn = document.getElementById("btn-load-new-records");
  if (loadNewBtn && noticeBanner) {
    loadNewBtn.addEventListener("click", () => {
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
