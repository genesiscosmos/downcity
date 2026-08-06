/**
 * Federation query 调试命令。
 *
 * 关键说明（中文）
 * - 该命令直接请求当前 active Federation，便于排查 auth、env、模型解析与上游错误。
 * - 当前实例存在有效管理员 Session 时自动带 Authorization，否则按公开请求发送。
 * - 非 2xx 响应仍完整打印 status、headers、body，避免吞掉服务端真实错误。
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readActiveServer, type ServerProfile } from "@/federation/core/session.js";
import type {
  FederationQueryCommandOptions,
  FederationQueryResolvedRequest,
} from "@/federation/types/FederationQuery.js";
import { CliError } from "@/shared/CliError.js";
import { t } from "@/shared/CliLocale.js";

const SUPPORTED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/**
 * 执行 Federation query 命令。
 */
export async function run_federation_query_command(
  method_input: string,
  target_input: string,
  options: FederationQueryCommandOptions,
): Promise<void> {
  const server = resolve_active_query_server();
  const request = await resolve_query_request({
    server,
    method_input,
    target_input,
    options,
  });

  const response = await send_query_request(request);
  const response_body = await response.text();

  print_query_response({
    response,
    response_body,
    raw: options.raw === true,
  });

  if (!response.ok) {
    process.exitCode = 1;
  }
}

async function send_query_request(
  request: FederationQueryResolvedRequest,
): Promise<Response> {
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });
  } catch (error) {
    throw new CliError({
      title: t({
        zh: "请求 Federation 失败。",
        en: "Failed to query Federation.",
      }),
      note: error_message(error),
    });
  }
}

function resolve_active_query_server(): ServerProfile {
  const server = readActiveServer();
  if (!server) {
    throw new CliError({
      title: t({
        zh: "当前没有 active Federation。",
        en: "No active Federation is configured.",
      }),
      fix: "fed server add",
    });
  }

  return server;
}

async function resolve_query_request(params: {
  server: ServerProfile;
  method_input: string;
  target_input: string;
  options: FederationQueryCommandOptions;
}): Promise<FederationQueryResolvedRequest> {
  const method = normalize_query_method(params.method_input);
  const url = resolve_query_url(params.server.base_url, params.target_input);
  const body = await resolve_query_body(params.options);

  if (body !== undefined && (method === "GET" || method === "HEAD")) {
    throw new CliError({
      title: t({
        zh: `${method} 请求不能携带 body。`,
        en: `${method} requests cannot include a body.`,
      }),
    });
  }

  const headers = resolve_query_headers({
    admin_session_token: params.server.admin_session_token,
    header_inputs: params.options.header ?? [],
  });

  return {
    method,
    url,
    headers,
    body,
  };
}

function normalize_query_method(method_input: string): string {
  const method = String(method_input ?? "").trim().toUpperCase();
  if (!SUPPORTED_METHODS.has(method)) {
    throw new CliError({
      title: t({
        zh: `不支持的 HTTP method：${method_input}`,
        en: `Unsupported HTTP method: ${method_input}`,
      }),
      note: Array.from(SUPPORTED_METHODS).join(", "),
    });
  }
  return method;
}

function resolve_query_url(base_url_input: string, target_input: string): URL {
  const base_url = new URL(base_url_input);
  const target = String(target_input ?? "").trim();

  if (!target) {
    throw new CliError({
      title: t({
        zh: "请求 path 不能为空。",
        en: "Request path is required.",
      }),
    });
  }

  if (/^https?:\/\//iu.test(target)) {
    const url = new URL(target);
    if (url.origin !== base_url.origin) {
      throw new CliError({
        title: t({
          zh: "完整 URL 只能指向当前 active Federation 域名。",
          en: "Full URLs must use the current active Federation origin.",
        }),
        note: t({
          zh: `允许 origin：${base_url.origin}`,
          en: `Allowed origin: ${base_url.origin}`,
        }),
      });
    }
    return url;
  }

  if (!target.startsWith("/")) {
    throw new CliError({
      title: t({
        zh: "请求 path 必须以 / 开头，或传入完整 URL。",
        en: "Request path must start with /, or be a full URL.",
      }),
    });
  }

  return new URL(target, base_url.origin);
}

