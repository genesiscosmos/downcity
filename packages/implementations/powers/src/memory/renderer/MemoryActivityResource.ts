/** Memory 活动引用真实逻辑对象及归属；Job 单独打开固定详情，不猜测标题或物理地址。 */
import type { PowerActivityProps, PowerActivityResource } from "@downcity/city/power/react";
import { action_of, call_tone, chinese, data_of, record, text } from "@/builtin/renderer/ActivityContent.js";
import { memory_display_label } from "../runtime/MemorySchema.js";

/** 仅从成功的可信回执映射资源，删除活动不回显旧正文。 */
export function memory_activity_resource(props: PowerActivityProps): PowerActivityResource | undefined {
  if (props.tool.state !== "completed" || call_tone(props) !== "complete") return;
  const action = action_of(props);
  const data = data_of(props);
  const job = action === "job_detail" ? record(data.job) : data;
  if (text(job.job_id)) return { type: "memory_job", job_id: text(job.job_id), label: chinese(props.locale) ? "记忆处理记录" : "Memory processing" };
  const memory = action === "read" ? record(data.memory) : ["remember", "update"].includes(action) ? record(data.record) : {};
  const scope = record(memory.scope);
  if (!text(memory.memory_id) || memory.state !== "active" || !["agent", "user", "workspace"].includes(text(scope.type))) return;
  const kind = memory.kind === "agreement" ? "agreement" : memory.kind === "knowledge" ? "knowledge" : undefined;
  if (!kind || typeof memory.content !== "string" || (kind === "knowledge" && typeof memory.title !== "string")) return;
  const label = kind === "agreement" ? memory_display_label({ kind, content: memory.content }) : memory_display_label({ kind, title: text(memory.title), content: memory.content });
  return { type: "memory", memory_id: text(memory.memory_id), scope: scope.type as "agent" | "user" | "workspace", kind, label };
}
