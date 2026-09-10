# Codex Token & Quota Monitor

[正體中文](../README.md) · **English** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

A local dashboard for Codex quota snapshots, token history, and estimated API-equivalent costs. The CLI, web dashboard, macOS HUD/menu bar, and stdio MCP server share SQLite data.

This is a community project, **not an official OpenAI product**. Estimates are not subscription bills, actual charges, or authoritative current prices. Documentation is available in four languages; the dashboard UI supports **English and Traditional Chinese only**.

## Try it without signing in

Install Bun, then run:

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

Open [the demo](http://127.0.0.1:10201). It generates 14 days of synthetic records and quota snapshots in a temporary directory without account credentials. Stop with `Ctrl+C`; normal shutdown removes the temporary data. The native HUD is not launched.

## Actual screenshots

These are browser captures of the running application, not mockups. All account and usage data are synthetic (`demo@example.com`).

![English dashboard](screenshots/dashboard-en.png)

<details>
<summary>Weekly report, filtered history, and narrow viewport</summary>

![Weekly report](screenshots/weekly-report.png)
![Subagent history](screenshots/subagent-history.png)
<img src="screenshots/dashboard-mobile.png" alt="Dashboard at a 390px viewport" width="390">

The additional screenshots use the Traditional Chinese UI. The narrow viewport is a local browser test, not LAN access from a phone.

</details>

## Use your own history

```bash
./bin/codex-usage doctor
./bin/codex-usage index --all --json
./bin/codex-usage dashboard
```

`doctor` is read-only: it checks the runtime, SQLite availability, data paths, and read permissions without reading `auth.json` contents, verifying sign-in, contacting the network, or creating `token_usage_history.sqlite`. Use `doctor --json` for machine-readable output. `index --all --json` creates or updates the local index and reports diagnostics for that run. Its data start/end cover only valid records successfully read during that run, not the whole database.

Open [the dashboard](http://127.0.0.1:10200). Quota requests need readable local authentication in `auth.json`; the tool does not sign you in. History can be queried without live quota access. The UI identifies the quota source, last successful retrieval time, and failure reason. Only an error-free `wham` snapshot from the last two minutes is labeled live. Cached or fallback data is not live; missing windows do not mean 100% remaining or unlimited quota.

The **Dashboard last scan** panel shows only the local server's most recent indexing operation: its scope, data directory, last successful scan, file/record/skip counts, and range read in that run. It does not inherit diagnostics from a separate `index --all --json` CLI process, and refreshing the dashboard does not change its scope to `all`; keep the CLI JSON output as evidence of a full scan. Unchanged files are not reread, so a per-run range is not whole-database coverage. The dashboard does not claim complete history while scope is unconfirmed.

Use `dashboard --no-open --port 10202` for another port, or `--port 0` to let the OS allocate one. Read the actual URL in the terminal. Stop with `Ctrl+C`.

### Dashboard workflow

1. Check quota windows and today's tokens. Missing quota means unavailable, not unlimited.
2. Switch daily/weekly/monthly/yearly settlement reports.
3. In the history section, search the model name or select an agent role. Filters affect **history and CSV only**, not summary or settlement totals.
4. Open a record with **View** for Session/Thread/Turn and stored pricing source/version details; close with Escape. Reset filters to restore all records.
5. Export the filtered results as CSV, including per-record pricing source/version, up to 5,000 records. Loading disables the action button. Empty states offer guidance; failed requests offer retry. There are no delete or bulk mutation actions.
6. Quota reset and plan transition tables are low-frequency sections and are collapsed by default; expand them when needed.

## CLI reference

Run from the repository root:

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

Reports also accept `daily`, `monthly`, and `yearly`. `index` and `reprice` change local SQLite; `doctor` does not. `index --all --force` rereads source files; for existing records, it only backfills unknown roles from clear source evidence and does not recalculate stored costs. `reprice` performs that recalculation. Each new record stores the pricing source and version actually used, and fallback pricing is labeled explicitly. Summaries and settlements derive provenance from the stored records and show `mixed` when more than one source/version is present. Legacy records whose source cannot be reconstructed show `unknown` / `unknown` rather than the current pricing source. Reset and plan events are observed snapshot differences, not a complete account audit; this tool never redeems reset credits.

## Runtime and macOS integration

The core also supports Node.js with `node:sqlite`. Check support before using the Node route:

```bash
node -e 'require("node:sqlite"); console.log("SQLite available")'
npm install
npx tsc
node --no-warnings dist/cli/index.js dashboard
```

Tests and `npm run build` require Bun; for a Node-only compile use `npx tsc`. Native tools require macOS and Xcode Command Line Tools (`swiftc`):

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

Drag the HUD to move it; left-click changes the metric and right-click opens preferences. Pro mode is a display preference, not a quota guarantee. Native views show missing quota windows as unavailable (`--` in the orb), never as 100% remaining or unlimited. Their menus also expose source, update time, and any failure reason; cache/fallback/stale states are marked as not live. HUD compilation defaults to the current CPU architecture; override with `ARCH=arm64` or `ARCH=x86_64` only on a compatible setup.

Optional: read [scripts/install.sh](../scripts/install.sh) before running it. It compiles TypeScript/Swift, creates `~/.local/bin/codex-usage`, attempts MCP configuration, indexes seven days, and creates a LaunchAgent plist. It **does not load the LaunchAgent automatically**. This changes local configuration and is not needed for the demo. Add `~/.local/bin` to `PATH` if using the shortcut.

## MCP integration

Replace the example with your actual absolute repository path:

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

Tools: `get_codex_quota`, `get_codex_usage_history`, `get_codex_settlement_report`, `get_codex_reset_events`, `get_codex_plan_changes`, `get_codex_pricing_info`.

History and settlement queries incrementally index all session directories first; initial indexing can take longer.

## Data, privacy, and limitations

- Core data defaults to `~/.codex`; override with `CODEX_HOME`. Some native UI and installer paths still use `~/.codex` directly.
- Inputs: `auth.json`, `sessions/`, and `archived_sessions/`. History/cache: `token_usage_history.sqlite`, `codex_quota_snapshot.json`; pricing: `pricing.json`, `pricing_cache.json`; HUD preferences: `hud_config.json`.
- The indexer reads supported `token_usage_record` events, not every possible Codex log format. `unsupportedEvents` counts unsupported envelope events, not corrupt files; nonzero `invalidLines` or `invalidRecords` can coexist with successfully indexed valid records.
- Agent attribution depends on metadata; insufficient evidence is labeled `unknown`. Normal incremental indexing does not rewrite legacy roles. After upgrading, run `index --all --force --json`; it backfills a role only when the source provides clear evidence.
- “Token records” is a record count, not a count of external API calls.
- Quota requests use a WHAM endpoint and contact OpenAI; pricing sync reads LiteLLM data on GitHub. This is not entirely offline. Endpoints and authentication may change. Check source, last successful retrieval time, and failure reason; only an error-free `wham` snapshot from the last two minutes is live. Cached/fallback or missing data is not 100% remaining or unlimited. Unknown reset-credit counts display `—`, not zero.
- Pricing precedence: user configuration → community cache → built-in values → fallback. Stored records retain their actual pricing source/version; unreconstructable legacy provenance is `unknown`, and fallback is a generic estimate. None should be assumed to be a current official quote.
- The core has no third-party runtime npm dependencies; development uses TypeScript and Node types. Screenshot tooling additionally requires Playwright.
- The server only listens on loopback and validates Host/Origin/cross-site requests. Do not expose it publicly through a reverse proxy. See [SECURITY.md](../SECURITY.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Empty history | Run `doctor`, then inspect `index --all --json` for paths, failures, invalid data, and unsupported events. Zero inserted records can simply mean files were unchanged. |
| Legacy records all have unknown roles | Run `index --all --force --json`; roles are backfilled only when the source has clear evidence. |
| Cached / unavailable quota | Check source, last successful retrieval time, failure reason, local authentication, and connectivity. Cached/fallback data is not live; missing is not 100% remaining or unlimited. |
| Legacy cost source is `unknown` | The historical source cannot be reconstructed reliably. Run the mutating `reprice` command only if you intend to recalculate with current pricing. |
| Port in use | Use `dashboard --port 10202 --no-open`, or `--port 0`. |
| Missing `node:sqlite` | Run the runtime check above; use a compatible Node version or Bun. |
| Old UI after updating | Restart the dashboard from the updated checkout, then reload; the server caches static assets. |
| Totals unchanged after filtering | Only history and CSV are filtered; this is expected. |
| Incomplete CSV | Export is capped at 5,000 filtered records, not a database backup. |
| Phone cannot connect | Loopback only; the narrow-viewport screenshot does not imply LAN support. |

Report runtime versions, commands, redacted errors, and reproduction steps. Never upload `auth.json`, a full database, or private logs.

## Development and verification

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
git diff --check
```

See the [dated verification record](verification.md) for historical executed checks, environment versions, and untested boundaries. Rerun the relevant checks before claiming that the current checkout passes. To reproduce browser tests and screenshots, start `bun run demo`, then run `node scripts/capture-screenshots.cjs` in another terminal with Playwright and Chromium available. Use `NODE_PATH` if Playwright is installed separately. This script simulates failures; run it only against the demo.

Keep all language documents synchronized when changing commands or limitations. [MIT license](../LICENSE).
