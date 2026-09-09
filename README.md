# Codex Token 額度與消耗歷史即時監控系統 (Codex Token Usage History)

本專案專為 MacBook (macOS) 與 Codex 深度使用者設計，提供全方位、低延遲的即時配額監控與 Token 消耗流水帳歷史紀錄。無論是在終端機使用 Codex CLI，還是在桌面端使用 Codex APP，都能隨時隨地實時掌握「五小時短週期額度」與「週用量額度」的剩餘比例與重設倒數時間。

---

## 核心設計理念

1. **品味 (Good Taste)**:
   - 拒絕在每次請求時暴力掃描數千個 session 檔案。採用增量檔案游標 (mtime + size) 與 SQLite 索引快取，初次掃描 8,000+ 筆紀錄僅需 4 秒，後續增量檢查小於 15 毫秒。
   - 零外部 npm 套件依賴：直接利用 Node.js 22+ 內建 `node:sqlite` 與 Bun 原生引擎，以標準原生 API 打造最純粹、最穩定的工具鏈。
2. **絕不破壞使用者空間 (Never Break Userspace)**:
   - 對現有 `~/.codex/config.toml` 與登入驗證機制完全向前相容，所有設定皆採安全補充模式並預先自動備份。
   - 具備離線快取韌性：即便 OpenAI 配額 API 發生連線異常或 429 限制，自動退守本機快取與 session 歷史，系統絕不中斷。
3. **極簡與實用主義 (Pragmatism)**:
   - 一套資料引擎，四種終端呈現：原生 Menu Bar 狀態列、CLI 互動式 TUI、Codex 原生對話 MCP 工具、即時 Web 儀表板。

---

## 系統架構

```
+-----------------------------------------------------------------------------+
|                               資料核心 (Core)                               |
|  - QuotaClient: 直連 OpenAI WHAM API，精確解析 5小時/週用量窗口與重設倒數  |
|  - HistoryDatabase: SQLite 儲存每筆請求之輸入/快取/輸出 Token 與配額快照    |
|  - SessionIndexer: 增量解析 ~/.codex/sessions/**/*.jsonl                     |
|  - SessionWatcher: 監聽最新對話寫入，Token 產生時發布即時事件               |
+-----------------------------------------------------------------------------+
                                       |
       +-------------------------------+-------------------------------+
       |                               |                               |
       v                               v                               v
[MacBook 狀態列]              [Codex CLI 工具]               [Codex APP / 對話]
- 原生 Swift 編譯 (0% CPU)     - codex-usage status          - 註冊 MCP Server
- 置頂於螢幕上方狀態列         - codex-usage live (動態 TUI) - 支援對話直接詢問:
- [5h: 100% | 7d: 60%]         - codex-usage history         「目前剩餘額度」
- 下拉選單顯示重設與消耗       - codex-usage prompt          「今日 Token 消耗」
                                       |
                                       v
                             [Web 即時儀表板]
                             - http://127.0.0.1:10200
                             - Server-Sent Events (SSE) 即時推播
                             - 歷史篩選、模型分佈、CSV 匯出
```

---

## 快速安裝

本專案提供一鍵編譯與設定腳本，自動完成專案編譯、Swift 狀態列編譯、MCP 伺服器註冊與指令捷徑配置：

```bash
cd /Users/a861252012/Desktop/folder/code/codex-token-usage-history
./scripts/install.sh
```

安裝完成後，全域指令 `codex-usage` 與 `codex-menubar` 即刻生效。

---

## 功能使用說明

### 1. 終端機即時檢視 (`codex-usage`)

執行 `codex-usage` 或 `codex-usage status`，立即顯示格式化配額圖表與近期統計：

```bash
codex-usage
```

輸出範例：
```
==============================================================================
Codex 即時配額狀態監控 (來源: 官方 API)
==============================================================================
  帳號身份      : a861252012@gmail.com (方案: prolite)

  五小時配額         : [░░░░░░░░░░░░░░░░░░░░] 0% 已用 (剩餘 100%) | 重設倒數: 5小時 0分
  週用量配額         : [████████░░░░░░░░░░░░] 40% 已用 (剩餘 60%) | 重設倒數: 5天 23小時
  GPT-5.3-Codex-Spark (5h): [░░░░░░░░░░░░░░░░░░░░] 0% 已用 (剩餘 100%) | 重設倒數: 5小時 0分
  GPT-5.3-Codex-Spark (週): [░░░░░░░░░░░░░░░░░░░░] 0% 已用 (剩餘 100%) | 重設倒數: 7天 0小時
  重設信用額度  : 1 次可用
==============================================================================

本日 Token 消耗統計 (從 00:00 起算)
------------------------------------------------------------------------------
  總計請求次數  : 1,024 次
  總計 Token 消耗: 152,859,559 tokens
  輸入 / 快取   : 152,660,058 / 148,723,584 (快取)
  輸出 / 推理   : 199,501 / 9,818 (推理)
  估計每小時燃燒: 13,632,767 tokens/hr
```

### 2. 終端機動態全螢幕監控 (`codex-usage live`)

當你在 MacBook 寫程式時，可開啟一個獨立終端機分頁執行：

```bash
codex-usage live
```

