/** Messenger 发送回执描述 Outbox 的真实阶段；入队不等于平台送达。 */
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, call_tone, chinese, data_of, error_of, items, preview, record, text } from "@/builtin/renderer/ActivityContent.js";

/** 已完成调用的完整业务句子。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 Messenger 动作", "Messenger actions read"], context: ["已读取当前聊天上下文", "Current conversation read"],
  list: ["已列出外部聊天", "External conversations listed"], history: ["已读取聊天历史", "Conversation history read"],
  send: ["消息发送请求已返回", "Message request returned"], react: ["消息回应请求已返回", "Reaction request returned"],
};
/** 进行中业务句子。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  context: ["正在查看当前聊天", "Reading current conversation"], list: ["正在查找外部聊天", "Finding external conversations"],
  history: ["正在读取聊天历史", "Reading conversation history"], send: ["正在提交消息发送", "Submitting message"], react: ["正在提交消息回应", "Submitting reaction"],
};

/** canonical 历史只选 text part，不显示路由、工具参数、内部 context 或 reasoning。 */
function history_texts(props: PowerActivityProps): string[] {
  if (action_of(props) !== "history") return [];
  const data = data_of(props);
  return items(data.kind === "json" ? data.value : record(props.tool.output).data).flatMap(message => items(message.parts)
    .filter(part => part.type === "text" && text(part.text).trim()).map(part => text(part.text)));
}

/** 只有明确送达回执才能显示送达；发送全文不默认重复回显。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const data = data_of(props);
  let tone = call_tone(props);
  let sentence = (tone === "complete" ? completed[action] : running[action]) ?? ["聊天操作已返回", "Conversation operation returned"];
  if (tone === "complete" && (action === "send" || action === "react")) {
    if (data.status === "pending") sentence = action === "send" ? ["消息已加入发送队列", "Message queued"] : ["消息回应已加入发送队列", "Reaction queued"];
    else if (data.status === "delivered") sentence = action === "send" ? ["消息已送达", "Message delivered"] : ["消息回应已送达", "Reaction delivered"];
    else if (data.status === "retry_wait") { tone = "running"; sentence = action === "send" ? ["消息等待重试发送", "Message awaiting retry"] : ["消息回应等待重试", "Reaction awaiting retry"]; }
    else if (data.status === "sending") { tone = "running"; sentence = action === "send" ? ["消息正在发送", "Message is being sent"] : ["消息回应正在发送", "Reaction is being sent"]; }
    else if (data.status === "failed") tone = "failed";
  }
  if (tone === "failed") sentence = action === "send" ? ["消息发送失败", "Message failed"] : action === "react" ? ["消息回应失败", "Reaction failed"] : ["聊天读取失败", "Conversation read failed"];
  if (tone === "waiting") sentence = ["聊天操作等待确认", "Conversation operation awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备聊天操作", "Preparing conversation operation"];
  return { title: sentence[chinese(props.locale) ? 0 : 1]!, tone, summary: action === "context" ? preview(data.title) : undefined,
    has_detail: action !== "list" && action !== "" && Boolean(history_texts(props).length || error_of(props)) };
}
/** 在展开后截取正文，保持历史原有顺序。 */
function detail(props: PowerActivityProps) { return <ActivityText render_text={props.render_text} body={history_texts(props).map(body => body.slice(0, 4_000)).join("\n\n")} error={error_of(props)} />; }
/** Messenger 自有活动插槽。 */
export const MESSENGER_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
