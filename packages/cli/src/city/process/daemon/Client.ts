/**
 * Daemon API 客户端（process 子模块）。
 *
 * 关键点（中文）
 * - 业务模块统一通过 daemon API 与运行时通信。
 * - HTTP gateway 与本机 RPC 的地址解析分开，避免端口语义混淆。
 */

import fs from "fs-extra";
import {
  type DaemonEndpoint,
  type DaemonJsonApiCallParams,
  type DaemonJsonApiCallResult,
} from "@/city/process/daemon/Api.js";
import {
  formatCliBearerHeaderValue,
  resolveCliAuthToken,
} from "@/city/shared/CliAuthToken.js";
import { get_daemon_meta_path } from "@/city/process/daemon/Manager.js";
import type { JsonObject, JsonValue } from "@downcity/agent";

/**
 * 解析端口值。
 *
 * 关键点（中文）
 * - 仅接受 1~65535 的整数；非法值返回 undefined。
 */
function parsePortLike(input: string | number | undefined): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const raw =
    typeof input === "number" ? input : Number.parseInt(String(input), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return undefined;
  if (!Number.isInteger(raw) || raw <= 0 || raw > 65535) return undefined;
  return raw;
}

/**
 * 归一化 host。
 *
 * 关键点（中文）
 * - `0.0.0.0`/`::` 会转换为 `127.0.0.1`，避免客户端直连通配地址失败。
 */
function normalizeHost(input: string | undefined): string | undefined {
  const host = typeof input === "string" ? input.trim() : "";
  if (!host) return undefined;
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

function parseErrorMessageFromPayload(data: JsonValue | null): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = data as JsonObject;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.message === "string") return payload.message;
  return null;
}

type ResolveDaemonEndpointParams = {
  agent_id: string;
  host?: string;
  port?: number;
};

function resolveDaemonEndpointFromSources(params: {
  agent_id: string;
  explicit_host?: string;
  explicit_port?: number;
  env_host_name: string;
  env_port_name: string;
  meta_port_name: "http_port" | "rpc_port";
  default_host: string;
  default_port: number;
  read_daemon_arg_host?: boolean;
}): DaemonEndpoint {
  const explicitHost = normalizeHost(params.explicit_host);
  const explicitPort = parsePortLike(params.explicit_port);

  const envHost = normalizeHost(process.env[params.env_host_name]);
  const envPort = parsePortLike(process.env[params.env_port_name]);

  let daemonArgHost: string | undefined;
  let daemonArgPort: number | undefined;
  try {
    const metaPath = get_daemon_meta_path();
    if (fs.existsSync(metaPath)) {
      const raw = fs.readJsonSync(metaPath) as {
        host?: unknown;
        http_port?: unknown;
        rpc_port?: unknown;
      };
      daemonArgHost = params.read_daemon_arg_host === false
        ? undefined
        : normalizeHost(String(raw.host || ""));
      daemonArgPort = parsePortLike(Number(raw[params.meta_port_name]));
    }
  } catch {
    // ignore daemon meta errors, fallback to other sources
  }

  const host = explicitHost || envHost || daemonArgHost || params.default_host;
  const port = explicitPort || envPort || daemonArgPort || params.default_port;

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
  };
}

/**
 * 解析 daemon endpoint。
 *
 * 优先级（中文）
 * 1) 显式入参 `host/port`
 * 2) 环境变量 `DC_CITY_HOST/DC_CITY_PORT`
 * 3) daemon meta args（`downcity.daemon.json`）
 * 4) 默认 `127.0.0.1:5314`
 */
export function resolveDaemonEndpoint(params: {
  agent_id: string;
  host?: string;
  port?: number;
}): DaemonEndpoint {
  return resolveDaemonEndpointFromSources({
    agent_id: params.agent_id,
    explicit_host: params.host,
    explicit_port: params.port,
    env_host_name: "DC_CITY_HOST",
    env_port_name: "DC_CITY_PORT",
    meta_port_name: "http_port",
    default_host: "127.0.0.1",
    default_port: 5314,
    read_daemon_arg_host: true,
  });
}

/**
 * 解析 daemon 本机 RPC endpoint。
 *
 * 优先级（中文）
 * 1) 显式入参 `host/port`
 * 2) 环境变量 `DC_CITY_RPC_HOST/DC_CITY_RPC_PORT`
 * 3) daemon meta args（`downcity.daemon.json`）
 * 4) 默认 `127.0.0.1:15314`
 */
export function resolveDaemonRpcEndpoint(
  params: ResolveDaemonEndpointParams,
): DaemonEndpoint {
  return resolveDaemonEndpointFromSources({
    agent_id: params.agent_id,
    explicit_host: params.host,
    explicit_port: params.port,
    env_host_name: "DC_CITY_RPC_HOST",
    env_port_name: "DC_CITY_RPC_PORT",
    meta_port_name: "rpc_port",
    default_host: "127.0.0.1",
    default_port: 15314,
    // 关键点（中文）：RPC 运行时固定监听本机地址，不能复用 HTTP gateway 的 `--host`。
    read_daemon_arg_host: false,
  });
}

/**
 * 调用 daemon JSON API。
 *
 * 错误语义（中文）
 * - 网络异常：`success=false` + `error`（无 status）。
 * - HTTP 非 2xx：`success=false` + `status` + `error`。
 */
export async function callServer<T>(
  params: DaemonJsonApiCallParams,
): Promise<DaemonJsonApiCallResult<T>> {
  const endpoint = resolveDaemonEndpoint({
    agent_id: params.agent_id,
    host: params.host,
    port: params.port,
  });

  const agent_base_url = `${endpoint.baseUrl}/agents/${encodeURIComponent(params.agent_id)}/`;
  const url = new URL(params.path.replace(/^\//u, ""), agent_base_url).toString();
  const method = params.method || "GET";
  const hasBody = params.body !== undefined && method !== "GET";
  const headers: Record<string, string> = {};
  const timeoutMs =
    typeof params.timeoutMs === "number" &&
    Number.isFinite(params.timeoutMs) &&
    params.timeoutMs > 0
      ? Math.floor(params.timeoutMs)
      : undefined;
  const authHeaderValue = formatCliBearerHeaderValue(
    resolveCliAuthToken({
      explicitToken: params.authToken,
    }),
  );
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }
  if (authHeaderValue) {
    headers.Authorization = authHeaderValue;
  }

  try {
    const abortController = timeoutMs ? new AbortController() : undefined;
    const timeoutHandle = timeoutMs
      ? setTimeout(() => abortController?.abort(), timeoutMs)
      : undefined;
    const response = await fetch(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: hasBody ? JSON.stringify(params.body) : undefined,
      signal: abortController?.signal,
    });
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    let data: JsonValue | null = null;
    try {
      data = (await response.json()) as JsonValue;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const messageFromData =
        parseErrorMessageFromPayload(data) || `HTTP ${response.status}`;
      return {
        success: false,
        status: response.status,
        error: messageFromData,
      };
    }

    return {
      success: true,
      status: response.status,
      data: data as T,
    };
  } catch (error) {
    if (timeoutMs && error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: `Failed to call ${url}: timeout after ${timeoutMs}ms`,
      };
    }
    return {
      success: false,
      error: `Failed to call ${url}: ${String(error)}`,
    };
  }
}