- 即時全螢幕儀表板，每 2 秒自動刷新倒數時間。
- 當 Codex APP 或 CLI 產生任何新對話或執行工具時，即時在底部滾動顯示最新消耗的 Token。
- 鍵盤快速鍵：按 `r` 強制向伺服器刷新配額，按 `q` 退出。

### 3. MacBook 原生 Menu Bar 狀態列圖示 (`codex-menubar`)

執行後將在螢幕右上角狀態列建立原生狀態圖示：

```bash
# 背景執行狀態列程式
/Users/a861252012/Desktop/folder/code/codex-token-usage-history/bin/codex-menubar &
```

- 狀態列直接顯示: `[5h: 100% | 7d: 60%]`。
- 點擊狀態列展開下拉選單，檢視五小時與週用量的詳細重設倒數、本日累計消耗量、一鍵開啟 Web 儀表板。
- 純 Swift 編譯原生 Cocoa 應用，資源佔用近乎 0% CPU。

### 4. Codex APP 與 Codex CLI 原生對話支援 (MCP 整合)

一鍵安裝時已自動在 `~/.codex/config.toml` 中註冊 `codex_token_usage` MCP 伺服器：

```toml
[mcp_servers.codex_token_usage]
command = "/Users/a861252012/Desktop/folder/code/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

在 Codex APP (ChatGPT 桌面版 Codex 模式) 或 `codex` 指令交談中，直接輸入以下問題，AI 將自動呼叫工具回覆真實權威數據：
- 「幫我查一下目前五小時額度跟週用量還剩多少？」
- 「我今天總共消耗了多少 token？」
- 「幫我列出最近 5 筆 token 消耗流水帳」

### 5. 查詢消耗流水帳歷史紀錄 (`codex-usage history`)

支援多種條件查詢、格式化輸出與資料匯出：

```bash
# 查詢最新 50 筆紀錄
codex-usage history --limit 50

# 查詢特定模型的消耗紀錄
codex-usage history --model gpt-6-astra

# 查詢過去 24 小時的紀錄
codex-usage history --since 24h

# 匯出 CSV 檔案
codex-usage history --limit 1000 --csv > codex_usage_export.csv

# 匯出 JSON 格式
codex-usage history --limit 10 --json
```

### 6. Web 即時儀表板 (`codex-usage serve`)

啟動本機視覺化儀表板：

```bash
codex-usage serve --open
```

瀏覽器自動開啟 `http://127.0.0.1:10200`：
- 配額進度條卡片與動態變色 (正常綠色、警示黃色、告急紅色)。
- 精確即時秒數倒數重設時間。
- 各模型 Token 佔比長條圖。
- 支援分頁與即時文字篩選的 Token 消耗流水帳表格。
- 一鍵匯出 CSV 報表。
- 內建 Server-Sent Events (SSE) 即時推播，無須手動重整網頁。

### 7. Shell Prompt (zsh / bash) 整合

在 `~/.zshrc` 或 `~/.bashrc` 中加入以下設定，即可在終端機提示字元隨時顯示當前額度：

```bash
codex_quota_prompt() {
  codex-usage prompt 2>/dev/null
}
RPROMPT="$(codex_quota_prompt) $RPROMPT"
```

---

## 開機自動啟動 (可選)

若希望在 MacBook 開機或登入時自動常駐 Web 儀表板服務：

```bash
launchctl load ~/Library/LaunchAgents/com.codex.token-usage-monitor.plist
```

若欲停止背景常駐：
```bash
launchctl unload ~/Library/LaunchAgents/com.codex.token-usage-monitor.plist
```

---

## 專案目錄結構

```
codex-token-usage-history/
├── bin/
│   ├── codex-usage           # CLI 主要進入點執行檔
│   └── codex-menubar         # MacBook 原生狀態列執行檔
├── src/
│   ├── core/
│   │   ├── types.ts          # 資料型別定義
│   │   ├── quota-client.ts   # 配額 API 客戶端
│   │   ├── sqlite-adapter.ts # 跨 Node / Bun SQLite 配接器
│   │   ├── history-db.ts     # 消耗紀錄 SQLite 資料庫
│   │   ├── session-indexer.ts# 增量 Session 掃描器
│   │   └── session-watcher.ts# 即時 Session 檔案監聽器
│   ├── cli/
│   │   ├── index.ts          # CLI 命令分派器
│   │   ├── formatters.ts     # 終端機格式化排版
│   │   └── live-monitor.ts   # 全螢幕動態 TUI 監控畫面
│   ├── server/
│   │   └── app.ts            # HTTP 與 SSE 伺服器
│   ├── mcp/
│   │   └── server.ts         # 標準 MCP 伺服器
│   ├── menubar/
│   │   └── main.swift        # 原生 Cocoa 狀態列程式碼
│   └── web/
│       ├── index.html        # 儀表板 HTML
│       ├── app.js            # 儀表板 JavaScript
│       └── style.css         # 儀表板樣式表
├── scripts/
│   ├── install.sh            # 一鍵完整安裝流程
│   ├── build-menubar.sh      # 狀態列程式編譯腳本
│   └── setup-codex-hook.sh   # MCP 與環境設定腳本
├── package.json
└── README.md
```
