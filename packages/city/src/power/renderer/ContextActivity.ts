/** Context 查询默认单行；路径拒绝提供必要原因，不倾倒运行环境或系统字段。 */
import { action_sentences, preparing_sentence } from "./ContextCopy.js";
import { with_activity_error } from "./ActivityError.js";
import { createElement as create_element } from "react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, record_value, short_text, text_value } from "./Activity.js";

/** allowed=false 是访问检查的业务结果，不能从查询成功推断可访问。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_id(props);
  const data = output_data(props);
  const tone = activity_tone(props);
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "failed") sentence = (action_sentences[action] ?? action_sentences.unknown)!.failed;
  if (tone === "complete" && action === "workspaces.list" && Array.isArray(data.workspaces)) {
    const count = data.workspaces.length;
    sentence = count === 0 ? ["未找到工作区", "Found no workspaces"]
      : [`已找到 ${count} 个工作区`, `Found ${count} ${count === 1 ? "workspace" : "workspaces"}`];
  }
  if (tone === "complete" && action === "sandbox.list_mounts" && Array.isArray(data.mounts)) {
    const count = data.mounts.length;
    sentence = count === 0 ? ["未找到挂载目录", "Found no mounted directories"]
      : [`已找到 ${count} 个挂载目录`, `Found ${count} mounted ${count === 1 ? "directory" : "directories"}`];
  }
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  const workspace = record_value(data.workspace);
  const resource = props.tool.state === "completed" && tone === "complete" && action === "workspaces.get" && text_value(workspace.workspace_id)
    ? { type: "workspace" as const, workspace_id: text_value(workspace.workspace_id), label: short_text(workspace.name) || (is_chinese(props.locale) ? "工作区" : "Workspace") } : undefined;
  return { title: sentence[is_chinese(props.locale) ? 0 : 1]!, tone, resource, summary: resource?.label || (action === "sandbox.explain_path" ? short_text(input_args(props).path) : undefined),
    has_detail: action !== "workspaces.list" && action !== "sandbox.list_mounts" && Boolean(failure_text(props) || action === "sandbox.explain_path" && data.allowed === false && text_value(data.reason).trim()) };
}
/** 只呈现用户可操作的访问原因和异常。 */
function detail(props: PowerActivityProps) {
  const data = output_data(props);
  const reason = action_id(props) === "sandbox.explain_path" && data.allowed === false ? text_value(data.reason) : "";
  return create_element("p", { className: "text-muted-foreground whitespace-pre-wrap" }, reason.slice(0, 4_000));
}
/** Context 自有插槽。 */
export const CONTEXT_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail });
