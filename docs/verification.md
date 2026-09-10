# Verification / 實測紀錄

[正體中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

## Product trust fixes / PM 審查後修正

2026-09-10：本輪測試對象為 `73e8157` 之後尚未提交的工作目錄，包含程式碼修正，並非只修改文件。下方另保留修正前的歷史紀錄。

採用「分工實作 → 測試 → 獨立審查 → 補修 → 再測」流程。修正內容：

- Web／CLI／HUD／選單列分辨即時、快取、過期與未知；有效視窗不再因 Pro 名稱隱藏。未來時間戳與缺失資料不會顯示健康或無限。
- 非法上游百分比不再轉為 0% 已用／100% 剩餘。無效回應保留舊快取及原因，不當成新成功快照。
- 重置事件只有前後欄位都有證據才比對；`resetCreditsKnown` 區分未提供張數與明確的 0。
- `unknown` 角色與逐筆定價來源／版本；舊成本來源保留未知，強制索引只依來源回填角色，不重算金額。
- 唯讀 `doctor --json`；`index --all --json` 輸出解析診斷；HTTP 診斷端點沿用 Host／Origin 保護。
- Dashboard 診斷只描述本程序最近一輪掃描。CLI 全量掃描是另一個程序，不會把此處 scope 變成 all。
- 定價記憶體快取按資料目錄隔離；不再跨 `CODEX_HOME` 重用。
- 歷史篩選移至歷史表格旁，低頻事件可折疊；CSV 保留定價來源。四種文件語系同步更新。

本輪最終驗證：

| 檢查 | 結果 |
| --- | --- |
| `bun test` | 75 pass、0 fail、465 assertions、19 files |
| `bun run typecheck` / `bun run build` | PASS |
| `bun run build:menubar` / `bun run build:hud` | PASS，Swift 最佳化編譯 |
| `git diff --check` | PASS |
| 四語 README 與本文件 | 本機連結、圖片、anchor、程式碼區塊與共用指令檢查通過 |
| Chromium 操作回歸 | 篩選、週報、明細、CSV、390px 手機版、Skeleton、空狀態、重試、防重複點擊及搜尋競態通過 |
| Firefox 153.0 / Python Playwright 1.62.0 | 1280 × 1800：語系、週報、112 筆 subagent、CSV 112 筆加標題、空狀態重設至 336 筆、快取警告通過 |

瀏覽器使用全新 context 與隔離 Demo。強制更新因無認證而失敗時，仍顯示 `cache`、錯誤原因與警告，不冒充更新成功。Chromium 另以明確攔截的合成回應測試即時成功狀態；不是實際帳號成功連線。最終兩個瀏覽器腳本均 exit 0。

實際操作截圖已更新並檢視：[桌面](screenshots/dashboard-en.png)、[手機](screenshots/dashboard-mobile.png)、[明細](screenshots/record-detail-firefox.png)、[更新失敗與快取警告](screenshots/cache-warning-firefox.png)。圖片全部使用合成資料。

獨立子代理審查後，先前可重現的 P1／P2 阻擋問題已修復。這不是全面無缺陷保證。

本輪未連線真實帳號、未執行真實安裝整合，也未實際操作原生 HUD。原生驗證是 Swift 編譯與回歸檢查，不是視覺互動驗收。尚未 commit／push。

## Baseline verification / 修正前歷史紀錄

Date: **2026-09-10**. Application code tested: `73e8157b82e62314b823c9c843c5a9dd01ad4aa1` (merged PR #2). The checks below describe the earlier baseline, not the current working-tree test count. Screenshots at shared paths may have been refreshed by the later verification.

本紀錄是此次本機實測結果，不是未來版本的通過保證，也不是全面資安稽核。This is a dated local verification, not a full security audit or a guarantee for future versions.

## Environment / 環境

- Apple Silicon macOS, arm64.
- Bun `1.2.17`; Node.js `24.2.0`; Apple Swift `6.3.3`.
- Chromium via the existing Node Playwright screenshot script.
- Firefox `153.0` via Python Playwright `1.62.0`, installed in a task-local virtual environment. No system Python changes or project runtime dependencies added.
- Browser/CLI smoke tests used `bun run demo`: a temporary `CODEX_HOME`, 336 synthetic records including 112 subagent records, cached demo quota, no account credentials.

## Executed checks / 執行結果

| Check | Result / 結果 |
| --- | --- |
| `bun test` | PASS: 40 tests, 219 assertions, 11 files |
| `bun run typecheck` | PASS |
| `bun run build` | PASS: Node-target bundle |
| `bash scripts/build-hud.sh` | PASS: arm64 binary compiled |
| `bash scripts/build-menubar.sh` | PASS: binary compiled |
| `node -e 'require("node:sqlite")'` | PASS; Node emits an experimental-module warning |
| Built Node CLI `status --json` | PASS: valid JSON with snapshot and daily summary |
| Built Node CLI `report --period weekly --json` | PASS: valid JSON with settlements and plan changes |
| Built Node CLI `history --role subagent --limit 2 --json` | PASS: total 112, two returned records, both subagent |

The existing tests cover database permissions, indexing, quota/cache validation, pricing, CLI options, CSV formula protection, HTTP boundaries, MCP input validation, and watcher/subprocess regressions. Passing these checks is not a claim that every security boundary has been audited.

## Chromium workflow / 操作驗證

Executed the repository's [capture script](../scripts/capture-screenshots.cjs) against the demo:

```bash
# Terminal 1
bun run demo

# Terminal 2, with Playwright and Chromium installed
node scripts/capture-screenshots.cjs
```

If the package is installed separately, set `NODE_PATH` to that installation's `node_modules`. The script writes PNGs to `docs/screenshots/`; it uses a fresh browser, not a signed-in browser profile.

Verified:

- Demo account, nonzero usage, chart, and pricing label render.
- English / Traditional Chinese switching preserves pricing metadata and updates tested labels.
- Weekly report and subagent filter work.
- Record details open and close with Escape.
- CSV download succeeds; repeated clicks create only one export request.
- A 390 × 844 viewport has no horizontal page overflow.
- Missing weekly quota displays unavailable, not unlimited.
- Delayed requests show skeleton rows; empty results provide reset; HTTP 500 provides retry.
- Repeated refresh clicks create only one forced quota request.
- A delayed older search does not replace newer results.
- No uncaught page errors.

All five existing README screenshots were regenerated and visually inspected. They are actual application captures with synthetic data.

## Firefox cross-check / 交叉驗證

A separate fresh Firefox context at **1280 × 1800** also passed:

- Account, usage and chart load; language and weekly-report controls work.
- Subagent API result total is 112; returned records all have the selected role.
- Record dialog contains demo Session details and closes with Escape.
- Downloaded CSV contains 112 data rows plus a header, includes `gpt-5.6-terra`, and excludes the main-agent model `gpt-6-astra`.
- An unmatched model search shows the empty state; reset restores 336 records.
- No uncaught page errors.

The first Firefox harness attempt failed because CSP blocked Playwright's `wait_for_function` evaluation. The successful run used locator assertions instead. **Application CSP was not relaxed.** Firefox checks were a separate one-off cross-check; the repository capture script above still runs Chromium.

![Firefox record detail, synthetic data](screenshots/record-detail-firefox.png)

## Not verified / 尚未驗證

- Real-account live quota requests, billing accuracy, current official pricing, and compatibility with every Codex log format.
- Windows, Linux, Intel macOS, Safari/WebKit, and real mobile-device operation.
- Native HUD/menu-bar interaction: compilation passed, but the native apps were not launched or operated in this run.
- Real installation changes, LaunchAgent loading, or MCP registration in a user's configuration. Tests use isolated fixtures; no real user configuration was changed.
- A clean-machine install or every documented CLI option. The Node CLI checks used the Bun-built bundle, not a separately exercised npm-only installation.
- Complete UI translation: some table headers and empty-state text remain English in Traditional Chinese mode. New README languages do not add new UI languages.

請勿把上述未驗證範圍解讀為已通過。Use the dated evidence above, not the presence of a screenshot, to determine what was actually tested.
