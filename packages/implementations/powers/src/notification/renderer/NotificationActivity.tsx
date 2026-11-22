/** Notification 的业务动作展示；宿主页面同步本身不产生新的聊天输入。 */
import { action_sentences, preparing_sentence } from "./NotificationCopy.js";
import { with_activity_error } from "@downcity/city/power/react";
import type { PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { action_of, call_tone, chinese, data_of, record } from "@/builtin/renderer/ActivityContent.js";

/** 普通同步保持单行，只有需要处理的错误才提供正文。 */
function describe(props: PowerActivityProps) {
  const action = action_of(props).replace(/^notification\./, "");
  const tone = call_tone(props);
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "complete" && action === "respond") {
    const data = data_of(props);
    const response = record(data.response);
    const decision = record(response.payload).decision;
    if (data.status === "denied") sentence = ["已拒绝", "Declined"];
    else if (data.status === "resolved" && response.type === "approval" && decision === "approved") sentence = ["已允许", "Allowed"];
    else if (data.status === "resolved" && response.type === "approval" && decision === "denied") sentence = ["已拒绝", "Declined"];
    else if (data.status === "resolved" && response.type === "question") sentence = ["回答已发送", "Answer sent"];
  }
  if (tone === "failed") sentence = (action_sentences[action] ?? action_sentences.unknown)!.failed;
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  return { title: sentence[chinese(props.locale) ? 0 : 1]!, tone, has_detail: false };
}
/** Notification 自有活动插槽。 */
export const NOTIFICATION_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe });
