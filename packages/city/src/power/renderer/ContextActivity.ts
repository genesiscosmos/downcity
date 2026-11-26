/** Context 事实查询保持精简；接口发现与脚本执行提供按需加载的有界详情。 */
import { action_sentences, preparing_sentence } from "./ContextCopy.js";
import { with_activity_error } from "./ActivityError.js";
import { context_detail } from "./ContextDetail.js";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, record_value, short_text, text_value } from "./Activity.js";

/** allowed=false 是访问检查的业务结果，不能从查询成功推断可访问。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_id(props);
  const data = output_data(props);
  const call_tone = activity_tone(props);
  const tone = call_tone === "complete" && action === "execute" && ["failed", "timed_out", "cancelled"].includes(text_value(data.status)) ? "failed" : call_tone;
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
  if (props.tool.state === "completed" && action === "execute" && tone === "failed") {
    if (data.status === "timed_out") sentence = ["脚本执行超时", "Script execution timed out"];
    if (data.status === "cancelled") sentence = ["脚本执行已取消", "Script execution was cancelled"];
  }
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  const workspace = record_value(data.workspace);
  const resource = props.tool.state === "completed" && tone === "complete" && action === "workspaces.get" && text_value(workspace.workspace_id)
    ? { type: "workspace" as const, workspace_id: text_value(workspace.workspace_id), label: short_text(workspace.name) || (is_chinese(props.locale) ? "工作区" : "Workspace") } : undefined;
  const execution_error = action === "execute" && tone === "failed" ? short_text(record_value(data.error).message) : undefined;
  return { title: sentence[is_chinese(props.locale) ? 0 : 1]!, tone, resource,
    ...(execution_error ? { error: { reason: execution_error } } : {}),
    summary: resource?.label || (action === "help" ? short_text(input_args(props).symbol) || short_text(input_args(props).query) : action === "sandbox.explain_path" ? short_text(input_args(props).path) : undefined),
    has_detail: action === "help" || action === "execute" || action === "" && Array.isArray(data.actions) && data.actions.length > 0
      || action !== "workspaces.list" && action !== "sandbox.list_mounts" && Boolean(failure_text(props) || action === "sandbox.explain_path" && data.allowed === false && text_value(data.reason).trim()) };
}
/** Context 自有插槽；详情仅在宿主展开活动时读取。 */
export const CONTEXT_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail: context_detail });
