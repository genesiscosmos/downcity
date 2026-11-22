/** AI 的生成排队、处理中、成功与转写/语音结果分别展示，不重复正式 Power message。 */
import { action_sentences, preparing_sentence } from "./AiCopy.js";
import { with_activity_error } from "./ActivityError.js";
import { createElement as create_element } from "react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, is_chinese, output_data, record_value, text_value } from "./Activity.js";


/** 只读取实际输出文件，不根据 prompt 或输入猜媒体。 */
function files(props: PowerActivityProps): string[] {
  const value = output_data(props).files;
  return Array.isArray(value) ? value.slice(0, 12).filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

/** 活动描述本次调用；图片后台阶段留在结果正文与后续 Input，不覆盖调用终态。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_id(props);
  const data = output_data(props);
  const tone = activity_tone(props);
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "failed") sentence = (action_sentences[action] ?? action_sentences.unknown)!.failed;
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  const formal_messages = record_value(props.tool.output).messages;
  const has_formal_message = Array.isArray(formal_messages) && formal_messages.length > 0;
  const has_result = !has_formal_message && (action === "sound.asr" && Boolean(text_value(data.text).trim()) || (action === "image.result" || action === "sound.tts") && files(props).length > 0);
  return { title: sentence[is_chinese(props.locale) ? 0 : 1]!, tone,
    has_detail: !["", "image.models", "sound.models"].includes(action) && Boolean(has_result || failure_text(props) || action === "image.result" && ["queued", "running", "succeeded", "failed"].includes(text_value(data.status))) };
}

/** 已授权文件交给宿主原有附件端口；无端口时使用只读文件路径。 */
function detail(props: PowerActivityProps) {
  const action = action_id(props);
  const data = output_data(props);
  const transcript = action === "sound.asr" ? text_value(data.text).slice(0, 48_000) : "";
  const stages: Readonly<Record<string, readonly [string, string]>> = {
    queued: ["等待生成", "Pending"], running: ["生成中", "Generating"],
    succeeded: ["已生成", "Generated"], failed: ["生成失败", "Generation failed"],
  };
  const stage = action === "image.result" ? stages[text_value(data.status)]?.[is_chinese(props.locale) ? 0 : 1] : undefined;
  return create_element("div", { className: "space-y-3 p-3 text-xs" },
    stage ? create_element("p", null, `${is_chinese(props.locale) ? "查询时状态" : "Status when checked"}: ${stage}`) : null,
    transcript ? props.render_text?.(transcript) ?? create_element("p", { className: "whitespace-pre-wrap" }, transcript) : null,
    ...files(props).map((url, index) => create_element("div", { key: index }, props.render_file?.({ type: "file", url, media_type: action === "sound.tts" ? "audio/mpeg" : "image/png" }) ?? create_element("p", null, url))));
}
/** AI 自有插槽。 */
export const AI_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail });
