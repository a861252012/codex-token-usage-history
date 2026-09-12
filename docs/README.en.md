# Codex Token & Quota Monitor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

Track Codex quota, token history, and estimated costs locally. Includes a web dashboard, CLI, macOS HUD/menu bar, and MCP server.

[正體中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

## Screenshots

Shown with demo data. The UI supports English and Traditional Chinese.

### macOS HUD

Left-click to switch between quota and today’s estimated cost. Right-click to choose the quota display, size, and language.

<img src="screenshots/hud.png" alt="macOS HUD" width="112">

<img src="screenshots/hud-menu-en.png" alt="HUD context menu" width="340">

### Web Dashboard

![Dashboard](screenshots/dashboard-en.png)

<details>
<summary>Weekly report, history, and narrow viewport</summary>

![Weekly report](screenshots/weekly-report.png)
![History](screenshots/subagent-history.png)
![Record detail](screenshots/record-detail-firefox.png)
<img src="screenshots/dashboard-mobile.png" alt="Dashboard 390px" width="390">

</details>

## Quick start

Requires Bun. Start with the demo:

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

Open [http://127.0.0.1:10201](http://127.0.0.1:10201) · Ctrl+C

### Use your Codex history

```bash
./bin/codex-usage dashboard
```
The service imports full history automatically at startup, then updates incrementally. No manual indexing is needed.

Open [http://127.0.0.1:10200](http://127.0.0.1:10200)

Reads `~/.codex` by default; set `CODEX_HOME` to choose the data directory for the CLI, dashboard, and native UI. Quota queries require local `auth.json`; history remains available without live quota.

## Commands

| Purpose | Command |
| --- | --- |
| Read-only environment diagnostics | `./bin/codex-usage doctor` (or `doctor --json`) |
| Quota and daily usage | `./bin/codex-usage status --json` |
| Live terminal view | `./bin/codex-usage live` |
| Recent records | `./bin/codex-usage history --limit 50` |
| Subagent history | `./bin/codex-usage history --role subagent --json` |
| Unknown-role history | `./bin/codex-usage history --role unknown --json` |
| CSV export | `./bin/codex-usage history --csv --limit 5000` |
| Settlement report | `./bin/codex-usage report --period weekly` |
| Observed resets / plan changes | `./bin/codex-usage resets` / `./bin/codex-usage plans` |
| Full scan with diagnostics | `./bin/codex-usage index --all --json` |
| Force reread of legacy files | `./bin/codex-usage index --all --force --json` |
| Inspect / refresh pricing | `./bin/codex-usage pricing` / `./bin/codex-usage pricing update` |
| Recalculate stored estimates | `./bin/codex-usage reprice` |
| Shell status / help | `./bin/codex-usage prompt` / `./bin/codex-usage --help` |

## macOS

Requires Xcode Command Line Tools. Drag the HUD to move it, left-click to switch metrics, and right-click for settings.
Enable “Launch at Login” in the right-click menu to start the HUD at your next login. Click again to disable it; re-enable it after moving the project. This starts only the HUD, not the data refresh service.
Dashboard → HUD settings controls the refresh interval: default 5 seconds, integers from 1 to 300. Changes apply by the next HUD refresh.

The HUD reads local cached data. To keep quota and today’s usage up to date, run this service continuously in one terminal:

```bash
./bin/codex-usage dashboard --no-open
```

Then build and launch the native UI from another terminal:

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

Optional: `bash scripts/install.sh` creates a global shortcut, attempts MCP configuration, and generates a LaunchAgent plist without loading it.

<details>
<summary>Node.js</summary>

Requires Node.js 22.x starting at 22.13, or version 23.4 or later, for `node:sqlite` without extra flags. The full test suite and Bun bundling require Bun; the Node checks below do not.

```bash
node -e 'require("node:sqlite")'
npm install
npx tsc
npm run test:node
node --no-warnings dist/cli/index.js dashboard
```

</details>

## MCP

Replace the path with your project directory:

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

`get_codex_quota` · `get_codex_usage_history` · `get_codex_settlement_report` · `get_codex_reset_events` · `get_codex_plan_changes` · `get_codex_pricing_info`

## Usage notes

- Costs are standard API-equivalent estimates, not subscription bills. Each record retains its pricing source and version. Fast, Batch, Flex, cache-write, and other service-specific rates are not included. Models without verified rates are marked `fallback`; that is not their official price.
- Built-in Astra, Sol, Terra, and Luna pricing applies 2× input/cached-input and 1.5× output rates to the entire record when input, including cached tokens, exceeds 272,000 tokens. Other built-in model rates do not assume this threshold. Custom and community rates use their supplied long-context settings.
- Supports newer `token_usage_record` events and older cumulative `token_count` events; repeated cumulative snapshots are not counted again. Run `index --all --force --json` to import files already scanned by an older version. Roles without evidence remain `unknown`.
- Updating the app or pricing does not automatically recalculate stored records. Run `reprice` yourself to apply new rates to existing data.
- Dashboard history filters apply only to the table and CSV; exports are limited to 5000 records. The CLI `history` and `report` commands cap `--limit` at 10000.
- Quota displays its source, update time, and errors. Scan diagnostics cover only that process’s latest scan.
- The dashboard is local-only. The native UI and dashboard must use the same `CODEX_HOME`; the native UI currently connects to port 10200.

Built-in rates and long-context rules were checked against official model documentation on 2026-09-12: [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) · [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) · [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) · [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) · [GPT-5](https://developers.openai.com/api/docs/models/gpt-5).

## Development

```bash
bun test
bun run typecheck
bun run build
```
