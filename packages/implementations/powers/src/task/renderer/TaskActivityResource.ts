/** Task activity 的单个主对象映射；只消费 action 回执，不从标题或执行 ID 猜任务身份。 */
import type { PowerActivityProps, PowerActivityResource } from "@downcity/city/power/react";
import { action_of, args_of, chinese, data_of, preview, record, text } from "@/builtin/renderer/ActivityContent.js";

/** Task 结果复用任务页，只有 run_detail 附带执行定位。 */
export function task_activity_resource(props: PowerActivityProps): PowerActivityResource | undefined {
  if (props.tool.state !== "completed") return;
  const action = action_of(props);
  if (!["create", "generate", "update", "run", "work", "status", "enable", "disable", "history", "run_detail"].includes(action)) return;
  const data = data_of(props);
  const definition = action === "generate" ? record(record(data.task).definition) : record(data.task);
  const task_id = text(data.task_id) || text(definition.taskId);
  if (!task_id) return;
  const args = args_of(props);
  const label = preview(definition.title) || preview(data.title) || (action === "create" ? preview(args.title) : "") || (chinese(props.locale) ? "任务" : "Task");
  const timestamp = action === "run_detail" ? text(record(data.run).timestamp) : "";
  if (action === "run_detail" && !timestamp) return;
  return { type: "task", task_id, label, ...(timestamp ? { run_timestamp: timestamp } : {}) };
}
