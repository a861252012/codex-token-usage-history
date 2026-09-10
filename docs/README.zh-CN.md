# Codex Token & Quota Monitor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

在本地查看 Codex 配额、Token 历史与估算成本。支持 Web 仪表盘、CLI、macOS 悬浮窗／菜单栏和 MCP。

[正體中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

## 操作截图

以下使用演示数据。界面支持英文和繁体中文。

![Dashboard](screenshots/dashboard-zh-tw.png)

<details>
<summary>周报、历史明细与窄屏</summary>

![Weekly report](screenshots/weekly-report.png)
![History](screenshots/subagent-history.png)
![Record detail](screenshots/record-detail-firefox.png)
<img src="screenshots/dashboard-mobile.png" alt="Dashboard 390px" width="390">

</details>

## 快速开始

需要 Bun。先启动演示：

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

打开 [http://127.0.0.1:10201](http://127.0.0.1:10201) · Ctrl+C

### 读取自己的 Codex 记录

```bash
./bin/codex-usage dashboard
```
服务启动时自动导入完整历史，之后增量更新，无需先执行索引命令。

打开 [http://127.0.0.1:10200](http://127.0.0.1:10200)

默认读取 `~/.codex`；核心可通过 `CODEX_HOME` 指定目录。配额查询需要本地 `auth.json`，历史查询不需要实时配额。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 只读环境诊断 | `./bin/codex-usage doctor`（或 `doctor --json`） |
| 配额与今日用量 | `./bin/codex-usage status --json` |
| 实时终端监控 | `./bin/codex-usage live` |
| 最近50条记录 | `./bin/codex-usage history --limit 50` |
| subagent 历史 | `./bin/codex-usage history --role subagent --json` |
| 未知角色历史 | `./bin/codex-usage history --role unknown --json` |
| 导出 CSV | `./bin/codex-usage history --csv --limit 5000` |
| 每周结算 | `./bin/codex-usage report --period weekly` |
| 观察到的重置／套餐变更 | `./bin/codex-usage resets` / `./bin/codex-usage plans` |
| 完整扫描与诊断 | `./bin/codex-usage index --all --json` |
| 强制重读旧文件 | `./bin/codex-usage index --all --force --json` |
| 查看／更新定价 | `./bin/codex-usage pricing` / `./bin/codex-usage pricing update` |
| 重算已保存的估算成本 | `./bin/codex-usage reprice` |
| Shell 状态／帮助 | `./bin/codex-usage prompt` / `./bin/codex-usage --help` |

## macOS

需要 Xcode Command Line Tools。悬浮窗可拖动，左键切换指标，右键调整设置。
右键勾选“登录时自动启动”，下次登录 Mac 就会打开；再次点击可取消。移动项目后请重新勾选。
Dashboard 的悬浮球设置可调整更新间隔：默认 5 秒，仅限 1～300 的整数，最迟于下一轮更新生效。

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

可选安装：`bash scripts/install.sh`。会创建全局快捷方式、尝试加入 MCP 配置并生成 LaunchAgent plist，不会自动加载 LaunchAgent。

<details>
<summary>Node.js</summary>

需要支持 `node:sqlite` 的 Node.js；测试与 Bun 打包仍需要 Bun。

```bash
node -e 'require("node:sqlite")'
npm install
npx tsc
node --no-warnings dist/cli/index.js dashboard
```

</details>

## MCP

将路径替换为项目的绝对路径：

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

`get_codex_quota` · `get_codex_usage_history` · `get_codex_settlement_report` · `get_codex_reset_events` · `get_codex_plan_changes` · `get_codex_pricing_info`

## 使用说明

- 金额为 API 等值估算；每条记录保留定价来源与版本。
- 历史筛选只影响表格与 CSV，单次最多导出 5000 条。
- 角色证据不足时显示 `unknown`；`index --all --force --json` 可重读来源补全。`reprice` 会重算已存成本。
- 配额标示来源、更新时间与错误；扫描诊断仅代表该进程最近一轮结果。
- 仪表盘仅供本机访问。原生界面与安装脚本的部分路径固定为 `~/.codex`。

## 开发

```bash
bun test
bun run typecheck
bun run build
```
