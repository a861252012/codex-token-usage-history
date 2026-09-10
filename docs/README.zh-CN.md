# Codex Token & Quota Monitor

[正體中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · **简体中文**

在本地集中查看 Codex 配额、Token 历史与 API 等值估算成本。Web 仪表盘、命令行、macOS 悬浮窗／菜单栏和 stdio MCP 服务共享 SQLite 数据。

这是社区项目，**不是 OpenAI 官方产品**。金额不是订阅账单、实际扣款或官方最新报价。文档提供四种语言；仪表盘界面目前仅支持 **English／繁体中文**，不包含简体中文或日文界面。

## 无需登录，先试用

准备 Bun 后运行：

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

打开[演示页面](http://127.0.0.1:10201)。程序在临时目录生成14天模拟记录与配额，不需要账号凭据。使用 `Ctrl+C` 停止，正常退出时会清理临时数据。演示不会启动原生悬浮窗。

## 实际操作截图

这些图片来自实际运行的应用和浏览器操作，不是设计稿。`demo@example.com` 及全部用量均为模拟数据，不包含真实账号或 Session 信息。

![繁体中文仪表盘](screenshots/dashboard-zh-tw.png)

<details>
<summary>每周报表、subagent 筛选与窄屏显示</summary>

![每周结算报表](screenshots/weekly-report.png)
![筛选后的 subagent 历史](screenshots/subagent-history.png)
<img src="screenshots/dashboard-mobile.png" alt="390px 宽度的仪表盘" width="390">

截图使用繁体中文界面。窄屏测试在本机浏览器中进行，不代表允许手机通过局域网访问。

</details>

## 使用自己的记录

```bash
./bin/codex-usage doctor
./bin/codex-usage index --all --json
./bin/codex-usage dashboard
```

`doctor` 是只读检查：只检查 runtime、SQLite 可用性、数据路径与读取权限，不读取 `auth.json` 内容、不验证登录、不联网，也不建立 `token_usage_history.sqlite`。使用 `doctor --json` 可取得机器可读结果。`index --all --json` 会建立或更新本地索引，并返回本轮诊断；其中数据起止时间仅包含本轮实际成功读取的有效记录，不代表整个数据库的覆盖范围。

打开[仪表盘](http://127.0.0.1:10200)。配额查询需要可读取的本地 `auth.json`，工具不会替你登录。实时配额不可用时，历史仍可查询。界面会标示配额来源、最后成功获取时间与失败原因。只有两分钟内、没有错误的 `wham` 快照会标为实时。缓存或 fallback 不是实时配额；缺少窗口不代表剩余100%或无限额度。

仪表盘的“Dashboard last scan”只显示当前本地服务最近一轮索引：scope、数据目录、最后成功扫描、文件／记录／跳过数量，以及本轮读取的数据区间。它不会沿用另一个 CLI process 的 `index --all --json` 诊断；刷新仪表盘也不会把 scope 改为 `all`。需要保留完整扫描证据时，以该 CLI JSON 输出为准。未变化文件不会重读，因此本轮区间不等于整个数据库的覆盖范围；尚未确认 scope 时，仪表盘不会声称历史数据完整。

如需禁用自动打开浏览器或更换端口，使用 `dashboard --no-open --port 10202`。`--port 0` 由操作系统分配空闲端口，以终端输出的实际地址为准。使用 `Ctrl+C` 停止。

### 页面操作

1. 查看配额窗口、今日 Token 和估算成本。没有配额数据不代表无限额度。
2. 切换每日／每周／每月／每年结算。
3. 在历史区域搜索模型或选择代理角色。筛选**只影响历史与 CSV**，不会改变总览或结算。
4. 点击“查看”打开 Session／Thread／Turn 及已保存定价来源／版本明细，Escape 关闭；“重设条件”恢复全部记录。
5. CSV 使用当前筛选条件，单次最多5,000条，并包含逐条定价来源与版本。请求期间禁用操作按钮；空结果提供引导，失败可重试。没有删除或批量修改功能。
6. 配额重置和套餐变更属于低频区域，默认折叠，需要时再展开。

## 常用命令

从项目根目录运行：

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

结算还支持 `daily`、`monthly`、`yearly`。`index` 与 `reprice` 会修改本地 SQLite，`doctor` 不会。`index --all --force` 会重读来源文件；对既有记录只会在来源具备明确证据时回填未知角色，不会重算已保存成本；`reprice` 才会执行重算。每条新记录会保存实际采用的定价来源与版本，并明确标示 fallback。摘要与结算会从已保存记录显示来源；混用多个来源／版本时标为 `mixed`。无法还原来源的旧记录显示 `unknown`／`unknown`，不会冒充当前定价来源。重置和套餐变更是根据快照差异记录的事件，不是完整账号审计，也不会兑换重置券。

## Node.js 与 macOS 集成

核心也支持带有 `node:sqlite` 的 Node.js。先检查运行环境：

```bash
node -e 'require("node:sqlite"); console.log("SQLite available")'
npm install
npx tsc
node --no-warnings dist/cli/index.js dashboard
```

测试及 `npm run build` 需要 Bun；仅使用 Node 时采用 `npx tsc` 编译。原生界面另需 macOS 与 Xcode Command Line Tools（`swiftc`）：

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

悬浮窗支持拖动；左键切换指标，右键修改偏好。Pro 模式是显示偏好，不是配额保证。原生界面会将缺少的配额窗口显示为“无数据”（orb 显示 `--`），不会代入剩余100%或无限额度。菜单也会显示来源、更新时间与失败原因；cache／fallback／stale 会明确标为非实时。HUD 默认按当前 CPU 架构编译，也可在兼容环境指定 `ARCH=arm64` 或 `ARCH=x86_64`。

可选的 [scripts/install.sh](../scripts/install.sh) 会编译 TypeScript／Swift、建立 `~/.local/bin/codex-usage` 快捷方式、尝试写入 MCP 配置、索引最近七天数据，并生成 LaunchAgent plist。**不会自动加载 LaunchAgent。** 它会修改本地配置，运行前请先阅读脚本；演示不需要安装集成。使用全局快捷方式时，确认 `~/.local/bin` 在 `PATH` 中。

## MCP 配置

将示例替换为实际项目的绝对路径：

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

提供六个工具：`get_codex_quota`、`get_codex_usage_history`、`get_codex_settlement_report`、`get_codex_reset_events`、`get_codex_plan_changes`、`get_codex_pricing_info`。

历史和结算查询前会增量索引完整 Session 目录，首次运行可能较慢。

## 数据、隐私与限制

- 核心默认使用 `~/.codex`，可通过 `CODEX_HOME` 更改；原生界面与安装脚本的部分路径仍固定为 `~/.codex`。
- 输入为 `auth.json`、`sessions/`、`archived_sessions/`。历史存于 `token_usage_history.sqlite`，配额缓存为 `codex_quota_snapshot.json`，价格为 `pricing.json`／`pricing_cache.json`，悬浮窗偏好为 `hud_config.json`。
- 索引器读取支持的 `token_usage_record` 事件，不保证兼容全部 Codex 日志格式。`unsupportedEvents` 是不支持的 envelope event 数，不是文件损坏数；`invalidLines` 或 `invalidRecords` 非零时，其他有效记录仍可能已成功索引。
- 主／子代理角色取决于来源 metadata；证据不足时显示 `unknown`。普通增量索引不会改写旧记录角色。升级后运行 `index --all --force --json`，仅在来源有明确证据时回填角色。
- “Token 记录条数”是记录数，不是外部 API 调用次数。
- 配额通过 WHAM 端点访问 OpenAI，定价同步读取 GitHub 的 LiteLLM 数据，并非完全离线。接口或认证方式可能变化。请同时检查来源、最后成功获取时间与失败原因；只有两分钟内、没有错误的 `wham` 快照算实时。缓存／fallback／缺值不代表剩余100%或无限额度；重置券数量未确认时显示 `—`，不会用0代替。
- 定价优先级为用户配置 → 社区缓存 → 内置值 → fallback。已保存记录保留实际采用的来源与版本；无法还原的旧数据为 `unknown`，fallback 是通用估算。任何来源都不应当作官方最新价格。
- 核心无第三方 runtime npm 依赖；开发使用 TypeScript 与 Node 类型定义，截图工具另外需要 Playwright。
- 服务仅监听 loopback，并检查 Host／Origin／跨站请求。不要通过反向代理公开到互联网。参阅 [SECURITY.md](../SECURITY.md)。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 没有历史 | 先运行 `doctor`，再用 `index --all --json` 检查路径、失败、无效数据与不支持事件。新增0条也可能只是文件未变化。 |
| 旧记录都显示未知角色 | 运行 `index --all --force --json`；只有来源具备明确证据时才会回填角色。 |
| 配额来自缓存或不可用 | 检查来源、最后成功获取时间、失败原因、本地认证与网络。缓存／fallback 不是实时数据；缺值也不是剩余100%或无限额度。 |
| 旧成本来源为 `unknown` | 当时的来源无法可靠还原。仅在需要按当前定价重算时，运行会修改数据的 `reprice`。 |
| 端口被占用 | 使用 `dashboard --port 10202 --no-open` 或 `--port 0`。 |
| 无法加载 `node:sqlite` | 执行上方环境检查，使用兼容的 Node 或 Bun。 |
| 更新后仍是旧画面 | 服务会缓存静态文件；从更新后的项目重启 Dashboard，再刷新页面。 |
| 筛选后总览没变 | 筛选只作用于历史和 CSV，这是预期行为。 |
| CSV 缺少记录 | 单次最多5,000条筛选结果，不是数据库备份。 |
| 手机无法连接 | 服务仅限 loopback，窄屏截图不代表局域网支持。 |

报告问题时附上环境版本、命令、已脱敏的错误与复现步骤。不要上传 `auth.json`、完整数据库或私人日志。

## 开发与验证

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
git diff --check
```

过去实际执行的检查、环境版本与未测试范围见带日期的[验证记录](verification.md)。声明当前 checkout 已通过前，仍应重新运行相应检查。重跑浏览器验证时，先启动 `bun run demo`，再在另一个终端运行 `node scripts/capture-screenshots.cjs`。需准备 Playwright 和 Chromium；独立安装时可用 `NODE_PATH` 指定包路径。脚本会模拟异常，请只对演示服务运行。

修改命令或限制时，请同步维护其他语言文档。[MIT 许可证](../LICENSE)。
