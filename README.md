# Codex Token & Quota Monitor

把 Codex 配額、Token 歷史與估算成本集中在本機：Web Dashboard、終端機、macOS 懸浮球與 MCP 共用 SQLite 資料。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/a861252012/codex-token-usage-history/actions/workflows/ci.yml/badge.svg)](https://github.com/a861252012/codex-token-usage-history/actions/workflows/ci.yml)

[快速開始](#快速開始) · [操作截圖](#操作截圖) · [常用指令](#常用指令) · [資料與限制](#資料與限制) · [English](#english)

這是社群專案，並非 OpenAI 官方產品。金額是依專案定價表換算的 **API 等值估算**，不是 ChatGPT 訂閱帳單，也不代表實際扣款。

## 操作截圖

以下是實際啟動此專案、以瀏覽器操作後擷取的 PNG，並非設計稿。畫面使用 `bun run demo` 產生的示範紀錄與配額，帳號為 `demo@example.com`；不含真實使用者的帳號或 Session 資料。

### 配額與每日用量

查看五小時／每週視窗、今日 Token、估算成本與主／子代理人用量。右上角可切換英文與正體中文。

![正體中文 Dashboard：配額、每日用量與每日結算](docs/screenshots/dashboard-zh-tw.png)

<details>
<summary>English dashboard</summary>

![English dashboard with sample quota and usage](docs/screenshots/dashboard-en.png)

</details>

### 切換每週報表

點選「每週結算」，比較各週的 Token、估算成本與代理人用量。

![實際點選每週結算後的報表](docs/screenshots/weekly-report.png)

### 篩選 subagent 與匯出 CSV

在頁首篩選卡片選擇「僅 subAgent」，可搭配即時模型搜尋，再按「查看歷史結果」。篩選只影響歷史與 CSV，不影響總覽和結算；「重設條件」可還原全部紀錄。歷史表格的「查看」會開啟完整 Session／Thread／Turn 明細，按 Escape 可關閉。

「匯出 CSV」採用目前篩選條件，最多 5,000 筆。載入時表格顯示骨架列；空結果提供重設操作，失敗則可重試。重新整理與匯出期間會停用按鈕，避免重複送出。本介面沒有刪除或批次異動功能。

![實際選擇 subagent 篩選後的歷史紀錄](docs/screenshots/subagent-history.png)

<details>
<summary>窄視窗顯示（390px）</summary>

<img src="docs/screenshots/dashboard-mobile.png" alt="390px 寬度的 Dashboard，標題與操作列換行顯示" width="390">

這是本機瀏覽器的窄視窗測試；Dashboard 仍僅允許 loopback 連線，並非開放給手機透過區網存取。

</details>

## 快速開始

### 先看示範，不需登入

準備 Bun。原生 HUD／選單列另需 macOS 與 Xcode Command Line Tools（`swiftc`）。

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

開啟 [http://127.0.0.1:10201](http://127.0.0.1:10201)。示範在臨時目錄產生 14 天資料，正常結束時清除；使用 `Ctrl+C` 停止。原生 HUD 不會隨示範啟動。

### 使用自己的 Codex 紀錄

```bash
# 索引 sessions 與 archived_sessions
./bin/codex-usage index --all

# 查看配額與今日用量
./bin/codex-usage status

# 啟動 Web Dashboard
./bin/codex-usage dashboard
```

預設網址為 [http://127.0.0.1:10200](http://127.0.0.1:10200)。配額讀取需要可用的本機 `auth.json`；沒有登入資料時，歷史查詢仍可使用，配額會採快取或 fallback。程式不會替你登入。

不想自動開啟瀏覽器，或預設 port 已被占用：

```bash
./bin/codex-usage dashboard --no-open --port 10202
```

`--port 0` 會讓作業系統分配可用 port，實際網址會印在終端機。停止服務使用 `Ctrl+C`。

### Node.js 路徑

核心也支援具有 `node:sqlite` 的 Node.js。先確認目前執行環境是否支援：

```bash
node -e 'require("node:sqlite"); console.log("SQLite available")'
npm install
npx tsc
node --no-warnings dist/cli/index.js dashboard
```

`bun test` 需要 Bun。`npm run build` 目前也使用 Bun 打包；僅使用 Node.js 時請採 `npx tsc`。本次本機驗證使用 Bun 1.2.17、Node.js 22.14.0 與 Apple Silicon macOS。

## 常用指令

從專案根目錄執行；完成全域捷徑設定後，可將 `./bin/codex-usage` 換成 `codex-usage`。

| 目的 | 指令 |
| --- | --- |
| 配額與今日用量 | `./bin/codex-usage status` |
| 機器可讀狀態 | `./bin/codex-usage status --json` |
| 即時終端監控 | `./bin/codex-usage live` |
| 最近 50 筆紀錄 | `./bin/codex-usage history --limit 50` |
| 子代理人歷史 | `./bin/codex-usage history --role subagent --json` |
| 匯出 CSV | `./bin/codex-usage history --csv --limit 5000` |
| 最近 14 日結算 | `./bin/codex-usage report --period daily --limit 14` |
| 每週／每月／每年結算 | `./bin/codex-usage report --period weekly`（或 `monthly`、`yearly`） |
| 配額重置／方案異動 | `./bin/codex-usage resets` / `./bin/codex-usage plans` |
| 完整重新掃描 | `./bin/codex-usage index --all` |
| 查看／更新定價 | `./bin/codex-usage pricing` / `./bin/codex-usage pricing update` |
| 重算已存歷史的估算成本 | `./bin/codex-usage reprice` |
| Shell 狀態字串 | `./bin/codex-usage prompt` |
| 指令總覽 | `./bin/codex-usage --help` |

`reprice` 會修改歷史估算成本。定價順序是使用者設定 → 社群快取 → 內建值 → fallback。重置與方案異動是程式觀察快照差異後記錄，並非帳號完整稽核紀錄，也不會替你兌換重置券。

## macOS 懸浮球與選單列

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

懸浮球可拖曳；左鍵切換配額、今日 Token 與估算成本；右鍵調整尺寸、顏色與顯示模式。Pro 模式是顯示偏好，不是方案額度保證；實際配額以回傳快照與帳號介面為準。

HUD 編譯預設採目前 CPU 架構，可用 `ARCH=arm64` 或 `ARCH=x86_64` 指定。跨架構執行仍需相容的系統環境。

### 選用：安裝整合

```bash
bash scripts/install.sh
```

此腳本會編譯 TypeScript／Swift、建立 `~/.local/bin/codex-usage` 捷徑、嘗試加入 MCP 設定、索引最近七天資料，並產生 LaunchAgent plist。它不會自動載入 LaunchAgent。請先閱讀 [安裝腳本](scripts/install.sh)，確認這些本機設定變更符合需求。

全域指令找不到時，確認 `~/.local/bin` 已在 `PATH`，或使用專案內的 `./bin/codex-usage`。安裝腳本只建立 `codex-usage` 全域捷徑，HUD 與選單列執行檔位於專案 `bin/`。

## MCP

此專案提供 stdio MCP server。手動整合的設定範例（請換成實際專案絕對路徑）：

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

提供六個工具：`get_codex_quota`、`get_codex_usage_history`、`get_codex_settlement_report`、`get_codex_reset_events`、`get_codex_plan_changes`、`get_codex_pricing_info`。

歷史與結算查詢會先增量索引完整 Session 目錄。首次執行可能較久；後續依檔案修改時間與大小略過未改變的檔案。

## 資料與限制

核心資料路徑預設為 `~/.codex`，可用 `CODEX_HOME` 指定；原生 UI 與安裝腳本部分路徑仍固定使用 `~/.codex`。

| 資料 | 用途 |
| --- | --- |
| `auth.json` | 配額查詢的本機認證來源 |
| `sessions/`、`archived_sessions/` | 本機 JSONL 紀錄 |
| `token_usage_history.sqlite` | 歷史、索引游標與觀察到的事件 |
| `codex_quota_snapshot.json` | 最近配額快照 |
| `pricing.json`、`pricing_cache.json` | 自訂與社群定價 |
| `hud_config.json` | 懸浮球偏好 |

- 索引器目前從 `token_usage_record` 事件取得用量；不保證支援所有 Codex 版本的日誌格式。查不到資料時，先確認來源格式，再執行 `index --all`。
- 主／子代理人歸屬取決於來源 metadata；缺少標記時不能保證辨識完整。
- 配額來自程式使用的 WHAM 端點，端點或認證方式變更可能導致查詢失敗。快取可能已過期；沒有資料不等於無限額度。
- 定價來源可能是自訂、社群、內建或 fallback，不能當成官方最新報價或實際帳單。
- 核心無第三方 runtime npm 套件；開發仍使用 TypeScript 與 Node 型別，截圖工具另需 Playwright。
- 配額查詢會連線至 OpenAI；定價同步會讀取 GitHub 上的 LiteLLM 資料。此工具不是完全離線程式。
- Dashboard 僅監聽 loopback，並檢查 Host／Origin／跨站請求；不要用反向代理將它公開上網。安全政策見 [SECURITY.md](SECURITY.md)。

## 開發與驗證

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
git diff --check
```

GitHub Actions 會執行測試、型別檢查、JS 打包與 Swift 編譯。

### 重拍操作截圖

Playwright 是選用工具，僅用於瀏覽器驗證與 PNG 擷取。準備可由 Node 載入的 `playwright` 套件及 Chromium 後：

```bash
# 終端機 1：啟動示範
bun run demo

# 終端機 2：操作 Dashboard 並擷取畫面
node scripts/capture-screenshots.cjs
```

若 Playwright 裝在獨立工具目錄，可透過 `NODE_PATH` 指向該目錄的 `node_modules`。腳本驗證語系切換、定價標示、每週結算、subagent 篩選、CSV 下載與窄視窗溢位，並更新 `docs/screenshots/`。它使用獨立瀏覽器，不讀取日常瀏覽器的登入狀態。

## English

Codex Token & Quota Monitor is a community-maintained local usage dashboard with CLI, macOS HUD/menu bar, and stdio MCP interfaces. It indexes supported local JSONL events into SQLite and displays quota snapshots, usage history, agent attribution, and estimated API-equivalent costs.

Start with `bun install --frozen-lockfile` and `bun run demo`, then open `http://127.0.0.1:10201`. The screenshots above are actual browser captures of the running application with synthetic demo data. Stop with Ctrl+C.

For your own data, run `./bin/codex-usage index --all`, then `./bin/codex-usage dashboard`. The normal dashboard uses port 10200. Quota requests require readable local authentication; history remains available independently. Native macOS tools require Swift.

Costs are estimates, not subscription bills or authoritative current prices. Log formats and quota endpoints can change. Missing quota data must not be interpreted as unlimited usage. This is not an official OpenAI product.

## License

[MIT](LICENSE).
