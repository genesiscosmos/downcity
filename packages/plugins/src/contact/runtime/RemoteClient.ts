/**
 * contact 远端 HTTP 客户端。
 *
 * 关键点（中文）
 * - contact 的 agent-to-agent 调用统一走 plugin runtime command 接口。
 * - 已建联后的敏感调用必须携带 contact token。
 */

import type { JsonValue } from "@downcity/agent";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeEndpoint(endpoint: string): string {
  const raw = String(endpoint || "").trim();
  if (!raw) throw new Error("endpoint is required");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function unwrapPluginCommandEnvelope<T>(value: T): T {
  if (!isRecord(value)) return value;
  const inner = value.data;
  if (typeof value.success === "boolean" && isRecord(inner)) {
    // 关键点（中文）：统一 command 路由会包一层 `{ success, data }`。
    return inner as T;
  }
  return value;
}

async function postPluginCommand<T>(params: {
  endpoint: string;
  command: string;
  body?: JsonValue;
  token?: string;
  wrapBody?: boolean;
}): Promise<T> {
  const url = new URL("/api/plugins/command", normalizeEndpoint(params.endpoint)).toString();
  const payloadBody =
    params.wrapBody
      ? {
          ...(params.body !== undefined ? { body: params.body } : {}),
          ...(params.token ? { token: params.token } : {}),
        }
      : params.body && isRecord(params.body)
        ? {
            ...params.body,
            ...(params.token ? { token: params.token } : {}),
          }
        : {
            ...(params.body !== undefined ? { body: params.body } : {}),
            ...(params.token ? { token: params.token } : {}),
          };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      plugin_name: "contact",
      command: params.command,
      payload: payloadBody,
    }),
  });
  const data = (await response.json().catch(() => null)) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }
  return unwrapPluginCommandEnvelope<T>(data);
}

/**
 * 调用远端 ping。
 */
export async function callContactPing<T>(params: {
  endpoint: string;
  token?: string;
}): Promise<T> {
  return await postPluginCommand<T>({
    endpoint: params.endpoint,
    command: "remoteping",
    token: params.token,
  });
}

/**
 * 调用远端 approve。
 */
export async function callContactApprove<T>(params: {
  endpoint: string;
  body: JsonValue;
}): Promise<T> {
  return await postPluginCommand<T>({
    endpoint: params.endpoint,
    command: "remoteapprove",
    body: params.body,
  });
}

/**
 * 调用远端 confirm。
 */
export async function callContactConfirm<T>(params: {
  endpoint: string;
  body: JsonValue;
}): Promise<T> {
  return await postPluginCommand<T>({
    endpoint: params.endpoint,
    command: "remoteconfirm",
    body: params.body,
  });
}

/**
 * 调用远端 chat。
 */
export async function callContactChat<T>(params: {
  endpoint: string;
  token: string;
  body: JsonValue;
}): Promise<T> {
  return await postPluginCommand<T>({
    endpoint: params.endpoint,
    command: "remotechat",
    token: params.token,
    body: params.body,
    wrapBody: true,
  });
}

/**
 * 调用远端 share。
 */
export async function callContactShare<T>(params: {
  endpoint: string;
  token: string;
  body: JsonValue;
}): Promise<T> {
  return await postPluginCommand<T>({
    endpoint: params.endpoint,
    command: "remoteshare",
    token: params.token,
    body: params.body,
    wrapBody: true,
  });
}
