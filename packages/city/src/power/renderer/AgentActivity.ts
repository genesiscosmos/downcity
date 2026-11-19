/** Agent 创建与委派受理属于本次调用；异步工作终态由 Session Input 展示。 */
import { createElement as create_element } from "react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, record_value, short_text, text_value } from "./Activity.js";

/** 每个 Agent action 的完整业务句子。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 Agent 动作", "Agent actions read"], "agent.list": ["已列出可用 Agent", "Available agents listed"],
  "agent.create": ["Agent 已创建", "Agent created"], "agent.delegate": ["Agent 工作已委派", "Agent work delegated"],
};
/** 进行中句子。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  "agent.list": ["正在查找 Agent", "Finding agents"], "agent.create": ["正在创建 Agent", "Creating agent"],
  "agent.delegate": ["正在委派 Agent 工作", "Delegating agent work"],
};
/** 列表单行；创建说明和委派指令有正文才展开。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_id(props);
  const args = input_args(props);
  const data = output_data(props);
  const tone = data.accepted === false ? "failed" : activity_tone(props);
  let sentence = (tone === "complete" ? completed[action] : running[action]) ?? ["Agent 操作已返回", "Agent operation returned"];
  if (tone === "failed") sentence = ["Agent 操作失败", "Agent operation failed"];
  if (tone === "waiting") sentence = ["Agent 操作等待确认", "Agent operation awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备 Agent 操作", "Preparing Agent operation"];
  return { title: sentence[is_chinese(props.locale) ? 0 : 1]!, tone,
    summary: short_text(args.title) || short_text(record_value(data.agent).name) || short_text(args.name),
    has_detail: (action === "agent.create" || action === "agent.delegate") && Boolean(text_value(action === "agent.delegate" ? args.query : args.description).trim() || failure_text(props)) };
}
/** 没有执行网关，只读必要的工作目标。 */
function detail(props: PowerActivityProps) {
  const args = input_args(props);
  const body = text_value(action_id(props) === "agent.delegate" ? args.query : args.description).slice(0, 24_000);
  const error = failure_text(props).slice(0, 4_000);
  return create_element("div", { className: "space-y-3 p-3 text-xs" },
    body ? props.render_text?.(body) ?? create_element("p", { className: "whitespace-pre-wrap" }, body) : null,
    error ? create_element("p", { className: "text-destructive whitespace-pre-wrap" }, error) : null);
}
/** Agent 自有插槽。 */
export const AGENT_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
