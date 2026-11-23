/** AI 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "image.models": {
    running: ["正在查看图片模型", "Checking image models"],
    complete: ["已查看图片模型", "Checked image models"],
    failed: ["未能查看图片模型", "Could not list image models"],
    waiting: ["等待你允许查看图片模型", "Waiting for permission to check image models"],
  },
  "image.create": {
    running: ["正在准备生成图片", "Preparing image generation"],
    complete: ["已安排图片生成", "Scheduled image generation"],
    failed: ["未能生成图片", "Could not generate image"],
    waiting: ["等待你允许生成图片", "Waiting for permission to generate the image"],
  },
  "image.result": {
    running: ["正在查看图片进度", "Checking image progress"],
    complete: ["已查看图片进度", "Checked image progress"],
    failed: ["未能查看图片进度", "Could not check image progress"],
    waiting: ["等待你允许查看图片进度", "Waiting for permission to check image progress"],
  },
  "sound.models": {
    running: ["正在查看语音模型", "Checking audio models"],
    complete: ["已查看语音模型", "Checked audio models"],
    failed: ["未能查看语音模型", "Could not list audio models"],
    waiting: ["等待你允许查看语音模型", "Waiting for permission to check audio models"],
  },
  "sound.asr": {
    running: ["正在转写音频", "Transcribing audio"],
    complete: ["已转写音频", "Transcribed audio"],
    failed: ["未能转写音频", "Could not transcribe audio"],
    waiting: ["等待你允许转写音频", "Waiting for permission to transcribe audio"],
  },
  "sound.tts": {
    running: ["正在生成语音", "Generating speech"],
    complete: ["已生成语音", "Generated speech"],
    failed: ["未能生成语音", "Could not generate speech"],
    waiting: ["等待你允许生成语音", "Waiting for permission to generate speech"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备生成内容", "Preparing content generation"],
    complete: ["已处理内容", "Processed content"],
    failed: ["未能生成内容", "Could not generate content"],
    waiting: ["等待你确认生成内容", "Waiting for confirmation to generate content"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备生成内容", "Preparing content generation"];
