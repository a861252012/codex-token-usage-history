import readline from "node:readline";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";

/**
 * 輕量級標準 MCP (Model Context Protocol) 伺服器
 * 透過標準輸入輸出 (stdio) 運作，零外部相依套件，提供 Codex APP 與 CLI 即時查詢工具
 */
export async function runMcpServer(): Promise<void> {
  const db = new HistoryDatabase();
  await db.init();

  const quotaClient = new QuotaClient();
  const indexer = new SessionIndexer(db);

  // 預先執行一次增量索引
  try {
    indexer.indexRecent(1);
  } catch {}

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (response: any) => {
    process.stdout.write(JSON.stringify(response) + "\n");
  };

  rl.on("line", async (line) => {
    if (!line.trim()) return;

    let request: any;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = request;

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
              description: "取得 Codex 目前帳號的即時剩餘額度 (包含五小時短窗口與週用量長窗口及重設倒數時間)",
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
              description: "取得 Codex 的 Token 消耗歷史紀錄與今日使用量統計",
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
      const args = params?.arguments || {};

      if (toolName === "get_codex_quota") {
        try {
          const snapshot = await quotaClient.getQuotaSnapshot(args.force_refresh === true);
          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(snapshot, null, 2),
                },
              ],
            },
          });
        } catch (err: any) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: err.message || "取得配額失敗" },
          });
        }
        return;
      }

      if (toolName === "get_codex_usage_history") {
        try {
          indexer.indexRecent(1);
          const limit = typeof args.limit === "number" ? args.limit : 10;
          const { records, total } = db.queryRecords({ limit, model: args.model });

          const todayMidnight = new Date();
          todayMidnight.setHours(0, 0, 0, 0);
          const todaySummary = db.getSummary(todayMidnight.getTime());

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
        } catch (err: any) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: err.message || "取得消耗歷史失敗" },
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

    // 其他未處理方法回傳方法不存在
    if (id !== undefined) {
      sendResponse({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `未知方法: ${method}` },
      });
    }
  });
}
