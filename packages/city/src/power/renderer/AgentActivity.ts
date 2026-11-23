/** Agent 创建与委派受理属于本次调用；异步工作终态由 Session Input 展示。 */
import { action_sentences, preparing_sentence } from "./AgentCopy.js";
import { with_activity_error } from "./ActivityError.js";
import { createElement as create_element } from "react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, record_value, short_text, text_value } from "./Activity.js";

/** 列表单行；创建说明和委派指令有正文才展开。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_id(props);
  const args = input_args(props);
  const data = output_data(props);
  const tone = props.tool.state === "completed" && data.accepted === false ? "failed" : activity_tone(props);
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "complete" && action === "agent.list" && Array.isArray(data.agents)) {
    const count = data.agents.length;
    sentence = [`已列出 ${count} 个可用 Agent`, `Listed ${count} available ${count === 1 ? "agent" : "agents"}`];
  }
  if (tone === "failed") sentence = (action_sentences[action] ?? action_sentences.unknown)!.failed;
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  const created = record_value(data.agent);
  const agent_id = action === "agent.create" ? text_value(created.agent_id) : action === "agent.delegate" ? text_value(data.agent_id) : "";
  const label = short_text(created.name) || short_text(args.name) || "Agent";
  const resource = props.tool.state === "completed" && agent_id && (tone === "complete" || action === "agent.create" && Boolean(created.agent_id))
    ? { type: "agent" as const, agent_id, label } : undefined;
  return { title: sentence[is_chinese(props.locale) ? 0 : 1]!, tone, resource,
    summary: resource?.label || short_text(args.title) || short_text(created.name) || short_text(args.name),
    has_detail: (action === "agent.create" || action === "agent.delegate") && Boolean(text_value(action === "agent.delegate" ? args.query : args.description).trim() || failure_text(props)) };
}
/** 没有执行网关，只读必要的工作目标。 */
function detail(props: PowerActivityProps) {
  const args = input_args(props);
  const body = text_value(action_id(props) === "agent.delegate" ? args.query : args.description).slice(0, 24_000);
  return create_element("div", { className: "space-y-3 p-3 text-xs" },
    body ? props.render_text?.(body) ?? create_element("p", { className: "whitespace-pre-wrap" }, body) : null);
}
/** Agent 自有插槽。 */
export const AGENT_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail });
