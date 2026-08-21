/**
 * SoundPlugin 类型定义。
 *
 * 关键点（中文）
 * - SoundPlugin 统一承载 ASR 与 TTS，不绑定本地模型、Python 或具体 provider。
 * - ASR 结果字段与 AI SDK `TranscriptionResult` 的可序列化核心字段保持一致。
 * - TTS 结果直接使用 AI SDK `UIMessage`，由 agent 统一处理音频 file part。
 */

import type { UIMessage } from "ai";
import type { JsonObject, JsonValue } from "@downcity/agent";

/** SoundPlugin 使用的最小语音 AI 服务协议。 */
export interface SoundAiService {
  /** 读取当前可用模型目录。 */
  catalog(): Promise<{ all(): readonly unknown[] }>;

  /** 执行语音识别。 */
  asr(input: JsonObject): Promise<unknown>;

  /** 执行语音合成。 */
  tts(input: JsonObject): Promise<unknown>;
}

/**
 * SoundPlugin 支持的语音能力。
 */
export type SoundPluginCapability = "asr" | "tts";

/**
 * SoundPlugin 可见的 FED 模型信息。
 */
export interface SoundPluginModel {
  /** FED 模型唯一 ID，同时也是调用 ASR/TTS 时传入的模型引用。 */
  id: string;
  /** 面向用户和 Agent 展示的模型名称。 */
  name: string;
  /** 模型用途、语言或质量说明。 */
  description?: string;
  /** 模型支持的能力列表，至少包含 `asr` 或 `tts`。 */
  modalities: string[];
  /** FED 为模型提供的筛选标签。 */
  tags?: string[];
  /** FED 返回的 JSON 可序列化扩展元数据。 */
  meta?: JsonObject;
}

/**
 * SoundPlugin 模型列表结果。
 */
export interface SoundPluginModelsResult {
  /** 满足当前能力筛选条件的模型列表。 */
  items: SoundPluginModel[];
}

/**
 * ASR 转写分段。
 *
 * 字段命名与 AI SDK `TranscriptionResult.segments` 保持一致。
 */
export interface SoundPluginAsrSegment {
  /** 当前时间片段识别得到的文本。 */
  text: string;
  /** 当前片段在音频中的开始时间，单位为秒。 */
  startSecond: number;
  /** 当前片段在音频中的结束时间，单位为秒。 */
  endSecond: number;
}

/**
 * ASR 输入。
 */
export interface SoundPluginAsrInput {
  /** 支持 ASR 的 FED 模型 ID；未提供时使用 `default_asr_model`。 */
  model?: string;
  /** 本地音频文件的绝对路径或相对 Agent 项目根目录的路径。 */
  audio_path?: string;
  /** 可由 FED 直接读取的远程音频 URL。 */
  url?: string;
  /** data URL 形式的音频内容。 */
  data_url?: string;
  /** 语言提示，例如 `auto`、`zh` 或 `en`。 */
  language?: string;
  /** 音频 MIME 类型，例如 `audio/ogg`。 */
  media_type?: string;
  /** 原始文件名，供 provider 推断音频格式。 */
  filename?: string;
  /** Provider 私有参数，例如 `{ openai: {...}, groq: {...} }`。 */
  provider_options?: JsonObject;
  /** 允许 FED ASR action 接收其他 JSON 可序列化参数。 */
  [key: string]: JsonValue | undefined;
}

/**
 * ASR 输出。
 *
 * 说明（中文）
 * - 只保留 AI SDK `TranscriptionResult` 中适合 JSON 传输的核心字段。
 * - warnings、responses 与 providerMetadata 属于运行期诊断信息，不进入 plugin action 协议。
 */
export interface SoundPluginAsrResult {
  /** 完整转写文本。 */
  text: string;
  /** 带开始和结束时间的转写分段。 */
  segments?: SoundPluginAsrSegment[];
  /** 检测到的 ISO-639-1 语言代码。 */
  language?: string;
  /** 音频总时长，单位为秒。 */
  durationInSeconds?: number;
}

/**
 * TTS 输入。
 */
export interface SoundPluginTtsInput {
  /** 支持 TTS 的 FED 模型 ID；未提供时使用 `default_tts_model`。 */
  model?: string;
  /** 需要合成为语音的文本。 */
  text: string;
  /** 语言提示，例如 `auto`、`zh` 或 `en`。 */
  language?: string;
  /** 音色名称或上游 provider 的 voice ID。 */
  voice?: string;
  /** 输出音频格式，例如 `mp3`、`wav` 或 `opus`。 */
  format?: string;
  /** 语速倍率。 */
  speed?: number;
  /** 对语气、风格或发音方式的额外说明。 */
  instructions?: string;
  /** Provider 私有参数，例如 `{ openai: {...}, elevenlabs: {...} }`。 */
  provider_options?: JsonObject;
  /** 允许 FED TTS action 接收其他 JSON 可序列化参数。 */
  [key: string]: JsonValue | undefined;
}

/**
 * TTS 输出。
 *
 * 音频通过 AI SDK `UIMessage` 的 file part 返回。
 */
export type SoundPluginTtsResult = UIMessage;

/**
 * SoundPlugin 构造参数。
 */
export interface SoundPluginProfile {
  /** Plugin 稳定名称，默认 `sound`。 */
  name?: string;
  /** Plugin 展示标题，默认 `Sound`。 */
  title?: string;
  /** Plugin 用途说明。 */
  description?: string;
  /** 未显式传入 ASR 模型时使用的 FED 模型 ID。 */
  default_asr_model?: string;
  /** 未显式传入 TTS 模型时使用的 FED 模型 ID。 */
  default_tts_model?: string;
  /** 是否自动转写 chat 入站的 voice/audio 附件，默认 `false`。 */
  auto_asr?: boolean;
  /** ASR 与 TTS 共用的默认语言提示。 */
  language?: string;
  /** TTS 默认音色。 */
  voice?: string;
  /** TTS 默认输出格式。 */
  format?: string;
}

/** SoundPlugin 构造参数。 */
export interface SoundPluginOptions extends SoundPluginProfile {
  /** 语音 AI 服务；通常来自 Embassy User AI。 */
  sound_ai: SoundAiService;
}
