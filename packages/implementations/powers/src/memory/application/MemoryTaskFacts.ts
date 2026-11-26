/** 官方 Power 组合的 Task→Memory 事实适配；保留来源角色，默认只写原 Agent 私有知识。 */
import { capture_memory_source } from "./MemorySourceBinding.js";
import type { TaskFact } from "../../task/types/TaskFact.js";
import type { MemorySignalInput } from "../types/MemoryDream.js";

/** 只转换 Task 已持久发布的命令事实；不读取 Task 执行历史或创建新的验收。 */
export function memory_task_signal(fact: TaskFact): MemorySignalInput {
  const source_id = `task-fact:${fact.event_id}`;
  const output = fact.output_text.slice(0, 8000);
  const locator = { event_id: fact.event_id, task_id: fact.task_id, item_id: fact.item_id,
    ...(fact.run_timestamp ? { run_timestamp: fact.run_timestamp } : {}) };
  return {
    event_id: fact.event_id, event_type: fact.event_type, producer: "task", occurred_at: fact.occurred_at,
    agent_id: fact.agent_id, ...(fact.workspace_id ? { workspace_id: fact.workspace_id } : {}),
    scope: "agent", workspace_share_allowed: false,
    source_boundary: JSON.stringify({ task_id: fact.task_id, item_id: fact.item_id, run_timestamp: fact.run_timestamp,
      output_fingerprint: fact.output_fingerprint, output_range: [0, output.length],
      truncated: fact.output_truncated || output.length < fact.output_text.length }),
    ...((fact.source_error || output && !fact.output_fingerprint) ? { source_error: fact.source_error ?? "Task output fingerprint unavailable" } : {}),
    sources: [
      { source_id, agent_id: fact.agent_id, category: "task", message_id: fact.item_id,
        role: "request", text: fact.request_text, bound_source: capture_memory_source({ source_type: "task_fact", role: "request", locator, excerpt: fact.request_text }, fact.request_text) },
      ...(output ? [{ source_id: `${source_id}:output`, agent_id: fact.agent_id, category: "task",
        message_id: fact.run_timestamp, role: "agent" as const, text: output, bound_source: capture_memory_source({ source_type: "task_fact", role: "agent", excerpt: output, locator: { ...locator,
          ...(fact.output_fingerprint ? { output_fingerprint: fact.output_fingerprint } : {}), output_range: { start: 0, end: output.length }, truncated: fact.output_truncated || output.length < fact.output_text.length } }, output) }] : []),
    ],
  };
}
