/** Messenger 发送回执描述 Outbox 的真实阶段；入队不等于平台送达。 */
import { action_sentences, preparing_sentence } from "./MessengerCopy.js";
import { with_activity_error } from "@downcity/city/power/react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, call_tone, chinese, data_of, error_of, items, preview, record, text } from "@/builtin/renderer/ActivityContent.js";


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
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "complete" && (action === "send" || action === "react") && data.status === "delivered") sentence = action === "send"
    ? ["消息已送达", "Message delivered"] : ["回应已添加", "Reaction added"];
  if (tone === "failed") sentence = (action_sentences[action] ?? action_sentences.unknown)!.failed;
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  return { title: sentence[chinese(props.locale) ? 0 : 1]!, tone, summary: action === "context" ? preview(data.title) : undefined,
    has_detail: action !== "list" && action !== "" && Boolean(history_texts(props).length || error_of(props)) };
}
/** 在展开后截取正文，保持历史原有顺序。 */
function detail(props: PowerActivityProps) { return <ActivityText render_text={props.render_text} body={history_texts(props).map(body => body.slice(0, 4_000)).join("\n\n")} />; }
/** Messenger 自有活动插槽。 */
export const MESSENGER_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail });
