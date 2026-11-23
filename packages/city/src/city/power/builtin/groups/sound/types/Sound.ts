/**
 * Sound capability 类型定义。
 *
 * 关键点（中文）
 * - 这里只定义语音能力对模型与 City 语音服务的最低层协议。
 * - ASR 返回文本与可选时间轴；TTS 使用标准媒体消息并将音频落到动作私有目录。
 * - 字段保持 JSON 可序列化，便于通过工具输入与 ActionResult 传递。
 */

import type { AIActionMessage } from "@downcity/downtown";
import type { TownSourceStatus } from "@/town/types/Town.js";
import type { PowerJsonObject, PowerJsonValue } from "@/power/index.js";


/** 语音能力分类。 */
export type SoundCapabilityKind = "asr" | "tts";

/** 语音模型信息。 */
export interface SoundModel {
  /** Town 统一模型 ID；不能用裸模型名替代。 */
  id: string;
  /** Downtown 来源连接 ID。 */
  source_id?: string;
  /** 来源连接的可读名称。 */
  source_name?: string;
  /** 本次目录捕获的授权来源；创建执行时由 Town 再次核验。 */
  binding_id?: string;
  /** 模型展示名称。 */
  name: string;
  /** 模型说明文本。 */
  description?: string;
  /** 模型支持的能力列表，至少包含 asr 或 tts。 */
  modalities: string[];
  /** 模型标签。 */
  tags?: string[];
  /** 模型元数据。 */
  meta?: PowerJsonObject;
}

/** 语音模型列表结果。 */
export interface SoundModelsResult {
  /** 满足筛选条件的模型列表。 */
  items: SoundModel[];
  /** 各来源目录的成功或失败状态。 */
  sources?: TownSourceStatus[];
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
  provider_options?: PowerJsonObject;
  /** 允许透传其他 JSON 可序列化参数。 */
  [key: string]: PowerJsonValue | undefined;
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
  provider_options?: PowerJsonObject;
}

/** Town 返回的标准媒体消息，落盘后只返回本地音频路径。 */
export type SoundTtsResult = AIActionMessage;

/**
 * `tts` 动作返回给模型的数据。
 *
 * 关键点（中文）
 * - 只给已落盘的本地音频路径，不注入 Agent 消息。
 */
export interface SoundTtsOutput {
  /** 已保存到本地的音频绝对路径。 */
  readonly files: string[];
}