async function resolve_query_body(
  options: FederationQueryCommandOptions,
): Promise<string | undefined> {
  const has_data = typeof options.data === "string";
  const has_file = typeof options.file === "string";

  if (has_data && has_file) {
    throw new CliError({
      title: t({
        zh: "--data 与 --file 不能同时使用。",
        en: "--data and --file cannot be used together.",
      }),
    });
  }

  if (has_data) {
    return normalize_json_body(options.data ?? "", "--data");
  }

  if (has_file) {
    const file_path = resolve(String(options.file));
    const file_body = await read_query_body_file(file_path);
    return normalize_json_body(file_body, "--file");
  }

  return undefined;
}

async function read_query_body_file(file_path: string): Promise<string> {
  try {
    return await readFile(file_path, "utf-8");
  } catch (error) {
    throw new CliError({
      title: t({
        zh: `读取请求体文件失败：${file_path}`,
        en: `Failed to read request body file: ${file_path}`,
      }),
      note: error_message(error),
    });
  }
}

function normalize_json_body(body_input: string, source: string): string {
  const body = String(body_input ?? "").trim();
  if (!body) {
    throw new CliError({
      title: t({
        zh: `${source} 请求体不能为空。`,
        en: `${source} body cannot be empty.`,
      }),
    });
  }

  try {
    JSON.parse(body);
  } catch {
    throw new CliError({
      title: t({
        zh: `${source} 必须是合法 JSON。`,
        en: `${source} must be valid JSON.`,
      }),
    });
  }

  return body;
}

function resolve_query_headers(params: {
  admin_session_token?: string;
  header_inputs: string[];
}): Headers {
  const headers = new Headers();
  const admin_session_token = params.admin_session_token?.trim();
  if (admin_session_token) {
    headers.set("authorization", `Bearer ${admin_session_token}`);
  }
  headers.set("content-type", "application/json");

  for (const header_input of params.header_inputs) {
    const separator_index = header_input.indexOf(":");
    if (separator_index <= 0) {
      throw new CliError({
        title: t({
          zh: `header 格式错误：${header_input}`,
          en: `Invalid header format: ${header_input}`,
        }),
        note: t({
          zh: "请使用 key:value 格式。",
          en: "Use key:value format.",
        }),
      });
    }

    const key = header_input.slice(0, separator_index).trim();
    const value = header_input.slice(separator_index + 1).trim();
    if (!key) {
      throw new CliError({
        title: t({
          zh: `header key 不能为空：${header_input}`,
          en: `Header key cannot be empty: ${header_input}`,
        }),
      });
    }
    headers.set(key, value);
  }

  return headers;
}

function print_query_response(params: {
  response: Response;
  response_body: string;
  raw: boolean;
}): void {
  if (params.raw) {
    process.stdout.write(params.response_body);
    return;
  }

  console.log(`status: ${params.response.status} ${params.response.statusText}`.trimEnd());
  console.log("headers:");
  for (const [key, value] of params.response.headers.entries()) {
    console.log(`${key}: ${value}`);
  }
  console.log("");
  print_response_body(params.response_body);
}

function print_response_body(response_body: string): void {
  if (!response_body) {
    return;
  }

  const parsed = try_parse_json(response_body);
  if (parsed.ok) {
    console.log(JSON.stringify(parsed.value, null, 2));
    return;
  }

  console.log(response_body);
}

function try_parse_json(response_body: string):
  | { ok: true; value: unknown }
  | { ok: false } {
  try {
    return {
      ok: true,
      value: JSON.parse(response_body),
    };
  } catch {
    return { ok: false };
  }
}

function error_message(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
