/**
 * Sound capability 类型定义。
 *
 * 关键点（中文）
 * - 这里只定义语音能力对模型与 City 语音服务的最低层协议。
 * - ASR 返回文本与可选时间轴；TTS 返回可直接写入会话的 Agent Session 消息。
 * - 字段保持 JSON 可序列化，便于通过工具输入与 ActionResult 传递。
 */

import type { ActionResultMessage } from "@downcity/agent";
import type { PluginJsonObject, PluginJsonValue } from "@/plugin/index.js";

/** Sound capability 使用的最小语音 AI 服务协议。 */
export interface SoundAiService {
  /** 读取当前可用的语音模型目录。 */
  catalog(): Promise<{ all(): readonly unknown[] }>;

  /** 执行一次语音识别。 */
  asr(input: PluginJsonObject): Promise<unknown>;

  /** 执行一次语音合成。 */
  tts(input: PluginJsonObject): Promise<unknown>;
}

/** 语音能力分类。 */
export type SoundCapabilityKind = "asr" | "tts";

/** 语音模型信息。 */
export interface SoundModel {
  /** 模型唯一 ID。 */
  id: string;
  /** 模型展示名称。 */
  name: string;
  /** 模型说明文本。 */
  description?: string;
  /** 模型支持的能力列表，至少包含 asr 或 tts。 */
  modalities: string[];
  /** 模型标签。 */
  tags?: string[];
  /** 模型元数据。 */
  meta?: PluginJsonObject;
}

/** 语音模型列表结果。 */
export interface SoundModelsResult {
  /** 满足筛选条件的模型列表。 */
  items: SoundModel[];
}

/** `asr` 的模型输入。 */
export interface SoundAsrInput {
  /** 语音模型 ID。 */
  model?: string;
  /** 本地音频绝对路径或相对 Workspace 根目录的路径。 */
  audio_path?: string;
  /** 远程音频 URL。 */
  url?: string;
  /** 音频 data URL。 */
  data_url?: string;
  /** 可选语言提示。 */
  language?: string;
  /** 可选音频 MIME 类型。 */
  media_type?: string;
  /** 可选原始文件名。 */
  filename?: string;
  /** Provider 私有参数。 */
  provider_options?: PluginJsonObject;
  /** 允许透传其他 JSON 可序列化参数。 */
  [key: string]: PluginJsonValue | undefined;
}

/** ASR 时间轴分段。 */
export interface SoundAsrSegment {
  /** 分段文本。 */
  text: string;
  /** 分段起始秒。 */
  startSecond: number;
  /** 分段结束秒。 */
  endSecond: number;
}

/** ASR 结果。 */
export interface SoundAsrResult {
  /** 转写文本。 */
  text: string;
  /** 可选时间轴分段。 */
  segments?: SoundAsrSegment[];
  /** 识别到的语言。 */
  language?: string;
  /** 音频时长秒数。 */
  durationInSeconds?: number;
}

/** `tts` 的模型输入。 */
export interface SoundTtsInput {
  /** 语音模型 ID。 */
  model?: string;
  /** 要合成的文本。 */
  text: string;
  /** 可选语言提示。 */
  language?: string;
  /** 可选音色 ID。 */
  voice?: string;
  /** 可选音频格式。 */
  format?: string;
  /** 可选语速。 */
  speed?: number;
  /** 可选语气风格指令。 */
  instructions?: string;
  /** Provider 私有参数。 */
  provider_options?: PluginJsonObject;
}

/** TTS 结果：可直接追加到 canonical Agent 回复的 Session 消息。 */
export type SoundTtsResult = Extract<ActionResultMessage, { role: "agent" }>;
