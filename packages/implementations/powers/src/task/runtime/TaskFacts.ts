/**
 * Task 可靠事实源：命令事实嵌入 canonical task.toml 原子发布，删除前归档同一事实。
 * Memory 只重放这些明确事实，不扫描 Session 或未验收的执行历史；本模块不决定记忆策略。
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { PowerStorage } from "@downcity/city/power";
import type { TaskFact, TaskFactQuery } from "../types/TaskFact.js";
import type { ShipTaskDefinitionV1 } from "../types/Task.js";
import type { TaskInboxItem } from "../types/TaskWorkflow.js";
import { getTaskRunDir } from "./Paths.js";

export const task_fact_schema = z.object({
  event_id: z.string().regex(/^[a-f0-9]{64}$/u), event_type: z.enum(["task_accepted", "user_correction"]),
  agent_id: z.string().min(1), workspace_id: z.string(), task_id: z.string().min(1), item_id: z.string().min(1),
  occurred_at: z.iso.datetime(), run_timestamp: z.string(), request_text: z.string().max(24000),
  output_text: z.string().max(16000), output_fingerprint: z.string(), output_truncated: z.boolean(), source_error: z.string(),
}).strict();

/** 固定处理事项对应的交付物边界；缺失或过长明确记录，不悄悄读取其他 run。 */
export async function capture_task_fact(storage: PowerStorage, task: ShipTaskDefinitionV1, item: TaskInboxItem,
  event_type: TaskFact["event_type"], feedback?: string): Promise<TaskFact | undefined> {
  if (!task.agent_id || task.kind === "user") return undefined;
  let output = "";
  let source_error = "";
  if (item.run_timestamp) {
    try {
      output = (await storage.files.read_file(path.join(getTaskRunDir(storage.path, task.taskId, item.run_timestamp), "output.md"))).toString("utf8");
    } catch (error) { source_error = String(error); }
  } else { source_error = "Accepted item has no bound run artifact"; }
  const event_id = createHash("sha256").update(JSON.stringify([path.resolve(storage.path), task.taskId, item.item_id, event_type])).digest("hex");
  return {
    event_id, event_type, agent_id: task.agent_id, workspace_id: task.workspace_id,
    task_id: task.taskId, item_id: item.item_id, occurred_at: new Date().toISOString(),
    run_timestamp: item.run_timestamp ?? "", request_text: feedback ?? `Task command accept: ${task.taskId}, item ${item.item_id}`,
    output_text: output.slice(0, 16000), output_fingerprint: output ? createHash("sha256").update(output).digest("hex") : "",
    output_truncated: output.length > 16000, source_error,
  };
}

/** 删除 Task 前持久化不可变事实，失败则禁止删除，封闭删除与摄取之间的丢失窗口。 */
export async function archive_task_facts(storage: PowerStorage, facts: readonly TaskFact[]): Promise<void> {
  if (!facts.length) return;
  const directory = path.join(storage.path, "facts");
  await storage.files.ensure_directory(directory);
  for (const fact of facts) {
    await storage.files.write_file_atomically(path.join(directory, `${fact.event_id}.json`), JSON.stringify(fact));
  }
}

/** 汇总已发布的命令事实与删除归档；相同事件必须保持同一内容。 */
export async function read_task_facts(storage: PowerStorage, tasks: readonly ShipTaskDefinitionV1[], query?: TaskFactQuery): Promise<TaskFact[]> {
  const facts = tasks.flatMap((task) => task.workflow.facts ?? []);
  const directory = path.join(storage.path, "facts");
  if (await storage.files.path_exists(directory)) {
    for (const entry of await storage.files.read_directory(directory)) {
      if (entry.is_directory || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
      facts.push(task_fact_schema.parse(JSON.parse((await storage.files.read_file(path.join(directory, entry.name))).toString("utf8"))));
    }
  }
  const unique = new Map<string, TaskFact>();
  for (const fact of facts) {
    if (query && (fact.agent_id !== query.agent_id || (fact.workspace_id || undefined) !== query.workspace_id)) continue;
    const previous = unique.get(fact.event_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(fact)) throw new Error("Task fact identity reused with different content");
    unique.set(fact.event_id, fact);
  }
  return [...unique.values()].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) || left.event_id.localeCompare(right.event_id));
}
