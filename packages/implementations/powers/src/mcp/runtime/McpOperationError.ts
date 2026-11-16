/**
 * MCP 失败的唯一脱敏边界。
 * 不序列化原始 Error/cause/message/data；只从 SDK 类型和白名单系统代码提取诊断信息。
 */
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { McpFailureDetail } from "../types/McpFailure.js";

/** 可安全传播到 IPC、设置页和模型日志的错误；不保留原始 cause。 */
export class McpOperationError extends Error {
  constructor(readonly detail: McpFailureDetail) {
    const label = { connection: "connection failed", authorization: "authorization failed", timeout: "operation timed out", protocol: "protocol error", cancelled: "operation cancelled" }[detail.kind];
    const codes = [detail.http_status === undefined ? "" : `HTTP ${detail.http_status}`, detail.reason_code, detail.protocol_code === undefined ? "" : `RPC ${detail.protocol_code}`].filter(Boolean);
    const guidance = {
      connection: "Check the endpoint, network and server availability, then test the connection.",
      authorization: "Check OAuth metadata, client_id and permissions, then retry authorization in MCP settings.",
      timeout: "Check server availability or finish browser authorization within the time limit, then retry.",
      protocol: "Check the MCP endpoint and server protocol/configuration, then test the connection.",
      cancelled: "Retry when you are ready.",
    }[detail.kind];
    super(`MCP ${detail.phase} ${label}${codes.length ? ` (${codes.join(", ")})` : ""}. ${guidance}`);
    this.name = "McpOperationError";
  }
}

/** 检查有限层 cause；只读取已知代码，从不输出底层异常文本。 */
function network_reason(error: unknown): string | undefined {
  const allowed = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "EADDRINUSE", "EACCES", "ENOENT"]);
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const value = current as {
      /** 仅允许从系统错误读取代码，再与本地白名单比较。 */
      code?: unknown;
      /** 有限向下检查包装原因，不向外保留原始异常。 */
      cause?: unknown;
    };
    if (typeof value.code === "string" && allowed.has(value.code)) return value.code;
    current = value.cause;
  }
  return undefined;
}

/** 将取消原因转换成受控异常，禁止透传调用方可能携带敏感内容的 reason。 */
export function mcp_abort_error(signal: AbortSignal, phase: McpFailureDetail["phase"] = "connection"): McpOperationError {
  return new McpOperationError({ kind: signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled", phase });
}

/** 统一分类：取消优先，其次保留已脱敏错误，再判断 SDK/网络的已知结构。 */
export function mcp_operation_error(error: unknown, phase: McpFailureDetail["phase"], signal?: AbortSignal, http_status?: number): McpOperationError {
  if (signal?.aborted) return mcp_abort_error(signal, phase);
  if (error instanceof McpOperationError) return error;
  const reason_code = network_reason(error);
  if (reason_code) return new McpOperationError({ kind: reason_code.includes("TIMEOUT") || reason_code === "ETIMEDOUT" ? "timeout" : "connection", phase, reason_code });
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return new McpOperationError({ kind: error.name === "TimeoutError" ? "timeout" : "cancelled", phase });
  if (error instanceof StreamableHTTPError) {
    if (typeof error.code === "number" && error.code >= 100 && error.code <= 599) http_status = error.code;
    else return new McpOperationError({ kind: "protocol", phase, reason_code: "unexpected_content_type" });
  }
  if (error instanceof McpError) return new McpOperationError({ kind: error.code === ErrorCode.RequestTimeout ? "timeout" : error.code === ErrorCode.ConnectionClosed ? "connection" : "protocol", phase, protocol_code: error.code });
  if (http_status === 408 || http_status === 504 || http_status === 429 || http_status !== undefined && http_status >= 500) return new McpOperationError({ kind: http_status === 408 || http_status === 504 ? "timeout" : "connection", phase, http_status });
  if (error instanceof OAuthError) {
    const allowed = new Set(["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope", "access_denied", "server_error", "temporarily_unavailable", "invalid_client_metadata", "invalid_redirect_uri", "unsupported_response_type"]);
    return new McpOperationError({ kind: "authorization", phase, http_status, reason_code: allowed.has(error.errorCode) ? error.errorCode : undefined });
  }
  if (http_status !== undefined) return new McpOperationError({ kind: phase === "oauth" && http_status === 400 || http_status === 401 || http_status === 403 ? "authorization" : http_status === 408 || http_status === 504 ? "timeout" : http_status >= 500 || http_status === 429 ? "connection" : "protocol", phase, http_status });
  if (error instanceof SyntaxError || error instanceof Error && error.name === "ZodError") return new McpOperationError({ kind: "protocol", phase, reason_code: "invalid_response" });
  return new McpOperationError({ kind: phase === "oauth" ? "authorization" : phase === "http" && !(error instanceof TypeError) ? "protocol" : "connection", phase });
}
