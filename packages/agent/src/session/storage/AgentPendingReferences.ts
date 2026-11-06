/** Agent scope 中未完成委派与完成通知的只读引用投影；不恢复投递或创建文件。 */
import fs from "node:fs/promises";
import path from "node:path";
import type { SessionDelegationRecord } from "../../types/agent/SessionDelegation.js";
import type { SessionCompletionRecord } from "../../types/agent/SessionCompletion.js";

/** 持久化后台工作引用摘要。 */
export interface AgentPendingReference {
  /** 来源种类，仅描述尚未完成的执行/投递。 */
  kind: "pending_delegation" | "pending_completion";
  /** 此记录所属 Agent ID。 */
  owner_agent_id: string;
  /** 此记录结构化路由依赖的 Agent ID。 */
  referenced_agent_id: string;
  /** 稳定委派或完成通知 ID，不含消息正文。 */
  record_id: string;
}

/** 覆盖尚未创建 Session 的准备期委派以及 canonical 完成后的待投递回调。 */
export async function read_agent_pending_references(storage_root_path: string, agent_id: string): Promise<AgentPendingReference[]> {
  const result: AgentPendingReference[] = [];
  for (const record of await read_records<SessionDelegationRecord>(path.join(storage_root_path, "delegations"))) {
    if (!record.delegation_id || !record.caller?.agent_id || !record.execution_state || !record.delivery_state) throw new Error("Invalid pending delegation reference record");
    if (["pending", "running"].includes(record.execution_state) || record.delivery_state === "pending") {
      for (const referenced_agent_id of new Set([agent_id, record.caller.agent_id])) result.push({ kind: "pending_delegation", owner_agent_id: agent_id, referenced_agent_id, record_id: record.delegation_id });
    }
  }
  for (const record of await read_records<SessionCompletionRecord>(path.join(storage_root_path, "completions"))) {
    if (!record.event?.completion_id || !record.state) throw new Error("Invalid pending completion reference record");
    if (record.state === "delivered") continue;
    const ids = new Set([agent_id]);
    collect_route_ids(record.origin, ids);
    // 只检查用户消息的结构化 callback 元数据，不把正文或私密回答当作引用。
    for (const message of record.event.messages) if (message.role === "user") collect_route_ids(message.meta, ids);
    for (const referenced_agent_id of ids) result.push({ kind: "pending_completion", owner_agent_id: agent_id, referenced_agent_id, record_id: record.event.completion_id });
  }
  return result;
}

/** 顺序读取记录，权限、损坏和 I/O 错误必须阻止破坏性操作。 */
async function read_records<T>(directory: string): Promise<T[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const records: T[] = [];
  for (const entry of entries) if (entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name)) records.push(JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8")) as T);
  return records;
}

/** 只识别结构化路由字段，不读取任意正文。 */
function collect_route_ids(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) collect_route_ids(item, ids); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["agent_id", "parent_agent_id", "target_agent_id"].includes(key) && typeof item === "string") ids.add(item);
    else if (!["text", "payload", "response", "query", "content"].includes(key)) collect_route_ids(item, ids);
  }
}
