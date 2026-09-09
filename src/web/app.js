// Codex 額度與 Token 消耗即時監控前端邏輯
let currentPage = 1;
const pageSize = 25;
let totalHistoryRecords = 0;
let currentFilterModel = "";

function formatNum(n) {
  return (n || 0).toLocaleString("en-US");
}

function getProgressColor(pct) {
  if (pct >= 90) return "var(--color-red)";
  if (pct >= 70) return "var(--color-yellow)";
  return "var(--color-green)";
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
  if (textReset) textReset.textContent = win.resetCountdown || "—";

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
      addList.innerHTML = snap.additionalLimits.map(add => {
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
    const s = await res.json();

    document.getElementById("text-today-tokens").textContent = formatNum(s.totalTokens);
    document.getElementById("text-today-input").textContent = `${formatNum(s.inputTokens)} / ${formatNum(s.cachedInputTokens)}`;
    document.getElementById("text-today-output").textContent = `${formatNum(s.outputTokens)} / ${formatNum(s.reasoningOutputTokens)}`;
    document.getElementById("text-today-requests").textContent = `${formatNum(s.requests)} 次`;
    document.getElementById("text-today-burn-rate").textContent = `${formatNum(s.hourlyBurnRate)} / hr`;

    // 渲染模型分佈條
    const container = document.getElementById("model-bars-container");
    if (container && s.byModel) {
      if (s.byModel.length === 0) {
        container.innerHTML = `<div style="color: var(--text-secondary); font-size: 13px;">本日尚無模型消耗紀錄</div>`;
      } else {
        const maxTokens = Math.max(...s.byModel.map(m => m.totalTokens), 1);
        container.innerHTML = s.byModel.map(m => {
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

    tbody.innerHTML = data.records.map(r => {
      const timeStr = r.datetime ? r.datetime.replace("T", " ").slice(0, 19) : "—";
      const weeklyQuota = r.weeklyUsedPct !== null && r.weeklyUsedPct !== undefined
        ? `${r.weeklyUsedPct}%`
        : "—";
      const shortId = r.sessionId ? r.sessionId.slice(0, 8) + "..." : "—";

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
    fetchHistory();
  });

  sse.onerror = () => {
    if (statusEl) {
      statusEl.textContent = "重新連線中...";
      statusEl.className = "status-badge connecting";
    }
  };
}

// 匯出 CSV 功能
async function exportCsv() {
  try {
    const res = await fetch("/api/history?limit=1000");
    const data = await res.json();
    if (!data.records || data.records.length === 0) {
      alert("目前尚無可匯出的紀錄");
      return;
    }

    const headers = ["時間", "模型", "總Token", "輸入Token", "快取Token", "輸出Token", "推理Token", "週配額快照", "SessionID"];
    const rows = data.records.map(r => [
      `"${r.datetime}"`,
      `"${r.model}"`,
      r.totalTokens,
      r.inputTokens,
      r.cachedInputTokens,
      r.outputTokens,
      r.reasoningOutputTokens,
      r.weeklyUsedPct ?? "",
      `"${r.sessionId}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `codex_token_usage_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert("匯出失敗: " + err.message);
  }
}

// 初始化綁定
document.addEventListener("DOMContentLoaded", () => {
  fetchQuota();
  fetchSummary();
  fetchHistory();
  setupSse();

  document.getElementById("btn-refresh").addEventListener("click", () => {
    fetchQuota(true);
    fetchSummary();
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
