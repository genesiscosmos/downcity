/** 创建、生成与手动编辑共用的触发规则校验；一次性触发必须是未来的绝对时间。 */
import { normalizeTaskWhen } from "../runtime/Model.js";

/** 规范化触发规则，并拒绝已经过去的一次性时间；已有未改变的时间可用于编辑历史任务。 */
export function validate_task_schedule(when: string, previous_when?: string): string {
  const normalized = normalizeTaskWhen(when);
  if (!normalized.ok) throw new Error(normalized.error);
  if (normalized.value.startsWith("time:") && normalized.value !== previous_when && Date.parse(normalized.value.slice(5)) <= Date.now()) {
    throw new Error("计划时间已过，请选择未来时间或立即开始");
  }
  return normalized.value;
}
