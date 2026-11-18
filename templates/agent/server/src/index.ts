#!/usr/bin/env node
/** 最小全栈 Agent 服务：City 唯一持有 Agent、Workspace 和持久存储，使用官方 HTTP transport。 */
import { resolve } from "node:path";
import { homedir } from "node:os";
import { create_openai_compatible_model } from "@downcity/federation";
import { Agent, City, LocalStorageProvider, Workspace } from "@downcity/city";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const api_key = process.env.DEEPSEEK_API_KEY?.trim();
const port = Number(process.env.PORT || 5314);
if (!api_key) throw new Error("Configure DEEPSEEK_API_KEY in templates/agent/.env");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const workspace = new Workspace({ id: "default", path: resolve(process.env.AGENT_WORKSPACE_PATH || "../../..") });
const agent = new Agent({
  id: "template-agent",
  model: create_openai_compatible_model({ id: "deepseek-chat", upstream_model: "deepseek-chat", base_url: "https://api.deepseek.com/v1", api_key }),
  instruction: "你是一个简洁、可靠的项目助手。",
});
const web_router = new Hono();
const browser_origin = `http://127.0.0.1:${port}`;
const allowed_origins = new Set([browser_origin, "http://127.0.0.1:5174"]);
/** 本机单用户示例的来源门禁；部署为多用户产品时宿主必须按登录主体隔离 Agent 与 Session。 */
function allow_request(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return allowed_origins.has(origin);
  return request.headers.get("sec-fetch-site") !== "cross-site";
}
const city = new City({
  agents: [agent], workspaces: [workspace],
  storage: new LocalStorageProvider(resolve(process.env.AGENT_STORAGE_PATH || `${homedir()}/.downcity-template-agent`)),
  runtime: { http: {
    authorize_agent: ({ request }) => allow_request(request),
    create_agent_extension: ({ sdk_router }) => ({ router: sdk_router }),
    city_router: web_router,
  } },
});
// 重新启动时恢复同一 Agent 的最近 Web Session，避免每次启动创建新历史。
const sessions = await agent.sessions.list({ category: "chat", workspace_id: workspace.id, limit: 1 });
const session = sessions.items[0]
  ? await agent.sessions.get(sessions.items[0].session_id, "chat", { workspace })
  : await agent.sessions.create({ workspace, origin: { category: "chat", type: "chat" } });
web_router.get("/api/chat", context => {
  if (!allow_request(context.req.raw)) return context.json({ error: "Access denied" }, 403);
  return context.json({ session_id: session.id, category: "chat", agent_url: "/agents/template-agent/workspaces/default" });
});
web_router.use("/*", serveStatic({ root: "../web/dist" }));
web_router.get("/*", serveStatic({ path: "../web/dist/index.html" }));
await city.http({ host: "127.0.0.1", port });
console.log(`Agent Web: ${browser_origin}`);
/** City 统一关闭传输、Agent 与 Workspace，不留下订阅或执行资源。 */
const shutdown = () => { void city.close().catch(error => { console.error(error); process.exitCode = 1; }); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
