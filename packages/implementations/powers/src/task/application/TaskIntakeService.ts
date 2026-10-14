/** 即时录入应用服务：原文与提交身份在统一任务事务内保存，不调用模型。 */
import { z } from "zod";
import { createHash } from "node:crypto";
import type { TaskDeliverySession } from "../types/Task.js";
import type { TaskCaptureInput } from "../types/TaskIntake.js";
import type { TaskDefinitionRepository } from "../runtime/TaskDefinitionRepository.js";
import { readTask, writeTask } from "../runtime/Store.js";
import { normalize_task_workflow } from "../runtime/TaskWorkflowModel.js";
import { getTaskMdPath } from "../runtime/Paths.js";

const capture_schema = z.object({
  text: z.string().trim().min(1).max(24000),
  submission_id: z.uuid(),
  organized: z.boolean().default(false),
  planned_at: z.string().optional(),
  timezone: z.string().min(1),
});

/** 提交重试使用相同任务目录，避免响应丢失后创建第二条任务。 */
export async function capture_task(definitions: TaskDefinitionRepository, input: TaskCaptureInput, delivery_session?: TaskDeliverySession): Promise<{ /** 已保存的稳定任务 ID。 */ task_id: string }> {
  const value = capture_schema.parse(input);
  const workflow = normalize_task_workflow({ organized: value.organized, planned_at: value.planned_at, timezone: value.timezone });
  const source_key = delivery_session ? JSON.stringify(delivery_session) : "desktop";
  const task_id = delivery_session
    ? `task_${createHash("sha256").update(`${source_key}:${value.submission_id}`).digest("hex").slice(0, 40)}`
    : `task_${value.submission_id}`;
  const request_key = JSON.stringify({ source_key, text: value.text, organized: value.organized, planned_at: workflow.planned_at ?? null, timezone: workflow.timezone });
  await definitions.mutate(async (storage) => {
    if (await storage.files.path_exists(getTaskMdPath(storage.path!, task_id))) {
      const previous = await readTask({ storage, taskId: task_id });
      if (previous.frontmatter.intake?.request_key !== request_key) throw new Error("提交标识已用于另一条任务，请重新提交");
      return;
    }
    await writeTask({ storage, taskId: task_id, body: value.text, frontmatter: {
      title: value.text.split(/\r?\n/)[0].slice(0, 100),
      description: value.text.slice(0, 160), kind: "self", agent_id: "", workspace_id: "",
      when: "@manual", status: "paused", workflow,
      ...(delivery_session ? { delivery_session } : {}),
      intake: { submission_id: value.submission_id, text: value.text, request_key },
      preparation: { revision: 1, status: "queued", supplements: [], questions: [] },
    } });
  });
  return { task_id };
}
