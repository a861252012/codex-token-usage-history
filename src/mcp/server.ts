import readline from "node:readline";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";

/**
 * 輕量級標準 MCP (Model Context Protocol) 伺服器
 * 透過標準輸入輸出 (stdio) 運作，零外部相依套件，提供 Codex APP 與 CLI 即時查詢工具
 */
export async function runMcpServer(): Promise<void> {
  const database = new HistoryDatabase();
  await database.init();
  const quotaClient = new QuotaClient(undefined, database);

  const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (responsePayload: any) => {
    process.stdout.write(JSON.stringify(responsePayload) + "\n");
  };

  readlineInterface.on("line", async (inputLine) => {
    if (!inputLine.trim()) return;

    let jsonRpcRequest: any;
    try {
      jsonRpcRequest = JSON.parse(inputLine);
    } catch {
      return;
    }

    const { id, method, params } = jsonRpcRequest;

    // 1. 初始化方法
    if (method === "initialize") {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "codex-token-usage-mcp",
            version: "1.0.0",
          },
          capabilities: {
            tools: {},
          },
        },
      });
      return;
    }

    if (method === "notifications/initialized") {
      return;
    }

    // 2. 列出可用工具
    if (method === "tools/list") {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "get_codex_quota",
              description: "取得 Codex 目前帳號的即時剩餘額度 (包含五小時短週期與週用量長週期視窗、重置券數量及重設倒數時間)",
              inputSchema: {
                type: "object",
                properties: {
                  force_refresh: {
                    type: "boolean",
                    description: "是否強制向 OpenAI 配額端點即時重新整理 (預設為 false 使用快取)",
                  },
                },
              },
            },
            {
              name: "get_codex_usage_history",
              description: "取得 Codex 的 Token 消耗歷史紀錄與今日使用量統計 (包含主程式與 subAgent 分離資料及 USD 換算金額)",
              inputSchema: {
                type: "object",
                properties: {
                  limit: {
                    type: "number",
                    description: "回傳紀錄筆數上限 (預設 10)",
                  },
                  model: {
                    type: "string",
                    description: "指定模型名稱篩選 (選填)",
                  },
                  agent_role: {
                    type: "string",
                    description: "代理人角色篩選 (main 或 subagent，選填)",
                  },
                },
              },
            },
            {
              name: "get_codex_settlement_report",
              description: "取得 Token 消耗與官方 API 美元金額的多週期結算報表 (支援 daily、weekly、monthly、yearly)",
              inputSchema: {
                type: "object",
                properties: {
                  period: {
                    type: "string",
                    enum: ["daily", "weekly", "monthly", "yearly"],
                    description: "結算週期類型 (預設 daily)",
                  },
                  limit: {
                    type: "number",
                    description: "回傳之週期筆數上限 (預設 14)",
                  },
                },
              },
            },
            {
              name: "get_codex_reset_events",
              description: "查詢 OpenAI 配額重置事件與重置券發送/使用歷史紀錄",
              inputSchema: {
                type: "object",
                properties: {
                  limit: {
                    type: "number",
                    description: "回傳紀錄筆數上限 (預設 20)",
                  },
                },
              },
            },
            {
              name: "get_codex_plan_changes",
              description: "查詢 OpenAI 帳號方案變更歷程 (升級/降級記錄)",
              inputSchema: {
                type: "object",
                properties: {
                  limit: {
                    type: "number",
                    description: "回傳紀錄筆數上限 (預設 20)",
                  },
                },
              },
            },
          ],
        },
      });
      return;
    }

    // 3. 執行工具呼叫
    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArguments = params?.arguments || {};

      if (toolName === "get_codex_quota") {
        try {
          const quotaSnapshot = await quotaClient.getQuotaSnapshot(toolArguments.force_refresh === true);
          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(quotaSnapshot, null, 2),
                },
              ],
            },
          });
        } catch (caughtError: any) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: caughtError.message || "取得配額失敗" },
          });
        }
        return;
      }

      if (toolName === "get_codex_usage_history") {
        try {
          const recordLimit = typeof toolArguments.limit === "number" ? toolArguments.limit : 10;
          const { records, total } = database.queryRecords({
            limit: recordLimit,
            model: toolArguments.model,
            agentRole: toolArguments.agent_role,
          });

          const todayMidnight = new Date();
          todayMidnight.setHours(0, 0, 0, 0);
          const todaySummary = database.getSummary(todayMidnight.getTime());

          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    todaySummary,
                    recentRecordsTotal: total,
                    records,
                  }, null, 2),
                },
              ],
            },
          });
        } catch (caughtError: any) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: caughtError.message || "取得消耗歷史失敗" },
          });
        }
        return;
      }

      if (toolName === "get_codex_settlement_report") {
        try {
          const settlementPeriod = toolArguments.period === "weekly" || toolArguments.period === "monthly" || toolArguments.period === "yearly"
            ? toolArguments.period
            : "daily";
          const periodLimit = typeof toolArguments.limit === "number" ? toolArguments.limit : 14;
          const settlementRecords = database.getSettlementRecords(settlementPeriod, periodLimit);
          const planChanges = database.getPlanChangeEvents(10);

          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    period: settlementPeriod,
                    count: settlementRecords.length,
                    records: settlementRecords,
                    planChanges,
                  }, null, 2),
                },
              ],
            },
          });
        } catch (caughtError: any) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: caughtError.message || "取得結算報表失敗" },
          });
        }
        return;
      }

      if (toolName === "get_codex_reset_events") {
        try {
          const eventLimit = typeof toolArguments.limit === "number" ? toolArguments.limit : 20;
          const resetEvents = database.getResetEvents(eventLimit);

          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    count: resetEvents.length,
                    events: resetEvents,
                  }, null, 2),
                },
              ],
            },
          });
        } catch (caughtError: any) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: caughtError.message || "取得配額重置紀錄失敗" },
          });
        }
        return;
      }

      if (toolName === "get_codex_plan_changes") {
        try {
          const planLimit = typeof toolArguments.limit === "number" ? toolArguments.limit : 20;
          const planChanges = database.getPlanChangeEvents(planLimit);

          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    count: planChanges.length,
                    planChanges,
                  }, null, 2),
                },
              ],
            },
          });
        } catch (caughtError: any) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: caughtError.message || "取得方案調整歷程失敗" },
          });
        }
        return;
      }

      sendResponse({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `未知工具: ${toolName}` },
      });
      return;
    }

    if (id !== undefined) {
      sendResponse({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `未知方法: ${method}` },
      });
    }
  });
}
