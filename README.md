# Codex Token & Quota Usage Monitor (`codex-token-usage-history`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-lightgrey.svg)](https://apple.com)
[![Engine: Node.js 22+ / Bun](https://img.shields.io/badge/Engine-Node.js%2022%2B%20%7C%20Bun-green.svg)](https://bun.sh)
[![Zero-Dependency](https://img.shields.io/badge/Dependencies-Zero%20NPM-brightgreen.svg)](#architecture-highlights)
[![OpenAI Open Source Grant Candidate](https://img.shields.io/badge/OpenAI-Open%20Source%20Grant%20Candidate-orange.svg)](#about-the-project)

[English](#overview) | [正體中文說明 (Traditional Chinese)](#正體中文說明-traditional-chinese)

---

## Overview

**Codex Token Usage History** is a high-performance, zero-external-dependency quota monitor, token transaction recorder, multi-period cost accounting engine, and ultra-compact desktop companion HUD designed exclusively for **macOS** and heavy **OpenAI Codex / ChatGPT** power users.

Whether you code inside **Codex CLI**, interact with the **Codex macOS Desktop App**, or automate workflows across autonomous subAgents, this project guarantees **real-time visibility** over your rate limits, remaining allowances, official USD API cost estimations, rate limit reset credit history, and token burn rates—without polling friction or battery drain.

---

## Key Highlights

### 1. Smart Adaptive Quota Engine (Pro Tier vs. Standard Tier)
OpenAI applies different rate limiting tiers: users spending $100+/mo or subscribed to higher-tier Pro plans do not have a 5-hour quota cap.
- **Pro Tier (Auto-Detected)**: Clean, distraction-free display focusing purely on the **7-day rolling window**. Unnecessary "5h: 100%" clutter and redundant status labels are eliminated.
- **Standard Tier**: Simultaneously tracks both the **5-hour burst window** and the **weekly rolling window** with precise countdown timers.
- **Rate Limit Reset Credits & Periodic Reset Tracking**: Automatically detects when OpenAI delivers reset vouchers or triggers periodic quota resets, persisting the timeline in SQLite.

### 2. Ultra-Compact Desktop Companion Orb (Always-on-Top Circular Ring Widget)
A sleek, unobtrusive macOS circular glassmorphism widget (`bin/codex-hud`):
- **Circular Progress Ring**: 56px precision circular orb with smooth `CAShapeLayer` arc progress indicating remaining allowance.
- **Electric Blue Default & Full Custom Palette**: Shipped out of the box in iconic **Electric Blue** (`#0A84FF`), with 7 built-in presets (Cyber Cyan, Emerald Green, Neon Purple, Sunset Amber, Radiant Pink, Pure White) and a native macOS system **Color Picker** for choosing any bespoke hue. Preference is automatically persisted to `~/.codex/hud_config.json`.
- **Pro Tier Perfection**: Clean, distraction-free display focusing purely on the **7-day weekly quota** (e.g. `7d` / `37%`), completely eliminating redundant "5h: 100%" noise. Non-Pro mode displays both 5-hour and 7-day limits compactly.
- **Desktop Pet Feeding Animation**: Spring scale bounce and teal pulse animation displaying `+XXk` tokens fed in real time.
- **Rich Context Menu (Right-Click)**:
  - Detailed quota breakdowns and countdowns.
  - Today's cumulative token usage and estimated USD cost.
  - **Accent Color Selection**: Switch presets, launch the system color picker, or toggle smart red alerts when quota drops below 20%.
  - Instant toggle between Pro Mode (Weekly Only) and Standard Mode (5h + Weekly).
  - One-click launcher for the Web Dashboard.
- **Left-Click Quick View Cycle**: Cycle between Quota %, Today's Tokens, and Today's USD Cost.
- **Freely Draggable**: Position anywhere on your screen as an intelligent desktop companion.

### 3. Comprehensive Accounting & Multi-Period Settlement
- **Daily, Weekly, Monthly, and Yearly Settlement**: Aggregate token volume, requests, top models, and official USD cost calculations across any historical period.
- **SubAgent Attribution**: Explicitly tracks and isolates tokens consumed by background subAgents versus primary interactive threads.
- **Official API Pricing Translation**: Built-in pricing tables covering `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.3-codex-spark`, and legacy models with prompt, cache-hit, and reasoning token weights.

### 4. Zero NPM Dependencies & Superior Performance
- Powered by native **Node.js 22+ (`node:sqlite`)** or **Bun (`bun:sqlite`)** with SQLite WAL mode.
- Incremental file cursor indexing: parses over 8,000+ local session turns in under 4 seconds on initial launch, and under 15ms on subsequent updates.
- Native Swift Mach-O binaries (`bin/codex-hud` and `bin/codex-menubar`) consuming under 15MB RAM and near 0% CPU.

---

## Architecture

```
+---------------------------------------------------------------------------------------+
|                                    Data Core Layer                                    |
|  - QuotaClient: Direct WHAM API client with automated quota reset & voucher detection |
|  - PricingCalculator: Official API pricing weights & token-to-USD conversion          |
|  - HistoryDatabase: SQLite WAL engine with multi-period settlements & zero SELECT *   |
|  - SessionIndexer: Incremental scanner for ~/.codex/sessions/**/*.jsonl with subAgents|
|  - SessionWatcher: Real-time file watcher & event broadcaster                         |
+---------------------------------------------------------------------------------------+
                                           |
                                       +--------------------+--------------+--------------+--------------------+
                                       |                    |                             |                    |
                                       v                    v                             v                    v
                                [Circular Orb HUD]   [macOS Menu Bar]             [Codex CLI Suite]      [Model Context Protocol]
                                - Native Swift Mach-O- Native Cocoa Item          - codex-usage status   - Native MCP Server
                                - Always-on-Top      - [7d: 37%]                  - codex-usage live     - For Codex Desktop App
                                - Circular ring arc  - Detailed drop-down         - codex-usage report   - Direct chat tools
                                - Feeding bounce     - Low RAM usage              - codex-usage resets   - Quota & history
                                - Right-click menu
                                                                                   |
                                                                                   v
                                                                        [Modern Web Dashboard]
                                                                        - Glassmorphism dark UI
                                                                        - EN / 繁中 dual language
                                                                        - Live SSE updates
                                                                        - 24-hour SVG charts
                                                                        - CSV export & breakdowns
```

---

## Getting Started

### Prerequisites

- **macOS** 12.0+ (Apple Silicon or Intel)
- **Node.js** 22.0.0+ (with native `node:sqlite`) or **Bun** 1.1.0+
- **OpenAI Codex CLI** or desktop setup (generating `~/.codex/sessions/**/*.jsonl`)

### One-Line Automated Installation

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bash scripts/install.sh
```

The installer will:
1. Compile the native TypeScript engine for both Bun and Node.js.
2. Compile native macOS Swift Mach-O binaries for Apple Silicon / Intel (`bin/codex-hud`, `bin/codex-menubar`).
3. Automatically configure Model Context Protocol (MCP) in your `~/.codex/config.toml`.
4. Perform an initial lightning-fast scan of historical session files.

Once installed, `codex-usage`, `codex-hud`, and `codex-menubar` are immediately accessible from any terminal.

---

## Terminal & GUI Usage Guide

### 1. Ultra-Compact Desktop Companion Orb (`codex-usage hud`)

Launch the always-on-top circular ring orb widget:

```bash
codex-usage hud
# Or run the compiled Mach-O binary in background:
./bin/codex-hud &
```

- **Default Pro Display**: Displays a 56px circular glassmorphism orb with a circular progress arc and weekly remaining allowance (e.g. `7d` / `37%`).
- **Left-Click View Cycling**: Cycles through remaining percentage, today's total tokens (e.g. `186.7k`), and today's USD cost (e.g. `$0.42`).
- **Right-Click (Context Menu)**:
  - Inspect detailed remaining percentages and countdowns.
  - View today's total request count and USD cost.
  - Switch display mode between Pro Mode (Weekly only) and Standard Mode (5h + Weekly).
  - Open the Web Dashboard in your default browser.

### 2. Instant CLI Overview (`codex-usage status`)

```bash
codex-usage
```

Example Output (Adaptive Pro Tier):
```
==============================================================================
Codex Real-Time Quota Status (Source: Official API)
==============================================================================
  Account       : developer@example.com (Plan: prolite)

  5-Hour Quota  : [Pro Unlimited - Weekly Rolling Cap Applies]
  Weekly Quota  : [█████████████░░░░░░░] 63% used (37% remaining) | Reset: 5d 22h
  Reset Credits : 1 available
==============================================================================

Today's Token Usage (Since 00:00)
------------------------------------------------------------------------------
  Total Requests : 1,252 calls
  Total Tokens   : 186,692,502 tokens
  Input / Cached : 186,436,871 / 182,031,616 (cached)
  Output / Reason: 255,631 / 10,692 (reasoning)
  Estimated Cost : $37.420 USD (Official API Pricing)
  Agent Breakdown: Main 186,692,502 / SubAgent 0 tokens
  Hourly Burn    : 9,382,700 tokens/hr
==============================================================================
```

### 3. Multi-Period Settlement Reports (`codex-usage report`)

Generate multi-period token accounting and USD cost statements:

```bash
# Daily statement (Default: last 14 days)
codex-usage report --period daily --limit 14

# Weekly statement (Last 8 weeks)
codex-usage report --period weekly --limit 8

# Monthly statement (Last 12 months)
codex-usage report --period monthly --limit 12

# Yearly statement
codex-usage report --period yearly

# Export as JSON for scripting/dashboards
codex-usage report --period daily --json
```

### 4. Quota Resets & Voucher History (`codex-usage resets`)

Inspect OpenAI quota reset events and rate limit reset credit transactions:

```bash
codex-usage resets --limit 20
```

### 5. Live Fullscreen Terminal TUI (`codex-usage live`)

```bash
codex-usage live
```

- In-place flicker-free terminal updates.
- Real-time countdown clock ticks every second.
- Live streaming log of incoming turns as you chat with Codex.
- Hotkeys: `r` to force refresh, `q` to quit.

### 6. Shell Prompt Integration (zsh / bash)

Add to `~/.zshrc`:

```bash
codex_quota_prompt() {
  codex-usage prompt 2>/dev/null
}
RPROMPT="$(codex_quota_prompt) $RPROMPT"
```

Pro users will see `[Codex 7d: 37%]`, while standard users will see `[Codex 5h: 100% | 7d: 37%]`.

### 7. Modern Web Dashboard (`codex-usage serve`)

```bash
codex-usage serve --port 10200 --open
```

Visit `http://127.0.0.1:10200`:
- Dark glassmorphism interface with language toggle (**EN / 繁中**).
- Adaptive Pro cards (automatically hides redundant 5h 100% meters for Pro tier).
- 24-hour token burn histogram rendered in pure SVG.
- Interactive multi-period settlement tables.
- RFC 4180-compliant CSV export with subAgent filters.

### 8. Native Codex App & Claude Desktop Integration (MCP)

The installer automatically writes to `~/.codex/config.toml`:

```toml
[mcp_servers.codex_token_usage]
command = "/Users/your-username/.local/bin/codex-usage"
args = ["mcp"]
enabled = true
```

Available Tools:
1. `get_codex_quota`: Real-time remaining quota, countdowns, and reset credits.
2. `get_codex_usage_history`: Filterable transaction log supporting subAgent isolation.
3. `get_codex_settlement_report`: Multi-period financial settlement statements.
4. `get_codex_reset_events`: Timeline of quota reset events and voucher grants.

---

## Project Structure

```
codex-token-usage-history/
├── .github/workflows/ci.yml   # Multi-engine GitHub Actions CI workflow
├── bin/
│   ├── codex-usage            # Main POSIX executable entry point
│   ├── codex-hud              # Modern circular ring orb widget HUD
│   └── codex-menubar          # Native macOS Menu Bar companion
├── src/
│   ├── core/
│   │   ├── types.ts           # Unified DTOs with backwards-compatible aliases
│   │   ├── quota-client.ts    # Direct WHAM API client & reset event detector
│   │   ├── pricing-calculator.ts # Official token pricing matrix & USD conversion
│   │   ├── sqlite-adapter.ts  # Node 22+ / Bun unified SQLite adapter
│   │   ├── history-db.ts      # Multi-period settlements, subAgents, zero SELECT *
│   │   ├── session-indexer.ts # Incremental JSONL parser with subAgent tags
│   │   └── session-watcher.ts # Real-time date-bucketed file watcher
│   ├── cli/
│   │   ├── index.ts           # CLI command router
│   │   ├── formatters.ts      # Terminal formatters & settlement layout
│   │   └── live-monitor.ts    # Dynamic TUI monitor
│   ├── server/app.ts          # HTTP & SSE server implementation
│   ├── mcp/server.ts          # Standard Model Context Protocol server
│   ├── floating-hud/main.swift# Circular ring orb widget with right-click menu
│   ├── menubar/main.swift     # Native Cocoa menu bar application
│   └── web/
│       ├── index.html         # Modern glassmorphism dashboard (EN / 繁中)
│       ├── app.js             # Client logic, i18n dictionaries, SSE listener
│       └── style.css          # Deep midnight sleek dark mode styling
├── scripts/
│   ├── install.sh             # Zero-config automated setup script
│   ├── build-hud.sh           # Swift compiler script for the circular HUD orb
│   ├── build-menubar.sh       # Swift compiler script for the menu bar app
│   └── setup-codex-hook.sh    # MCP & CLI symlink configuration script
├── CONTRIBUTING.md            # Contribution guidelines & coding conventions
├── SECURITY.md                # Security policy & vulnerability disclosures
├── LICENSE                    # MIT License
└── package.json
```

---

## 正體中文說明 (Traditional Chinese)

### 專案特色

1. **極簡圓形環狀進度靈動球 (Always-on-Top Circular Ring Orb HUD)**：
   - 56px × 56px 精緻正圓形毛玻璃 Widget，置頂懸浮於所有視窗之上，擺脫長條扁平外觀。
   - **預設科技藍與自訂色彩**：出廠預設為質感**科技電光藍**（Electric Blue `#0A84FF`），並內建 7 款預設主題色（賽博青藍、翡翠綠、賽博紫、日落橘、亮粉紅、極簡白），更可直接喚起 macOS 原生系統調色盤（Color Picker）自訂任意色彩，偏好設定自動持久化於 `~/.codex/hud_config.json`。
   - **環狀進度條**：以 QuartzCore 繪製順時針動態進度弧線，支援智慧低電量（<20%）轉紅警示切換。
   - **Pro 用戶極致精簡**：自動識別 Pro / 100$+ 方案，僅顯示週用量（例如上方標籤 `7d`，中心數字 `37%`），消除無意義的「5h: 100%」與贅述文字。非 Pro 模式則精巧並列 5h 與 7d。
   - **桌面寵物級進食反饋**：Codex 消耗 Token 時觸發彈性縮放跳動並微光顯示 `+XXk`。
   - **多模式切換與右鍵選單**：左鍵點擊在週配額、今日總 Token、今日美金金額循環切換；右鍵彈出完整配額數據與控制選單。
2. **多週期結算體系 (日/週/月/年)**：
   - 執行 `codex-usage report --period daily|weekly|monthly|yearly` 隨時產生完整的 Token 與官方美金結算報表。
3. **OpenAI 配額重置事件與重置券紀錄**：
   - 自動捕捉週期性重置與重置券（Reset Credits）發送/消耗紀錄，支援 `codex-usage resets` 隨時回溯。
4. **subAgent 消耗分離標記**：
   - 區分主程式與背景 subAgent 的 Token 佔比與花費。
5. **Codex APP 直接對話支援 (MCP)**：
   - 於對話中直接詢問「目前剩餘額度」、「本週消耗結算」等。

---

## License

This project is licensed under the [MIT License](LICENSE) - Copyright (c) 2026 a861252012. All rights reserved.
