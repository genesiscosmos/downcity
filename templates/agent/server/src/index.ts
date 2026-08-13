#!/usr/bin/env node

/**
 * React 对话应用的 Agent 服务端。
 *
 * 服务端唯一拥有 Agent、Workspace 与 Session；Web 只通过精简的对话接口
 * 读取历史并追加消息，不接触 Node runtime 或模型密钥。
 */

import { resolve } from "node:path";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  Agent,
  Workspace,
  type SessionMessage,
} from "@downcity/agent";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type {
  ChatErrorResponse,
  ChatMessage,
  ChatResponse,
  SendChatMessageRequest,
} from "../../types/chat.js";

const session_id = "web-chat";
const api_key = process.env.DEEPSEEK_API_KEY?.trim();
const port = Number(process.env.PORT || 5314);
const workspace_path = resolve(
  process.env.AGENT_WORKSPACE_PATH?.trim() || "../../..",
);

if (!api_key) {
  throw new Error("请在 templates/agent/.env 中配置 DEEPSEEK_API_KEY");
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT 必须是有效端口");
}

const deepseek = createDeepSeek({ apiKey: api_key });
const agent = new Agent({
  id: "template-agent",
  workspace: new Workspace({ path: workspace_path }),
  model: deepseek("deepseek-chat"),
  instruction: "你是一个简洁、可靠的项目助手。",
});

/** 恢复固定 Web Session，不存在时首次创建。 */
async function get_session() {
  try {
    return await agent.sessions.get(session_id);
  } catch {
    return await agent.sessions.create({ session_id });
  }
}

/** 把 Session canonical Message 投影为浏览器需要的纯文本消息。 */
function to_chat_message(message: SessionMessage): ChatMessage | undefined {
  if (message.type === "user") {
    const content = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    return content ? {
      id: message.message_id,
      role: "user",
      content,
      created_at: message.created_at,
    } : undefined;
  }

  if (message.type === "assistant") {
    const content = message.parts
      .flatMap((part) => part.type === "text" ? [part.text] : [])
      .join("\n")
      .trim();
    return content ? {
      id: message.message_id,
      role: "assistant",
      content,
      created_at: message.created_at,
    } : undefined;
  }

  if (message.type === "error") {
    return {
      id: message.message_id,
      role: "error",
      content: message.message,
      created_at: message.created_at,
    };
  }

  return undefined;
}

/** 读取当前 Session 的浏览器展示快照。 */
async function read_chat(): Promise<ChatResponse> {
  const page = await (await get_session()).messages();
  return {
    messages: page.items
      .map(to_chat_message)
      .filter((message): message is ChatMessage => Boolean(message)),
  };
}

const app = new Hono();

app.get("/api/chat", async (context) => context.json(await read_chat()));

app.post("/api/chat", async (context) => {
  const body = await context.req.json<SendChatMessageRequest>().catch(() => undefined);
  const content = body?.content?.trim();
  if (!content) {
    return context.json<ChatErrorResponse>({ error: "消息不能为空" }, 400);
  }

  const turn = await (await get_session()).prompt({ query: content });
  const result = await turn.finished;
  if (!result.success) {
    return context.json<ChatErrorResponse>({
      error: result.error || "Agent 执行失败",
    }, 500);
  }

  return context.json(await read_chat());
});

app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ path: "../web/dist/index.html" }));

const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`Agent Web: http://127.0.0.1:${port}`);
console.log(`Workspace: ${workspace_path}`);

/** 关闭 HTTP 与 Agent 独占资源。 */
async function shutdown(): Promise<void> {
  server.close();
  await agent.dispose();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
