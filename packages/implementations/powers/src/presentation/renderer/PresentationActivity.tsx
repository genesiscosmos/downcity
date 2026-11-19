/** Presentation 的正文由正式 message 展示；活动只描述发布结果，不重复 DSL 或预览。 */
import type { PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, call_tone, chinese, error_of } from "@/builtin/renderer/ActivityContent.js";

/** 发布生命周期的完整句子归 Presentation 所有。 */
function describe(props: PowerActivityProps) {
  const tone = call_tone(props);
  const zh = chinese(props.locale);
  const action = action_of(props);
  const sentence = props.tool.state === "input-streaming" ? ["正在准备展示内容", "Preparing presentation"]
    : tone === "failed" ? ["交互内容发布失败", "Presentation failed to publish"]
    : tone === "waiting" ? ["交互内容发布等待确认", "Presentation awaiting confirmation"]
    : action !== "show" ? ["已读取 Presentation 动作", "Presentation actions read"]
    : tone === "complete" ? ["交互内容已发布", "Presentation published"] : ["正在发布交互内容", "Publishing presentation"];
  return { title: sentence[zh ? 0 : 1]!, tone, has_detail: tone === "failed" && Boolean(error_of(props)) };
}
/** 只显示可处理错误，正式内容去重规则仍由 message/preview 协议负责。 */
function detail(props: PowerActivityProps) { return <ActivityText render_text={props.render_text} error={error_of(props)} />; }
/** Presentation 自有插槽。 */
export const PRESENTATION_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
