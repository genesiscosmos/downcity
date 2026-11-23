/**
 * City CLI访问Federation服务的执行边界。
 * 公开发现使用无凭据SDK，调用只绑定目标会话，所有请求禁止重定向并在退出时释放。
 */
import { readFile, writeFile } from "node:fs/promises";
import { Downtown, type FetchLike, type ServiceEndpointDetail, type ServiceRequestOptions } from "@downcity/downtown";
import { resolve_federation_access_target } from "./FederationAccessTarget.js";
import { shared_user_token_resolver } from "./FederationUserCredentials.js";
import { format_federation_service, format_federation_services, output_federation_response, print_federation_json } from "./FederationAccessOutput.js";
import type { FederationAccessOptions } from "../types/FederationAccess.js";

/** 限制输入大小，避免误把大型文件全部载入内存。 */
const MAX_INPUT_BYTES = 16 * 1024 * 1024;

/** 读取文件/stdin；raw保留原文，JSON由后续按协议解析。 */
export async function read_federation_input(file_path?: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!file_path) return undefined;
  if (file_path !== "-") {
    const bytes = await readFile(file_path, { signal });
    if (bytes.length > MAX_INPUT_BYTES) throw new Error("Input exceeds 16 MiB.");
    return bytes.toString("utf8");
  }
  const parts: Buffer[] = [];
  let total = 0;
  const abort = () => process.stdin.destroy(new Error("Input cancelled."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for await (const part of process.stdin) {
      signal?.throwIfAborted();
      const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
      total += bytes.length;
      if (total > MAX_INPUT_BYTES) throw new Error("Input exceeds 16 MiB.");
      parts.push(bytes);
    }
    return Buffer.concat(parts).toString("utf8");
  } finally { signal?.removeEventListener("abort", abort); }
}

/** 只接受对象输入；GET复用SDK的字符串query转换规则。 */
export function parse_federation_object(raw?: string): Record<string, unknown> {
  let value: unknown;
  try { value = raw === undefined || !raw.trim() ? {} : JSON.parse(raw); }
  catch { throw new TypeError("Input must contain a valid JSON object."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Input must be a JSON object.");
  return value as Record<string, unknown>;
}

/** 构造请求，不从文档执行代码或把原生路由转换为action。 */
export function federation_action_request(action: ServiceEndpointDetail, raw?: string, signal?: AbortSignal): ServiceRequestOptions {
  if (action.method !== "GET" && action.method !== "POST") throw new Error("Unsupported action method.");
  if (action.method === "GET") return { method: "GET", query: parse_federation_object(raw), signal };
  const is_raw = action.body === "raw";
  return {
    method: "POST", signal,
    headers: { "content-type": action.documentation?.request_content_type ?? (is_raw ? "text/plain" : "application/json") },
    body: is_raw ? raw ?? "" : JSON.stringify(parse_federation_object(raw)),
  };
}

/** 执行命令；可注入fetch在进程内验证，不启动监听器。 */
export async function execute_federation_access(command: "services" | "service" | "openapi" | "call", options: FederationAccessOptions, service_id?: string, action_id?: string, fetch_impl: typeof fetch = globalThis.fetch): Promise<void> {
  const target = resolve_federation_access_target(options.url, command === "call" ? options.admin ? "admin" : "user" : "public");
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Federation request cancelled."));
  const safe_fetch: FetchLike = (url, init) => {
    const parsed = new URL(url);
    const base = new URL(target.url);
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")) {
      throw new Error("Request escaped the selected Federation.");
    }
    return fetch_impl(url, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const federation = new Downtown({ url: target.url, fetch: safe_fetch,
    user_token: target.user_token,
    resolve_user_token: shared_user_token_resolver(target.url, target.session_id),
    admin_token: target.admin_token,
  });
  try {
    if (command === "services") {
      const items = await federation.list_services();
      if (options.json) print_federation_json({ items });
      else process.stdout.write(format_federation_services(items));
      return;
    }
    if (command === "openapi") {
      const document = await federation.openapi();
      if (options.output) await writeFile(options.output, JSON.stringify(document, null, 2) + "\n", { signal: controller.signal });
      else print_federation_json(document);
      return;
    }
    if (!service_id) throw new Error("service_id is required.");
    const detail = await federation.describe_service(service_id);
    if (command === "service") {
      if (options.json) print_federation_json(detail);
      else process.stdout.write(format_federation_service(detail));
      return;
    }
    const action = detail.actions.find(item => item.id === action_id);
    if (!action || action.kind !== "action") throw new TypeError("Action is not registered in this service; native routes are not supported by call.");
    const needs_auth = action.auth.length > 0;
    if (options.admin && !target.admin_token) throw new TypeError("No administrator session for this Federation. Sign in with downtown first.");
    if (!options.admin && needs_auth && !target.user_token && !target.session_id) throw new TypeError("No user session for this Federation. Run city federation login first.");
    const raw = await read_federation_input(options.input, controller.signal);
    const request = federation_action_request(action, raw, controller.signal);
    const access = options.admin ? federation.admin : federation.user;
    const response = await access.service(service_id).request(action.id, request);
    await output_federation_response(response, controller.signal);
    controller.signal.throwIfAborted();
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await federation.dispose();
  }
}

/** Commander错误出口：不回显参数、凭据、上游正文或任意异常堆栈。 */
export async function run_federation_access(command: "services" | "service" | "openapi" | "call", options: FederationAccessOptions, service_id?: string, action_id?: string): Promise<void> {
  try { await execute_federation_access(command, options, service_id, action_id); }
  catch (error) {
    process.exitCode = 1;
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
    const message = status ? `Federation request failed (HTTP ${status}).` : error instanceof TypeError ? error.message : "Federation command failed. Check the target, session, input and connection.";
    process.stderr.write(options.json ? JSON.stringify({ success: false, error: { message, ...(status ? { status } : {}) } }) + "\n" : message + "\n");
  }
}
