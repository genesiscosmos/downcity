/** Memory activity 的逻辑对象映射；知识身份不从文件路径或 ID 格式推导，读取范围由宿主绑定。 */
import type { PowerActivityProps, PowerActivityResource } from "@downcity/city/power/react";
import { action_of, args_of, call_tone, chinese, data_of, preview, record, text } from "@/builtin/renderer/ActivityContent.js";

/** 仅为明确知识条目提供引用；Profile 和 Job 不属于 memory_detail。 */
export function memory_activity_resource(props: PowerActivityProps): PowerActivityResource | undefined {
  if (props.tool.state !== "completed" || call_tone(props) !== "complete") return;
  const action = action_of(props);
  const args = args_of(props);
  const data = data_of(props);
  const memory = record(data.memory);
  let memory_id = "";
  let target = "";
  if (action === "remember" && data.mode === "knowledge") {
    memory_id = text(data.memory_id);
    target = text(data.target);
  } else if (action === "read" && text(memory.memory_id)) {
    memory_id = text(memory.memory_id);
    const subject = record(memory.subject);
    target = subject.kind === "workspace" || subject.kind === "city" ? "current_workspace" : subject.kind === "agent" || subject.kind === "user" ? text(subject.kind) : "";
  } else if (action === "revise" && data.kind === "revise" && data.mode === "knowledge" && text(data.job_id)) {
    // 已受理的 revise 在应用层读取并授权原 memory_id；不把 job_id 或未来 memory_ids 当作原对象。
    memory_id = text(args.memory_id);
    target = text(data.target);
  }
  if (!memory_id || !["agent", "user", "current_workspace"].includes(target)) return;
  const metadata = record(memory.metadata);
  // Provider 允许把逻辑 ID 作为 metadata.title 的存储回退；活动名称不能暴露这类技术标识。
  const stored_title = text(metadata.title);
  const label = (stored_title !== memory_id ? preview(stored_title) : "") || preview(memory.topic) || preview(args.topic) || preview(args.title) || (chinese(props.locale) ? "记忆" : "Memory");
  return { type: "memory", memory_id, scope: target === "current_workspace" ? "city" : "agent", label };
}
