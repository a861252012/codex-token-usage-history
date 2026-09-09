# Codex Token 額度與消耗歷史即時監控系統 (Codex Token Usage History)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-lightgrey.svg)](https://apple.com)
[![Engine: Node.js%20%7C%20Bun](https://img.shields.io/badge/Engine-Node.js%20%7C%20Bun-green.svg)](https://bun.sh)
[![Zero-Dependency](https://img.shields.io/badge/Dependencies-Zero%20NPM-brightgreen.svg)](#架構特色)

本專案專為 MacBook (macOS) 與 Codex 深度開發者設計，提供全方位、低延遲的即時配額監控、Token 消耗流水帳歷史紀錄、官方 API 金額換算與桌面懸浮守護寵物列。無論是在終端機使用 Codex CLI，還是在桌面端使用 Codex APP，都能隨時隨地即時掌握「五小時短週期額度」與「週用量長週期額度」的剩餘比例、重設倒數時間、重置券歷史變動與 subAgent 消耗分離數據。

---

## 核心設計理念與架構哲學

1. **品味 (Good Taste)**:
   - 拒絕在每次請求時暴力掃描數千個 session 檔案。採用增量檔案游標 (mtime + size) 與 SQLite 索引快取，初次掃描 8,000+ 筆紀錄僅需約 4 秒，後續增量檢查小於 15 毫秒。
   - 零外部 npm 套件依賴：直接利用 Node.js 22+ 內建 `node:sqlite` 與 Bun 原生引擎，以標準原生 API 打造純粹、穩定的工具鏈。
2. **絕不破壞使用者空間 (Never Break Userspace)**:
   - 對現有 `~/.codex/config.toml` 與登入驗證機制完全向下相容，所有設定皆採安全補充模式並預先自動備份。
   - 具備離線快取韌性：即便 OpenAI 配額 API 發生網路逾時或速率限制，自動退守本機快取與 session 歷史，系統絕不中斷。
   - 平滑資料庫移轉：自動偵測並平滑升級既有 SQLite 資料庫欄位，避免舊版升級時發生欄位缺失錯誤。
3. **實用主義與極簡標準 (Pragmatism)**:
   - 一套高效率資料核心，五種終端呈現：
     1. 原生置頂懸浮寵物列 (Desktop Companion HUD)
     2. MacBook 原生 Menu Bar 狀態列
     3. CLI 互動式動態 TUI 監控與多週期結算指令
     4. Codex 原生對話 MCP 工具
     5. 內建 Web 即時視覺化儀表板 (Server-Sent Events)

---

## 系統架構

```
+---------------------------------------------------------------------------------------+
|                                  資料核心層 (Core)                                    |
|  - QuotaClient: 直連 OpenAI WHAM API，自動比對並記錄配額重置事件與重置券增減           |
|  - PricingCalculator: 官方模型計費標準對照表，精確換算每筆請求之等值美元費用 (USD)    |
|  - HistoryDatabase: SQLite WAL 模式儲存每筆請求、subAgent 標記、USD 金額與重置歷史   |
|  - SessionIndexer: 增量掃描 ~/.codex/sessions/**/*.jsonl，分離主代理人與 subAgent 紀錄 |
|  - SessionWatcher: 監聽最新對話寫入，在 Token 產生時即時廣播推播事件                  |
+---------------------------------------------------------------------------------------+
                                           |
       +--------------------+--------------+--------------+--------------------+
       |                    |                             |                    |
       v                    v                             v                    v
[置頂懸浮寵物列]     [MacBook 狀態列]             [Codex CLI 工具]        [Codex APP / 對話]
- 原生 Swift 編譯     - 原生 Cocoa 編譯             - codex-usage status   - 標準 MCP 伺服器
- Always-on-Top 置頂 - 駐留於 macOS 狀態列         - codex-usage live     - 支援對話查詢配額、
- 活力情緒/進食跳動  - [5h: 100% | 7d: 60%]        - codex-usage report   - 查詢歷史、結算報表
- 點選切換視野資訊   - 下拉檢視倒數與消耗          - codex-usage resets   - 與重置券變動歷史
                                           |
                                           v
                                 [Web 即時儀表板]
                                 - http://127.0.0.1:10200
                                 - SSE 即時推播、等值美元換算
                                 - 多週期結算表 (日/週/月/年)、CSV 匯出
```

---

## 一鍵快速安裝

本專案提供一鍵編譯與設定腳本，自動完成 TypeScript 模組編譯、Swift 原生執行檔編譯、MCP 伺服器註冊與指令捷徑配置：

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
./scripts/install.sh
```

安裝完成後，全域指令 `codex-usage`、`codex-menubar` 與 `codex-hud` 即刻生效。

---

## 功能展示與操作指南

### 1. 桌面置頂懸浮守護寵物列 (`codex-usage hud`)

宛如桌面上的 Codex 小寵物，具備活力情緒反應與 Token 進食動畫：

```bash
# 啟動置頂懸浮寵物列
codex-usage hud
```

- **置頂顯示 (Always-on-Top)**：懸浮於所有全螢幕編輯器或 IDE 之上，半透明毛玻璃膠囊設計。
- **活力狀態 (Mood System)**：
  - [活力飽滿] (綠色)：五小時與週用量充沛 (剩餘 > 50%)。
  - [穩定運作] (藍色)：正常消耗中。
  - [感到飢餓] (黃色)：額度偏低 (剩餘 <= 20%)，提醒適度調節對話。
  - [極度疲憊] (紅色)：額度即將耗盡 (剩餘 <= 10%)。
- **進食動畫反應**：每當 Codex 產生 Token 消耗時，懸浮列即時跳動並顯示綠色「正在進食 +XXk」，隨後恢復常態。
- **點擊視野切換**：點擊膠囊本體即可在「即時配額視野 (5h/週用量剩餘)」與「今日戰報視野 (總 Token 與等值金額)」之間無縫切換。
- **自由拖曳安放**：可按住拖曳至螢幕任意角落，並隨時點選右上角關閉。

### 2. 終端機即時概覽 (`codex-usage status`)

執行 `codex-usage` 或 `codex-usage status`，顯示格式化配額圖表、今日累計與等值美元金額：

```bash
codex-usage
```

輸出範例：
```
==============================================================================
Codex 即時配額狀態監控 (來源: 官方 API)
==============================================================================
  帳號身份      : developer@example.com (方案: prolite)

  五小時配額    : [░░░░░░░░░░░░░░░░░░░░] 0% 已用 (剩餘 100%) | 重設倒數: 5小時 0分
  週用量配額    : [████████░░░░░░░░░░░░] 40% 已用 (剩餘 60%) | 重設倒數: 5天 23小時
  重設信用額度  : 1 次可用
==============================================================================

本日 Token 消耗統計 (從 00:00 起算)
------------------------------------------------------------------------------
  總計請求次數  : 1,024 次
  總計 Token 消耗: 152,859,559 tokens
  輸入 / 快取   : 152,660,058 / 148,723,584 (快取)
  輸出 / 推理   : 199,501 / 9,818 (推理)
  等值美元花費  : $37.420 USD (官方 API 定價換算)
  代理人分佈    : 主代理人 132,100,000 / subAgent 20,759,559 tokens
  過去1小時燃燒 : 13,632,767 tokens/hr (真實滾動視窗)
==============================================================================
```

### 3. 多週期 Token 與費用結算報表 (`codex-usage report`)

支援多週期結算體系，精確統計每日、每週、每月、每年之 Token 消耗、subAgent 佔比與等值美金：

```bash
# 查看每日結算報表 (預設最近 14 天)
codex-usage report --period daily --limit 14

# 查看每週結算報表
codex-usage report --period weekly --limit 8

# 查看每月結算報表
codex-usage report --period monthly --limit 12

# 查看每年結算報表
codex-usage report --period yearly

# 匯出 JSON 格式以利自動化分析
codex-usage report --period daily --json
```

### 4. OpenAI 配額重置與重置券變動歷史 (`codex-usage resets`)

自動監控並記錄 OpenAI 不定期配額歸零重置事件、週期重置以及重置券 (Reset Credits) 發放與消耗歷程：

```bash
codex-usage resets --limit 20
```

輸出範例：
```
OpenAI 配額重置與重置券變動歷史紀錄 (最新 3 筆):
------------------------------------------------------------------------------------
發生時間 (UTC+8)     事件類型          可用券數  券數變動  說明                      
------------------------------------------------------------------------------------
2026-09-08 14:00:00  credit_received          1        +1  收到 OpenAI 配額重置券    
2026-09-08 09:15:22  periodic_reset           0         0  五小時時間視窗配額重置    
2026-09-07 00:00:10  periodic_reset           0         0  週用量時間視窗滾動重置    
------------------------------------------------------------------------------------
```

### 5. 終端機全螢幕動態儀表板 (`codex-usage live`)

在專屬終端機分頁中即時監看：

```bash
codex-usage live
```

- 原地重繪技術 (No-Flicker)，每 1 秒精確更新倒數計時。
- 當 Codex APP 或 CLI 產生新請求時，底層流水帳自動滾動更新。
- 快速鍵：按 `r` 強制向伺服器重新整理，按 `q` 退出。

### 6. MacBook 原生 Menu Bar 狀態列 (`bin/codex-menubar`)

純 Swift 編譯之 macOS 原生選單列應用，記憶體佔用極小 (<15MB)：

```bash
./bin/codex-menubar &
```

- 狀態列標題即時顯示: `[5h: 100% | 7d: 60%]`。
- 支援額度告急警報標籤 (`[!]`)。
- 下拉選單提供五小時倒數、週用量倒數、重置券數量與今日統計。

### 7. Web 即時可視化儀表板 (`codex-usage serve`)

啟動內建 HTTP 與 Server-Sent Events (SSE) 伺服器：

```bash
codex-usage serve --port 10200 --open
```

瀏覽器開啟 `http://127.0.0.1:10200` 即可檢視：
- 動態配額卡片與健康狀態評估。
- 過去 24 小時 Token 燃燒趨勢直方圖 (純 SVG 繪製，無外部圖表庫)。
- 多週期結算報表頁籤 (日/週/月/年切換)。
- 配額重置與重置券歷史事件專區。
- subAgent 篩選與 RFC 4180 標準 CSV 匯出。

### 8. Codex APP 原生對話支援 (MCP 整合)

一鍵安裝時已自動於 `~/.codex/config.toml` 配置 `codex_token_usage` MCP 伺服器。支援之工具清單：

1. `get_codex_quota`: 查詢即時剩餘配額、倒數時間與重置券數量。
2. `get_codex_usage_history`: 查詢消耗流水帳，支援模型篩選與 subAgent 分離。
3. `get_codex_settlement_report`: 取得多週期 (日/週/月/年) 結算報表與等值美金。
4. `get_codex_reset_events`: 查詢 OpenAI 配額重置歷史與重置券紀錄。

在對話中可直接輸入：
- 「請幫我查詢目前五小時額度與週用量剩餘百分比。」
- 「顯示我過去一週的每日 Token 消耗與等值 API 費用結算報表。」
- 「查詢最近是否有收到 OpenAI 的配額重置券？」

---

## 專案目錄結構

```
codex-token-usage-history/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions 自動化建置與測試工作流程
├── bin/
│   ├── codex-usage              # CLI 主要進入點 (POSIX 腳本)
│   ├── codex-menubar            # MacBook 原生狀態列 Mach-O 二進位檔
│   └── codex-hud                # 原生置頂懸浮守護寵物列 Mach-O 二進位檔
├── src/
│   ├── core/
│   │   ├── types.ts             # 核心資料結構與雙向向下相容型別定義
│   │   ├── quota-client.ts      # 直連 WHAM API 與自動重置事件偵測
│   │   ├── pricing-calculator.ts# 官方 API 定價表與美元金額換算模組
│   │   ├── sqlite-adapter.ts    # 跨 Node / Bun 輕量 SQLite 配接器
│   │   ├── history-db.ts        # 資料庫存取層 (多週期結算、重置事件、無 SELECT *)
│   │   ├── session-indexer.ts   # 增量 Session 掃描器與 subAgent 標記
│   │   └── session-watcher.ts   # 即時目錄監聽與輪詢管理器
│   ├── cli/
│   │   ├── index.ts             # CLI 命令分派器 (status, live, report, resets, hud)
│   │   ├── formatters.ts        # 終端機格式化、結算報表與重置表格排版
│   │   └── live-monitor.ts      # 動態全螢幕 TUI 監控畫面
│   ├── server/
│   │   └── app.ts               # HTTP 與 SSE 伺服器端點實作
│   ├── mcp/
│   │   └── server.ts            # 標準 Model Context Protocol 伺服器 (stdio)
│   ├── menubar/
│   │   └── main.swift           # 原生 Cocoa 選單列程式碼
│   ├── floating-hud/
│   │   └── main.swift           # 原生置頂懸浮寵物列程式碼 (活力情緒反應)
│   └── web/
│       ├── index.html           # 現代深色簡約儀表板 HTML
│       ├── app.js               # 前端業務邏輯 (多週期切換、SSE 監聽、CSV 匯出)
│       └── style.css            # 原生科技感深色樣式表
├── scripts/
│   ├── install.sh               # 一鍵完整編譯、安裝與整合流程
│   ├── build-menubar.sh         # 狀態列程式編譯腳本
│   ├── build-hud.sh             # 懸浮守護寵物列編譯腳本
│   └── setup-codex-hook.sh      # 全域指令與 MCP 自動配置腳本
├── CONTRIBUTING.md              # 社群貢獻指南 (嚴格架構品味與編碼規範)
├── SECURITY.md                  # 安全政策指南 (零外部遙測、機敏金鑰政策)
├── LICENSE                      # MIT 開源授權條款
└── package.json
```

---

## 授權條款 (License)

本專案採用 [MIT 授權條款](LICENSE) 進行開放原始碼發佈，版權所有 (c) 2026 a861252012。歡迎自由使用、修改與整合。
