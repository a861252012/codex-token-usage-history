# Codex Token & Quota Monitor

在本機查看 Codex 配額、Token 歷史與估算成本。支援 Web Dashboard、CLI、macOS 懸浮球／選單列與 MCP。

正體中文 · [English](docs/README.en.md) · [日本語](docs/README.ja.md) · [简体中文](docs/README.zh-CN.md)

## 操作截圖

以下使用 Demo 資料。介面支援英文與正體中文。

![Dashboard](docs/screenshots/dashboard-zh-tw.png)

<details>
<summary>週報、歷史明細與窄螢幕</summary>

![Weekly report](docs/screenshots/weekly-report.png)
![History](docs/screenshots/subagent-history.png)
![Record detail](docs/screenshots/record-detail-firefox.png)
<img src="docs/screenshots/dashboard-mobile.png" alt="Dashboard 390px" width="390">

</details>

## 快速開始

需要 Bun。先啟動示範：

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

開啟 [http://127.0.0.1:10201](http://127.0.0.1:10201) · Ctrl+C

### 讀取自己的 Codex 紀錄

```bash
./bin/codex-usage doctor
./bin/codex-usage index --all --json
./bin/codex-usage dashboard
```

開啟 [http://127.0.0.1:10200](http://127.0.0.1:10200)

預設讀取 `~/.codex`；核心可用 `CODEX_HOME` 指定目錄。配額查詢需要本機 `auth.json`，歷史查詢不需即時配額。

## 常用指令

| 目的 | 指令 |
| --- | --- |
| 唯讀環境診斷 | `./bin/codex-usage doctor`（或 `doctor --json`） |
| 配額與今日用量 | `./bin/codex-usage status` |
| 機器可讀狀態 | `./bin/codex-usage status --json` |
| 即時終端監控 | `./bin/codex-usage live` |
| 最近 50 筆紀錄 | `./bin/codex-usage history --limit 50` |
| 子代理人歷史 | `./bin/codex-usage history --role subagent --json` |
| 未知角色歷史 | `./bin/codex-usage history --role unknown --json` |
| 匯出 CSV | `./bin/codex-usage history --csv --limit 5000` |
| 最近 14 日結算 | `./bin/codex-usage report --period daily --limit 14` |
| 每週／每月／每年結算 | `./bin/codex-usage report --period weekly`（或 `monthly`、`yearly`） |
| 配額重置／方案異動 | `./bin/codex-usage resets` / `./bin/codex-usage plans` |
| 完整掃描與診斷 | `./bin/codex-usage index --all --json` |
| 強制重讀舊檔 | `./bin/codex-usage index --all --force --json` |
| 查看／更新定價 | `./bin/codex-usage pricing` / `./bin/codex-usage pricing update` |
| 重算已存歷史的估算成本 | `./bin/codex-usage reprice` |
| Shell 狀態字串 | `./bin/codex-usage prompt` |
| 指令總覽 | `./bin/codex-usage --help` |

## macOS

需 Xcode Command Line Tools。懸浮球可拖曳，左鍵切換指標，右鍵調整設定。

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

選用安裝：`bash scripts/install.sh`。會建立全域捷徑、嘗試加入 MCP 設定並產生 LaunchAgent plist；不會自動載入 LaunchAgent。

<details>
<summary>Node.js</summary>

需支援 `node:sqlite` 的 Node.js；測試與 Bun 打包仍需 Bun。

```bash
node -e 'require("node:sqlite")'
npm install
npx tsc
node --no-warnings dist/cli/index.js dashboard
```

</details>

## MCP

將路徑換成專案的絕對路徑：

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

`get_codex_quota` · `get_codex_usage_history` · `get_codex_settlement_report` · `get_codex_reset_events` · `get_codex_plan_changes` · `get_codex_pricing_info`

## 使用注意

- 金額為 API 等值估算；每筆紀錄保留定價來源與版本。
- 歷史篩選只影響表格與 CSV，單次匯出最多 5000 筆。
- 角色證據不足時顯示 `unknown`；`index --all --force --json` 可重讀來源補齊。`reprice` 會重算已存成本。
- 配額會標示來源、更新時間與錯誤；掃描診斷僅代表該程序最近一輪結果。
- Dashboard 僅供本機存取。原生 UI 與安裝腳本部分路徑固定為 `~/.codex`。

## 疑難排解

- 沒有歷史：執行 `doctor`，再用 `index --all --json` 查看診斷。
- 連接埠被占用：加上 `--port 10202 --no-open`。
- 更新後仍是舊畫面：重啟 Dashboard，再重新整理瀏覽器。

## 開發

```bash
bun test
bun run typecheck
bun run build
```

重拍截圖：啟動 `bun run demo`，再執行 `node scripts/capture-screenshots.cjs`（需 Playwright 與 Chromium）。

[測試紀錄](docs/verification.md) · [安全政策](SECURITY.md) · [MIT](LICENSE)
