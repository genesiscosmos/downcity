/** AI 的生成排队、处理中、成功与转写/语音结果分别展示，不重复正式 Power message。 */
import { createElement as create_element } from "react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, is_chinese, output_data, record_value, text_value } from "./Activity.js";

/** 模型枚举是单行；每个业务动作维护完整句子。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 AI 动作", "AI actions read"], "image.models": ["已列出图片模型", "Image models listed"],
  "image.create": ["图片生成请求已提交", "Image generation requested"], "image.result": ["已查看图片生成结果", "Image generation result read"],
  "sound.models": ["已列出语音模型", "Audio models listed"], "sound.asr": ["音频已转写", "Audio transcribed"], "sound.tts": ["语音已合成", "Speech synthesized"],
};
/** 进行中句子不从动作名称拼接。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  "image.models": ["正在查找图片模型", "Finding image models"], "image.create": ["正在提交图片生成", "Requesting image generation"],
  "image.result": ["正在读取图片结果", "Reading image result"], "sound.models": ["正在查找语音模型", "Finding audio models"],
  "sound.asr": ["正在转写音频", "Transcribing audio"], "sound.tts": ["正在合成语音", "Synthesizing speech"],
};

/** 只读取实际输出文件，不根据 prompt 或输入猜媒体。 */
function files(props: PowerActivityProps): string[] {
  const value = output_data(props).files;
  return Array.isArray(value) ? value.slice(0, 12).filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

/** 图片成功以 Job status 为准，create 受理不表示生成结束。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_id(props);
  const data = output_data(props);
  let tone = activity_tone(props);
  let sentence = (tone === "complete" ? completed[action] : running[action]) ?? ["正在处理 AI 操作", "Processing AI operation"];
  if (tone === "complete" && (action === "image.create" || action === "image.result")) {
    if (data.status === "queued") sentence = ["图片生成已排队", "Image generation queued"];
    else if (data.status === "running") { tone = "running"; sentence = ["图片正在生成", "Image generation in progress"]; }
    else if (data.status === "succeeded") sentence = ["图片已生成", "Images generated"];
    else if (data.status === "failed") tone = "failed";
  }
  if (tone === "failed") sentence = ["AI 操作失败", "AI operation failed"];
  if (tone === "waiting") sentence = ["AI 操作等待确认", "AI operation awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备 AI 操作", "Preparing AI operation"];
  const formal_messages = record_value(props.tool.output).messages;
  const has_formal_message = Array.isArray(formal_messages) && formal_messages.length > 0;
  const has_result = !has_formal_message && (action === "sound.asr" && Boolean(text_value(data.text).trim()) || (action === "image.result" || action === "sound.tts") && files(props).length > 0);
  return { title: sentence[is_chinese(props.locale) ? 0 : 1]!, tone,
    has_detail: !["", "image.models", "sound.models"].includes(action) && Boolean(has_result || failure_text(props)) };
}

/** 已授权文件交给宿主原有附件端口；无端口时使用只读文件路径。 */
function detail(props: PowerActivityProps) {
  const action = action_id(props);
  const data = output_data(props);
  const transcript = action === "sound.asr" ? text_value(data.text).slice(0, 48_000) : "";
  const error = failure_text(props).slice(0, 4_000);
  return create_element("div", { className: "space-y-3 p-3 text-xs" },
    transcript ? props.render_text?.(transcript) ?? create_element("p", { className: "whitespace-pre-wrap" }, transcript) : null,
    ...files(props).map((url, index) => create_element("div", { key: index }, props.render_file?.({ type: "file", url, media_type: action === "sound.tts" ? "audio/mpeg" : "image/png" }) ?? create_element("p", null, url))),
    error ? create_element("p", { className: "text-destructive whitespace-pre-wrap" }, error) : null);
}
/** AI 自有插槽。 */
export const AI_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
