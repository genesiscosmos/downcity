/** 即时录入应用服务：原文与提交身份在统一任务事务内保存，不调用模型。 */
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import type { TaskDeliverySession } from "../types/Task.js";
import type { TaskCaptureInput } from "../types/TaskIntake.js";
import type { TaskGenerateInput } from "../types/TaskGenerate.js";
import { normalize_task_state, task_work_is_closed } from "../runtime/TaskWorkflowModel.js";
import type { TaskDefinitionRepository } from "../runtime/TaskDefinitionRepository.js";
import { readTask, writeTask } from "../runtime/Store.js";
import { getTaskPath } from "../runtime/Paths.js";

const capture_schema = z.object({
  text: z.string().trim().min(1).max(24000),
  submission_id: z.uuid(),
  organized: z.boolean().default(false),
  planned_at: z.string().optional(),
  timezone: z.string().min(1),
  agent_id: z.string().trim().min(1).optional(),
});

/** 提交重试使用相同任务目录，避免响应丢失后创建第二条任务。 */
export async function capture_task(
  definitions: TaskDefinitionRepository,
  input: TaskCaptureInput,
  delivery_session?: TaskDeliverySession,
): Promise<{ /** 已保存的稳定任务 ID。 */ task_id: string }> {
  const value = capture_schema.parse(input);
  const workflow = normalize_task_state({ organized: value.organized, planned_at: value.planned_at, timezone: value.timezone });
  const source_key = delivery_session ? JSON.stringify(delivery_session) : "desktop";
  const task_id = delivery_session
    ? `task_${createHash("sha256").update(`${source_key}:${value.submission_id}`).digest("hex").slice(0, 40)}`
    : `task_${value.submission_id}`;
  await definitions.mutate(async (storage) => {
    if (await storage.files.path_exists(getTaskPath(storage.path!, task_id))) {
      const previous = await readTask({ storage, taskId: task_id });
      // 同一 submission_id 只能对应同一份原文；否则说明客户端复用了提交标识。
      if (previous.submission_id !== value.submission_id || (previous.source ?? "") !== value.text) {
        throw new Error("提交标识已用于另一条任务，请重新提交");
      }
      return;
    }
    await writeTask({
      storage,
      taskId: task_id,
      task: {
        taskId: task_id,
        title: value.text.split(/\r?\n/)[0].slice(0, 100),
        when: "@manual",
        kind: "user",
        agent_id: "",
        workspace_id: "",
        ...(delivery_session ? { delivery_session } : {}),
        source: value.text,
        submission_id: value.submission_id,
        ...(value.agent_id ? { source_agent_id: value.agent_id } : {}),
        preparing: { revision: 1, status: "queued", supplements: [], questions: [] },
        body: value.text,
        workflow,
        schedule: "paused",
        taskPath: "",
      },
    });
  });
  return { task_id };
}

/** 为原任务提交新生成版本；结构化创建的任务同样保留身份和历史。 */
export async function revise_task(
  definitions: TaskDefinitionRepository,
  task_id: string,
  input: TaskGenerateInput,
): Promise<void> {
  await definitions.mutate(async (storage) => {
    const task = await readTask({ storage, taskId: task_id });
    if (definitions.is_running(task_id)) throw new Error("执行期间不能重新生成任务");
    if (task_work_is_closed(task)) throw new Error("已完成或取消的任务请先重新打开");
    if (task.kind === "script") throw new Error("脚本任务请直接编辑定义");
    const preparation = task.preparing;
    task.schedule = "paused";
    task.source ??= [task.title, task.body].filter(Boolean).join("\n\n");
    task.submission_id ??= randomUUID();
    if (input.agent_id) task.source_agent_id = input.agent_id;
    task.preparing = {
      revision: (preparation?.revision ?? 0) + 1,
      status: "queued",
      supplements: [...(preparation?.supplements ?? []), ...(input.text ? [input.text] : [])],
      questions: [],
      analyzed_body: preparation?.analyzed_body ?? task.body,
      assumptions: preparation?.assumptions,
    };
    await writeTask({ storage, taskId: task_id, task, overwrite: true });
  });
}
