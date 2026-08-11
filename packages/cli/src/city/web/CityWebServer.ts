/** City Web 本地 BFF：管理受管 Agent，并桥接 Agent Session 对话。 */

import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { CityWebBinding, CityWebOptions } from "@/city/types/CityWeb.js";
import { list_registered_agents_for_cli } from "@/city/agent/AgentSelection.js";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import { startCommand } from "@/city/agent/Start.js";
import { stopCommand } from "@/city/agent/Stop.js";
import { restartCommand } from "@/city/agent/Restart.js";
import { createRemoteAgent, getOrCreateRemoteSession, listRemoteChatSessions } from "@/city/agent/AgentChatRemote.js";

const ASSET_ROOT = fileURLToPath(new URL("../cityman/", import.meta.url));

class CityWebHttpError extends Error { constructor(public readonly status: number, message: string) { super(message); } }

/** 启动 City Web Server。 */
export async function start_city_web_server(options: CityWebOptions): Promise<CityWebBinding> {
  assert_loopback_host(options.host);
  const session_token = randomBytes(32).toString("base64url");
  const server = createServer(async (request, response) => {
    try { await handle_request(request, response, session_token); }
    catch (error) { send_json(response, error instanceof CityWebHttpError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) }); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port, options.host, () => { server.off("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("无法读取 city web 的监听地址。"); }
  const browser_host = options.host === "::1" ? "[::1]" : options.host;
  return { url: `http://${browser_host}:${address.port}`, close: async () => await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function handle_request(request: IncomingMessage, response: ServerResponse, session_token: string): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    assert_api_request(request, session_token);
    if (method === "GET" && url.pathname === "/api/context") return send_json(response, 200, { authenticated: true, city_name: "local" });
    if (method === "GET" && url.pathname === "/api/agents") return send_json(response, 200, { agents: await list_registered_agents_for_cli() });
    const match = url.pathname.match(/^\/api\/agents\/([^/]+)(?:\/(.*))?$/u);
    if (!match) return send_json(response, 404, { error: "API not found" });
    const agent_id = decodeURIComponent(match[1]);
    const action = match[2] ?? "";
    const target = await resolve_cli_agent_target(agent_id);
    if (method === "POST" && ["start", "stop", "restart"].includes(action)) {
      if (action === "start") await startCommand(target, {});
      if (action === "stop") await stopCommand(target);
      if (action === "restart") await restartCommand(target, {});
      return send_json(response, 200, { success: true, agents: await list_registered_agents_for_cli() });
    }
    const remote_agent = await createRemoteAgent({ agent_id });
    if (method === "GET" && action === "sessions") return send_json(response, 200, { sessions: await listRemoteChatSessions({ remote_agent }) });
    if (method === "POST" && action === "sessions") {
      const body = await read_json_body(request);
      const session_id = String(body.session_id ?? "").trim() || `city-web-${Date.now()}`;
      const session = await remote_agent.sessions.create({ session_id });
      return send_json(response, 201, { session_id: session.id });
    }
    const session_match = action.match(/^sessions\/([^/]+)\/messages$/u);
    if (method === "GET" && session_match) {
      const session = await getOrCreateRemoteSession({ remote_agent, session_id: decodeURIComponent(session_match[1]) });
      return send_json(response, 200, await session.messages());
    }
    const execute_match = action.match(/^sessions\/([^/]+)\/execute$/u);
    if (method === "POST" && execute_match) {
      const body = await read_json_body(request);
      const instructions = String(body.instructions ?? "").trim();
      if (!instructions) throw new CityWebHttpError(400, "instructions is required");
      const session = await getOrCreateRemoteSession({ remote_agent, session_id: decodeURIComponent(execute_match[1]) });
      const turn = await session.prompt({ query: instructions });
      const result = await turn.finished;
      return send_json(response, 200, { success: result.success, text: result.text, ...(result.error ? { error: result.error } : {}) });
    }
    const stop_match = action.match(/^sessions\/([^/]+)\/stop$/u);
    if (method === "POST" && stop_match) {
      const session = await getOrCreateRemoteSession({ remote_agent, session_id: decodeURIComponent(stop_match[1]) });
      return send_json(response, 200, await session.stop());
    }
    const respond_match = action.match(/^sessions\/([^/]+)\/respond$/u);
    if (method === "POST" && respond_match) {
      const body = await read_json_body(request);
      const interaction_id = String(body.interaction_id ?? "").trim();
      if (!interaction_id || !body.response || typeof body.response !== "object") {
        throw new CityWebHttpError(400, "interaction_id and response are required");
      }
      const session = await getOrCreateRemoteSession({ remote_agent, session_id: decodeURIComponent(respond_match[1]) });
      return send_json(response, 200, await session.respond({ interaction_id, response: body.response as Parameters<typeof session.respond>[0]["response"] }));
    }
    const events_match = action.match(/^sessions\/([^/]+)\/events$/u);
    if (method === "GET" && events_match) {
      const session = await getOrCreateRemoteSession({ remote_agent, session_id: decodeURIComponent(events_match[1]) });
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();
      response.write(": connected\n\n");
      const unsubscribe = session.subscribe((mutation) => {
        response.write(`data: ${JSON.stringify(mutation)}\n\n`);
      });
      const close_stream = () => { unsubscribe(); response.end(); };
      request.once("close", close_stream);
      response.once("close", unsubscribe);
      return;
    }
    return send_json(response, 404, { error: "API not found" });
  }
  if (method !== "GET" && method !== "HEAD") return send_json(response, 405, { error: "Method not allowed" });
  serve_asset(url.pathname, response, method === "HEAD", session_token);
}

function assert_loopback_host(host: string): void { if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("city web 只允许监听 loopback 地址。"); }
function assert_api_request(request: IncomingMessage, token: string): void { const session_cookie = (request.headers.cookie ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith("city_web_session=")); if (session_cookie !== `city_web_session=${token}`) throw new CityWebHttpError(403, "Invalid local Web session"); const origin = request.headers.origin; if (origin && !origin.startsWith("http://127.0.0.1") && !origin.startsWith("http://localhost") && !origin.startsWith("http://[::1]")) throw new CityWebHttpError(403, "Invalid Origin"); }
function send_json(response: ServerResponse, status: number, payload: unknown): void { response.statusCode = status; response.setHeader("content-type", "application/json; charset=utf-8"); response.setHeader("cache-control", "no-store"); response.end(JSON.stringify(payload)); }
function serve_asset(pathname: string, response: ServerResponse, head_only: boolean, session_token: string): void { const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""); const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/u, ""); let asset = join(ASSET_ROOT, safe); try { if (!statSync(asset).isFile()) asset = join(ASSET_ROOT, "index.html"); } catch { asset = join(ASSET_ROOT, "index.html"); } response.statusCode = 200; response.setHeader("content-type", content_type(asset)); response.setHeader("x-content-type-options", "nosniff"); if (extname(asset) === ".html") response.setHeader("set-cookie", `city_web_session=${session_token}; HttpOnly; SameSite=Strict; Path=/`); if (head_only) response.end(); else createReadStream(asset).pipe(response); }
function content_type(asset_path: string): string { const extension = extname(asset_path); if (extension === ".html") return "text/html; charset=utf-8"; if (extension === ".js") return "text/javascript; charset=utf-8"; if (extension === ".css") return "text/css; charset=utf-8"; if (extension === ".svg") return "image/svg+xml"; if (extension === ".json") return "application/json; charset=utf-8"; return "application/octet-stream"; }
async function read_json_body(request: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
