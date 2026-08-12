/**
 * `fed web` 本地 HTTP Server。
 *
 * 关键说明（中文）
 * - Server 是浏览器与远端 Federation 之间的本地 BFF，管理员 Session 永不下发前端。
 * - 只监听 loopback，并用进程级随机 Cookie、Origin 与 Host 三重约束本地 API。
 * - 浏览器只能调用这里显式登记的资源和动作，不能把本地 Server 当成开放代理。
 */

import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { EmbassyAdmin } from "@downcity/federation";
import { login_federation_admin } from "@/federation/auth/admin.js";
import { fetch_dashboard_raw_data } from "@/federation/admin/dashboard/dashboard-data.js";
import { build_dashboard_snapshot } from "@/federation/admin/dashboard/dashboard-metrics.js";
import type { dashboard_range } from "@/federation/types/AdminDashboard.js";
import type {
  FederationWebActionRequest,
  FederationWebBinding,
  FederationWebContext,
  FederationWebOptions,
  FederationWebLoginRequest,
} from "@/federation/types/FederationWeb.js";

const WEB_ASSET_ROOT = fileURLToPath(new URL("../fedman/", import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024;

/** `fed web` 进程内持有的远端管理员会话。 */
interface FederationWebAdminState {
  /** 当前已认证管理 Client。 */
  admin?: EmbassyAdmin;
  /** 仅保存在本地 BFF 内存中的远端 Session Token。 */
  session_token?: string;
  /** 当前登录管理员 ID。 */
  admin_id?: string;
  /** 当前远端 Session 到期时间。 */
  expires_at?: string;
}

/** 带明确 HTTP 状态的本地控制面错误。 */
class FederationWebHttpError extends Error {
  /** 返回给浏览器的 HTTP 状态码。 */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 启动 Federation 本地 Web UI Server。 */
export async function start_federation_web_server(
  context: FederationWebContext,
  options: Pick<FederationWebOptions, "host" | "port">,
): Promise<FederationWebBinding> {
  assert_loopback_host(options.host);
  const session_token = randomBytes(32).toString("base64url");
  const admin_state: FederationWebAdminState = {};

  const server = createServer(async (request, response) => {
    try {
      await handle_request(request, response, admin_state, context, session_token);
    } catch (error) {
      const status = error instanceof FederationWebHttpError
        ? error.status
        : read_http_error_status(error);
      if (status === 401) clear_admin_state(admin_state);
      send_json(response, status, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法读取 fed web 的本地监听地址。");
  }
  const browser_host = options.host === "::1" ? "[::1]" : options.host;
  return {
    url: `http://${browser_host}:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

/** 读取 City HTTP Client 错误携带的状态码。 */
function read_http_error_status(error: unknown): number {
  const status = (error as { status?: unknown } | undefined)?.status;
  return typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
}

async function handle_request(
  request: IncomingMessage,
  response: ServerResponse,
  admin_state: FederationWebAdminState,
  context: FederationWebContext,
  session_token: string,
): Promise<void> {
  const method = request.method ?? "GET";
  const request_url = new URL(request.url ?? "/", "http://localhost");

  if (request_url.pathname.startsWith("/api/")) {
    assert_api_request(request, session_token);
    if (method === "GET" && request_url.pathname === "/api/context") {
      send_json(response, 200, {
        federation_name: context.federation_name,
        federation_url: context.federation_url,
        admin_id: admin_state.admin_id ?? context.admin_id,
        authenticated: Boolean(admin_state.admin && Date.parse(admin_state.expires_at ?? "") > Date.now()),
        expires_at: admin_state.expires_at,
      });
      return;
    }
    if (method === "POST" && request_url.pathname === "/api/auth/login") {
      const body = await read_json_body<FederationWebLoginRequest>(request);
      let session;
      try {
        session = await login_federation_admin({
          base_url: context.federation_url,
          admin_id: required_text(body as unknown as Record<string, unknown>, "admin_id"),
          password: required_text(body as unknown as Record<string, unknown>, "password"),
        });
      } catch (error) {
        throw new FederationWebHttpError(
          401,
          error instanceof Error ? error.message : "管理员登录失败。",
        );
      }
      admin_state.session_token = session.session_token;
      admin_state.admin_id = session.admin_id;
      admin_state.expires_at = session.expires_at;
      admin_state.admin = new EmbassyAdmin({
        federation_url: context.federation_url,
        admin_token: session.session_token,
      });
      send_json(response, 200, {
        authenticated: true,
        admin_id: session.admin_id,
        expires_at: session.expires_at,
      });
      return;
    }
    if (method === "POST" && request_url.pathname === "/api/auth/logout") {
      await logout_remote_admin(context.federation_url, admin_state.session_token);
      clear_admin_state(admin_state);
      send_json(response, 200, { ok: true });
      return;
    }
    const admin = require_admin(admin_state);
    if (method === "GET" && request_url.pathname === "/api/dashboard") {
      const range = parse_dashboard_range(request_url.searchParams.get("range"));
      const raw_data = await fetch_dashboard_raw_data(admin, range);
      send_json(response, 200, build_dashboard_snapshot(raw_data, range));
      return;
    }
    if (method === "GET" && request_url.pathname === "/api/usage/overview") {
      const query = build_usage_admin_query(request_url);
      const [overview, accounts] = await Promise.all([
        admin.service("usage").get<Record<string, unknown>>(`admin/overview?${query}`),
        admin.service("accounts").get<{ items: Array<Record<string, unknown>> }>("users"),
      ]);
      const usage_query = new URLSearchParams(query);
      send_json(response, 200, {
        ...overview,
        total_registered_users: accounts.items.length,
        new_registered_users: count_registered_users(
          accounts.items,
          usage_query.get("from") ?? "",
          usage_query.get("to") ?? "",
          usage_query.get("timezone") ?? "UTC",
        ),
      });
      return;
    }
    if (method === "GET" && request_url.pathname === "/api/usage/users") {
      const query = build_usage_admin_query(request_url);
      const [usage, accounts] = await Promise.all([
        admin.service("usage").get<{ items: Array<Record<string, unknown>> }>(`admin/users?${query}`),
        admin.service("accounts").get<{ items: Array<Record<string, unknown>> }>("users"),
      ]);
      send_json(response, 200, {
        ...usage,
        items: merge_usage_accounts(accounts.items, usage.items),
      });
      return;
    }
    if (method === "GET" && request_url.pathname === "/api/usage/retention") {
      const query = build_usage_admin_query(request_url);
      send_json(
        response,
        200,
        await admin.service("usage").get<Record<string, unknown>>(`admin/retention?${query}`),
      );
      return;
    }
    if (method === "GET" && request_url.pathname.startsWith("/api/resources/")) {
      const resource_id = decodeURIComponent(request_url.pathname.slice("/api/resources/".length));
      send_json(response, 200, { items: await read_resource(admin, resource_id) });
      return;
    }
    if (method === "POST" && request_url.pathname === "/api/actions") {
      const body = await read_json_body<FederationWebActionRequest>(request);
      send_json(response, 200, { result: await run_action(admin, body) });
      return;
    }
    send_json(response, 404, { error: "Local API not found." });
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    send_json(response, 405, { error: "Method not allowed." });
    return;
  }
  serve_asset(request_url.pathname, response, method === "HEAD", session_token);
}

/** 返回当前有效管理 Client，未登录或到期时明确返回 401。 */
function require_admin(admin_state: FederationWebAdminState): EmbassyAdmin {
  if (!admin_state.admin || Date.parse(admin_state.expires_at ?? "") <= Date.now()) {
    clear_admin_state(admin_state);
    throw new FederationWebHttpError(401, "Administrator login required.");
  }
  return admin_state.admin;
}

/** 尽力撤销远端管理会话，本地退出不因网络失败而被阻塞。 */
async function logout_remote_admin(base_url: string, session_token?: string): Promise<void> {
  if (!session_token) return;
  await fetch(`${base_url.replace(/\/+$/gu, "")}/v1/admin/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${session_token}` },
  }).catch(() => undefined);
}

/** 清空 `fed web` 进程内的全部远端管理员会话状态。 */
function clear_admin_state(admin_state: FederationWebAdminState): void {
  admin_state.admin = undefined;
  admin_state.session_token = undefined;
  admin_state.expires_at = undefined;
}

async function read_resource(admin: EmbassyAdmin, resource_id: string): Promise<unknown[]> {
  if (resource_id === "services") return await admin.list_services() as unknown[];
  if (resource_id === "models") return await admin.list_models() as unknown[];
  if (resource_id === "env") return await admin.env.list() as unknown[];
  if (resource_id === "env_catalog") return await admin.env.catalog() as unknown[];
  if (resource_id === "bureaus") return await admin.bureaus.list() as unknown[];
  if (resource_id === "bureau_tokens") return await admin.bureaus.tokens.list() as unknown[];
  if (resource_id === "users") return (await admin.service("accounts").get<{ items: unknown[] }>("users")).items;
  if (resource_id === "sessions") return (await admin.service("accounts").get<{ items: unknown[] }>("sessions")).items;
  if (resource_id === "usage") return (await admin.service("usage").get<{ items: unknown[] }>("events")).items;
  if (resource_id === "payments") return (await admin.service("payment").get<{ items: unknown[] }>("payments")).items;
  if (resource_id === "payment_events") return (await admin.service("payment").get<{ items: unknown[] }>("events")).items;
  if (resource_id === "credits_users") return await admin.credits.list_users({ limit: 200 }) as unknown[];
  if (resource_id === "credits_transactions") return await admin.credits.transactions.list({ limit: 200 }) as unknown[];
  throw new FederationWebHttpError(404, `不支持的 Web UI 资源：${resource_id}`);
}

async function run_action(admin: EmbassyAdmin, request: FederationWebActionRequest): Promise<unknown> {
  const payload = request.payload ?? {};
  if (request.action === "env_upsert") {
    return await admin.env.upsert({ key: required_text(payload, "key"), value: required_text(payload, "value") });
  }
  if (request.action === "env_remove") return await admin.env.remove(required_text(payload, "key"));
  if (request.action === "env_refresh") return await admin.env.refresh();
  if (request.action === "bureau_create") {
    const bureau_id = optional_text(payload, "bureau_id");
    const input = {
      name: required_text(payload, "name"),
      server_url: required_text(payload, "server_url"),
      ...(bureau_id ? { bureau_id } : {}),
    };
    return await admin.bureaus.create(input);
  }
  if (request.action === "bureau_pause") return await admin.bureaus.pause(required_text(payload, "bureau_id"));
  if (request.action === "bureau_activate") return await admin.bureaus.activate(required_text(payload, "bureau_id"));
  if (request.action === "bureau_archive") return await admin.bureaus.archive(required_text(payload, "bureau_id"));
  if (request.action === "service_request") {
    const service_id = required_text(payload, "service_id");
    const path = required_text(payload, "path").replace(/^\/+|\/+$/gu, "");
    const method = required_text(payload, "method").toUpperCase();
    if (method === "GET") return await admin.service(service_id).get(path);
    if (method === "POST") {
      const body = payload.body;
      if (body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body))) {
        throw new TypeError("body 必须是 JSON object。");
      }
      return await admin.service(service_id).action(path).invoke((body ?? {}) as Record<string, unknown>);
    }
    throw new TypeError("service_request 只支持 GET 或 POST。");
  }
  throw new FederationWebHttpError(400, `不支持的 Web UI 动作：${request.action}`);
}

function serve_asset(pathname: string, response: ServerResponse, head_only: boolean, session_token: string): void {
  const requested_path = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safe_path = normalize(requested_path).replace(/^(\.\.(\/|\\|$))+/u, "");
  let asset_path = join(WEB_ASSET_ROOT, safe_path);
  try {
    if (!statSync(asset_path).isFile()) asset_path = join(WEB_ASSET_ROOT, "index.html");
  } catch {
    asset_path = join(WEB_ASSET_ROOT, "index.html");
  }
  response.statusCode = 200;
  response.setHeader("content-type", content_type(asset_path));
  response.setHeader("cache-control", extname(asset_path) === ".html" ? "no-store" : "public, max-age=3600");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-security-policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:");
  response.setHeader("set-cookie", `fed_web_session=${session_token}; HttpOnly; SameSite=Strict; Path=/`);
  if (head_only) {
    response.end();
    return;
  }
  createReadStream(asset_path).pipe(response);
}

function assert_api_request(request: IncomingMessage, session_token: string): void {
  const host = request.headers.host ?? "";
  const origin = request.headers.origin;
  const cookie = request.headers.cookie ?? "";
  if (!cookie.split(";").some((item) => item.trim() === `fed_web_session=${session_token}`)) {
    throw new FederationWebHttpError(403, "Invalid local web session.");
  }
  if (origin && new URL(origin).host !== host) throw new FederationWebHttpError(403, "Invalid request origin.");
  if (!is_loopback_hostname(read_host_name(host))) {
    throw new FederationWebHttpError(403, "Invalid request host.");
  }
}

function read_host_name(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/gu, "");
  } catch {
    return "";
  }
}

function assert_loopback_host(host: string): void {
  if (!is_loopback_hostname(host)) throw new Error("fed web 只允许监听 127.0.0.1、localhost 或 ::1。");
}

function is_loopback_hostname(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parse_dashboard_range(value: string | null): dashboard_range {
  return value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "30d";
}

function build_usage_admin_query(request_url: URL): string {
  const range = parse_dashboard_range(request_url.searchParams.get("range"));
  const timezone = read_timezone(request_url.searchParams.get("timezone"));
  const to = format_local_date(new Date(), timezone);
  const range_days = range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 400;
  const from = shift_date(to, -(range_days - 1));
  return new URLSearchParams({ from, to, timezone }).toString();
}

function read_timezone(value: string | null): string {
  const timezone = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new FederationWebHttpError(400, "timezone 必须是有效的 IANA 时区。");
  }
}

function format_local_date(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value;
  const month = parts.find((item) => item.type === "month")?.value;
  const day = parts.find((item) => item.type === "day")?.value;
  if (!year || !month || !day) throw new Error("无法生成 Usage 当地日期。");
  return `${year}-${month}-${day}`;
}

function shift_date(date: string, offset_days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset_days);
  return value.toISOString().slice(0, 10);
}

function merge_usage_accounts(
  accounts: Array<Record<string, unknown>>,
  usage_items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const usage_by_user = new Map(usage_items.map((item) => [String(item.user_id ?? ""), item]));
  const merged: Array<Record<string, unknown>> = accounts.map((account) => {
    const user_id = String(account.user_id ?? account.id ?? "");
    return {
      user_id,
      email: String(account.email ?? account.auth_email ?? ""),
      ...empty_web_usage_user(),
      ...(usage_by_user.get(user_id) ?? {}),
    };
  });
  const account_users = new Set(merged.map((item) => String(item.user_id)));
  for (const item of usage_items) {
    if (!account_users.has(String(item.user_id ?? ""))) merged.push({ email: "", ...item });
  }
  return merged;
}

/** 统计查询当地日期范围内的新注册用户。 */
function count_registered_users(
  accounts: Array<Record<string, unknown>>,
  from: string,
  to: string,
  timezone: string,
): number {
  return accounts.filter((account) => {
    const raw_date = account.auth_created_at ?? account.profile_created_at ?? account.created_at;
    const date = new Date(raw_date as string | number | Date);
    if (!Number.isFinite(date.getTime())) return false;
    const local_date = format_local_date(date, timezone);
    return local_date >= from && local_date <= to;
  }).length;
}

function empty_web_usage_user(): Record<string, unknown> {
  return {
    last_active_at: "",
    execution_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    success_rate: null,
    metered_request_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    credits_used: 0,
    top_model_id: "",
    metering_unavailable_count: 0,
    average_duration_ms: null,
    p95_duration_ms: null,
  };
}

async function read_json_body<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total_bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total_bytes += buffer.length;
    if (total_bytes > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function required_text(payload: Record<string, unknown>, key: string): string {
  const value = optional_text(payload, key);
  if (!value) throw new TypeError(`${key} is required.`);
  return value;
}

function optional_text(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function send_json(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

function content_type(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}
