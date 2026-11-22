/** Presentation 的正文由正式 message 展示；活动只描述发布结果，不重复 DSL 或预览。 */
import { action_sentences, preparing_sentence } from "./PresentationCopy.js";
import { with_activity_error } from "@downcity/city/power/react";
import type { PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { action_of, call_tone, chinese } from "@/builtin/renderer/ActivityContent.js";

/** 发布生命周期的完整句子归 Presentation 所有。 */
function describe(props: PowerActivityProps) {
  const tone = call_tone(props);
  const zh = chinese(props.locale);
  const action = action_of(props);
  const sentence = props.tool.state === "input-streaming" ? preparing_sentence : (action_sentences[action] ?? action_sentences.unknown)![tone];
  return { title: sentence[zh ? 0 : 1]!, tone, has_detail: false };
}
/** Presentation 自有插槽。 */
export const PRESENTATION_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe });
