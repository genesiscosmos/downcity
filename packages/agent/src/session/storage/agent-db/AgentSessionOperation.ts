/**
 * IPC 未知提交的原操作身份与 receipt 核对。
 * 不重放事务；只有原写者已终止后才能把缺失 receipt 判为未提交。错误携带稳定
 * operation_id 供宿主定位，不含正文；相同 ID 的请求摘要不同则拒绝采信。
 */
import { normalize_session_type, normalize_session_descriptor } from "@downcity/type";
import type { AgentSessionWriteCommand } from "@/types/store/AgentSessionWorker.js";
import type { AgentSessionOperationReceipt } from "@/types/store/AgentSessionDatabase.js";
import { storage_digest } from "./AgentSessionCursor.js";

/** 原事务确认未提交或尚未知；调用方不得换 ID 自动重放。 */
export class AgentSessionCommitError extends Error {
  /** 稳定提交状态代码，用于安全诊断，不依赖异常消息。 */
  readonly code: string;

  constructor(readonly operation_id: string, readonly outcome: "unknown" | "not_committed", cause?: unknown) {
    super(`session_storage_${outcome}: ${operation_id}`, { cause });
    this.code = `session_storage_${outcome}`;
    this.name = "AgentSessionCommitError";
  }
}

/** 与数据库实际 write() 输入保持同一确定性摘要规则。 */
export function agent_session_operation_hash(operation: AgentSessionWriteCommand): string {
  switch (operation.command) {
    case "archive_prepare": return storage_digest({ command: "archive_prepare", ...operation.input, type: normalize_session_type(operation.input.type) });
    case "ensure_creation": return storage_digest({ command: "ensure_creation", input: { ...operation.input, ...normalize_session_descriptor(operation.input) } });
    case "create": return storage_digest({ command: "create", input: { ...operation.input, ...normalize_session_descriptor(operation.input) } });
    case "archive": return storage_digest({ command: "archive", address: operation.address, archived_at: operation.archived_at });
    case "remove": return storage_digest({ command: "remove", address: operation.address });
    default: return storage_digest({ command: operation.command, ...operation.input });
  }
}

/** 统一取得集合命令和消息命令中的原 UUID。 */
export function agent_session_operation_id(operation: AgentSessionWriteCommand): string {
  if (operation.command === "archive_prepare") return archive_receipt_uuid(["archive_prepare", operation.input.operation_id]);
  if (operation.command === "archive_node") return archive_receipt_uuid(["archive_node", operation.input.operation_id, operation.input.position]);
  return "operation_id" in operation ? operation.operation_id : operation.input.operation_id;
}

/** 派生节点receipt身份与计划身份分离，重入必须稳定，不新增随机UUID。 */
export function archive_receipt_uuid(parts: unknown[]): string {
  const hash = storage_digest(parts);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** 核对原 UUID 的已提交事实，返回小型提交结果；不发送写请求。 */
export async function reconcile_agent_session_operation<T>(
  operation: AgentSessionWriteCommand,
  settle_writer: () => Promise<void>,
  receipt: (operation_id: string) => Promise<AgentSessionOperationReceipt | null>,
  original_error?: unknown,
): Promise<T> {
  const operation_id = agent_session_operation_id(operation);
  let committed: AgentSessionOperationReceipt | null;
  try {
    await settle_writer();
    committed = await receipt(operation_id);
  } catch (error) {
    throw new AgentSessionCommitError(operation_id, "unknown",
      original_error === undefined ? error : new AggregateError([original_error, error], "session_storage_reconciliation_failed"));
  }
  if (!committed) throw new AgentSessionCommitError(operation_id, "not_committed", original_error);
  if (committed.request_hash !== agent_session_operation_hash(operation)) throw new Error("session_storage_operation_conflict");
  return committed.result as T;
}
