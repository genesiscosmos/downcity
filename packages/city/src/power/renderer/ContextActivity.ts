/** Context 查询默认单行；路径拒绝提供必要原因，不倾倒运行环境或系统字段。 */
import { createElement as create_element } from "react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, short_text, text_value } from "./Activity.js";

/** 完整查询结果句子。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 Context 动作", "Context actions read"], "env.get": ["已读取当前环境", "Current environment read"],
  "sandbox.get": ["已查看沙箱边界", "Sandbox boundaries read"], "sandbox.list_mounts": ["已列出沙箱挂载", "Sandbox mounts listed"],
  "sandbox.explain_path": ["已检查路径访问权限", "Path access checked"], "workspaces.get": ["已读取工作区", "Workspace read"],
  "workspaces.list": ["已列出工作区", "Workspaces listed"], "usage.get": ["已读取用量", "Usage read"],
};
/** 进行中业务句子。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  "env.get": ["正在读取当前环境", "Reading current environment"], "sandbox.get": ["正在查看沙箱边界", "Reading sandbox boundaries"],
  "sandbox.list_mounts": ["正在查看沙箱挂载", "Reading sandbox mounts"], "sandbox.explain_path": ["正在检查路径访问", "Checking path access"],
  "workspaces.get": ["正在读取工作区", "Reading workspace"], "workspaces.list": ["正在查找工作区", "Finding workspaces"], "usage.get": ["正在读取用量", "Reading usage"],
};
/** allowed=false 是访问检查的业务结果，不能从查询成功推断可访问。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_id(props);
  const data = output_data(props);
  let tone = activity_tone(props);
  let sentence = (tone === "complete" ? completed[action] : running[action]) ?? ["环境查询已返回", "Environment query returned"];
  if (tone === "complete" && action === "sandbox.explain_path" && data.allowed === false) { tone = "failed"; sentence = ["路径访问被拒绝", "Path access denied"]; }
  if (tone === "failed" && data.allowed !== false) sentence = ["环境查询失败", "Environment query failed"];
  if (tone === "waiting") sentence = ["环境查询等待确认", "Environment query awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备环境查询", "Preparing environment query"];
  return { title: sentence[is_chinese(props.locale) ? 0 : 1]!, tone, summary: action === "sandbox.explain_path" ? short_text(input_args(props).path) : undefined,
    has_detail: action !== "workspaces.list" && action !== "sandbox.list_mounts" && Boolean(failure_text(props) || action === "sandbox.explain_path" && data.allowed === false && text_value(data.reason).trim()) };
}
/** 只呈现用户可操作的访问原因和异常。 */
function detail(props: PowerActivityProps) {
  const data = output_data(props);
  const error = failure_text(props) || (action_id(props) === "sandbox.explain_path" && data.allowed === false ? text_value(data.reason) : "");
  return create_element("p", { className: "p-3 text-xs text-destructive whitespace-pre-wrap" }, error.slice(0, 4_000));
}
/** Context 自有插槽。 */
export const CONTEXT_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
