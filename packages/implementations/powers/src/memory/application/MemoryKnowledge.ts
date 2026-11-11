/** Knowledge 应用端口：统一事务能力检查和结构化范围授权，记录 ID 对处理层保持不透明。 */
import { LOCAL_USER_ID } from "@downcity/city/local";
import type { MemoryProvider, MemoryRecord } from "../types/Memory.js";
import type { MemoryAccessContext, MemoryOwner, MemorySubject, MemoryWriteTarget } from "../types/MemoryAccess.js";
import type { MemoryCommitProvider } from "../types/MemoryChangeSet.js";

/** 强事务是显式能力，不能用本地重试掩盖后端不具备的原子性。 */
export function require_memory_transactions(provider: MemoryProvider): MemoryCommitProvider {
  const transactions = provider.transactions;
  if (!provider.capabilities.transactions || !transactions
    || typeof transactions.commit !== "function" || typeof transactions.read_version !== "function"
    || typeof transactions.read_commit_receipt !== "function") {
    throw new Error(`Memory Provider ${provider.name} does not support transactional knowledge writes`);
  }
  return transactions;
}

/** 根据可信身份解析唯一写入范围，不编码 Provider 的 ID 或文件路径。 */
export function memory_target_subject(access: MemoryAccessContext, target: MemoryWriteTarget): MemorySubject {
  if (!access.agent_id.trim()) throw new Error("Memory access requires agent_id");
  if (target === "agent") return { kind: "agent", agent_id: access.agent_id };
  if (target === "user") return { kind: "user", user_id: LOCAL_USER_ID };
  if (!access.workspace_id || !access.city_memory_available) throw new Error("Workspace knowledge requires an available Workspace");
  return { kind: "workspace", workspace_id: access.workspace_id };
}

/** 比较授权身份，禁止通过记录 ID 的命名约定推断归属。 */
function same_subject(left: MemoryOwner | MemorySubject, right: MemorySubject): boolean {
  if (left.kind !== right.kind) return false;
  switch (right.kind) {
    case "agent": return left.kind === "agent" && left.agent_id === right.agent_id;
    case "user": return left.kind === "user" && left.user_id === right.user_id;
    case "workspace": return left.kind === "workspace" && left.workspace_id === right.workspace_id;
    case "city": return left.kind === "city";
  }
}

/** 所有者与主体都必须属于目标范围，适用 Agent 限制仍由应用层复核。 */
export function memory_matches_target(record: MemoryRecord, access: MemoryAccessContext, target: MemoryWriteTarget): boolean {
  const subject = memory_target_subject(access, target);
  return same_subject(record.owner, subject) && same_subject(record.subject, subject)
    && (!record.metadata?.applicable_agent_id || record.metadata.applicable_agent_id === access.agent_id);
}

/** 从已授权读取的记录解析可写目标；City 旧记录不能通过处理入口修改。 */
export function memory_record_target(record: MemoryRecord, access: MemoryAccessContext): MemoryWriteTarget {
  const target = record.subject.kind === "workspace" ? "current_workspace"
    : record.subject.kind === "user" ? "user" : "agent";
  if (!memory_matches_target(record, access, target)) throw new Error("Memory is outside the writable execution scope");
  return target;
}

/** 读取后再次核对 ID 与结构化归属，兼容外部后端不透明 ID。 */
export async function read_target_memory(provider: MemoryProvider, access: MemoryAccessContext, target: MemoryWriteTarget, memory_id: string): Promise<MemoryRecord> {
  const result = await provider.read({ access, memory_id });
  if (!result.memory) throw new Error("Memory not found");
  if (result.memory.memory_id !== memory_id || !memory_matches_target(result.memory, access, target)) {
    throw new Error("Memory is outside the Job target");
  }
  return result.memory;
}
