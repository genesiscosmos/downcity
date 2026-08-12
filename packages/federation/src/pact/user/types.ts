/**
 * 用户端类型。
 */

import type { UIMessage, UIMessageChunk } from "ai";
import type { FetchLike } from "../http.js";
import type { UserModelInput } from "../invoker/ai/types.js";
import type {
  AIImageCreateResult,
  AIImageResult,
  AIImageStatus,
} from "../../types/AI.js";
import type {
  UserPaymentMethod,
  UserPaymentMethodReason,
  UserPaymentMethodType,
} from "../invoker/payment/types.js";

/** JSON 基础值。 */
export type UserJsonPrimitive = string | number | boolean | null;

/** JSON 对象。 */
export interface UserJsonObject {
  /** JSON 字段值。 */
  [key: string]: UserJsonValue;
}

/** JSON 可序列化值。 */
export type UserJsonValue = UserJsonPrimitive | UserJsonObject | UserJsonValue[];

/**
 * Service 摘要信息。
 */
export interface UserServiceSummary {
  /** Service 唯一 ID。 */
  id: string;
  /** Service 展示名称。 */
  name: string;
  /** Service 依赖的环境变量需求列表。 */
  env: Array<{
    /** 环境变量 key。 */
    key: string;
    /** 给用户展示的说明文本。 */
    description: string;
    /** 当前是否必填。 */
    required: boolean;
  }>;
}

/** User City 内部访问层构造参数 */
export interface UserPactAccessOptions {
  /** City 的访问入口地址，支持 `http(s)://`。 */
  base_url: string;
  /** 终端用户访问 token；调用需要 user 身份的 action 时必须传入。 */
  user_token?: string;
  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}

/** AI 模态返回类型 */
export type UserTextResult = UIMessage;
export type UserStreamChunk = UIMessageChunk;
export type UserStreamResult = ReadableStream<UserStreamChunk>;
export type UserImageResult = UIMessage;
export type UserVideoResult = UIMessage;
export type UserTtsResult = UIMessage;
/** 语音识别返回结果。 */
export interface UserAsrResult {
  /** 转写后的文本。 */
  text: string;
  /** 与 AI SDK `TranscriptionResult` 对齐的带时间信息转写分段。 */
  segments?: Array<{
    /** 当前时间片段识别得到的文本。 */
    text: string;
    /** 当前片段在音频中的开始时间，单位为秒。 */
    startSecond: number;
    /** 当前片段在音频中的结束时间，单位为秒。 */
    endSecond: number;
  }>;
  /** Provider 可选返回的 ISO-639-1 语言标识，例如 `zh` 或 `en`。 */
  language?: string;
  /** 与 AI SDK `TranscriptionResult` 对齐的音频总时长，单位为秒。 */
  durationInSeconds?: number;
}
export type {
  AIImageStatus as UserImageJobStatus,
};
/** image/create 返回给客户端的结果。 */
export type UserImageJobCreateResult = AIImageCreateResult;
/** image/result 返回给客户端的结果。 */
export type UserImageJobResult = AIImageResult;
/** image/result 查询输入。 */
export interface UserImageJobResultInput {
  /** image_create 返回的图片任务 ID。 */
  job_id: string;
}
export type { UserPaymentMethod, UserPaymentMethodReason, UserPaymentMethodType };

/** 图片生成文本内容片段。 */
export interface UserImageTextContent {
  /** 内容类型，固定为文本。 */
  type: "text";
  /** 生图提示词或上下文文本。 */
  text: string;
}

/** 图片生成参考图片内容片段。 */
export interface UserImageFileContent {
  /** 内容类型，固定为图片。 */
  type: "image";
  /** 远程图片 URL。 */
  url?: string;
  /** data URL 图片内容。 */
  data_url?: string;
  /** 图片 MIME 类型，例如 `image/png`。 */
  media_type?: string;
}

/** 图片生成多模态内容片段。 */
export type UserImageContent = UserImageTextContent | UserImageFileContent;

/** 图片生成上下文消息。 */
export interface UserImageMessage {
  /** 消息角色。 */
  role: "system" | "user" | "assistant";
  /** 该消息内的文本与图片内容。 */
  content: UserImageContent[];
}

/** 图片生成输入。 */
export interface UserImageInput extends UserServiceInput {
  /** 单句快捷提示词。 */
  prompt?: string;
  /** 多轮或多模态图片生成上下文。 */
  messages?: UserImageMessage[];
  /** 生成图片数量。 */
  n?: number;
  /** 生成图片数量，兼容部分上游使用的 count 命名。 */
  count?: number;
  /** 图片尺寸，例如 `1024x1024`。 */
  size?: string;
  /** 图片宽高比，例如 `1:1`。 */
  aspect_ratio?: string;
  /** 图片宽高比，兼容部分上游使用的 ratio 命名。 */
  ratio?: string;
  /** 图片质量，例如 `standard`、`hd`、`ultra`、`4k`。 */
  quality?: string;
  /** 随机种子。 */
  seed?: number;
  /** 业务侧任务 ID，用于 provider 侧幂等、追踪和恢复。 */
  client_job_id?: string;
  /** Provider 私有参数，例如 `{ openai: {...}, gemini: {...}, luchi: {...} }`。 */
  provider_options?: UserJsonObject;
}

/** 语音合成输入。 */
export interface UserTtsInput extends UserServiceInput {
  /** 要合成为语音的文本。 */
  text: string;
  /** 可选语音名称或上游 voice id。 */
  voice?: string;
  /** 输出音频格式，例如 `mp3`、`wav` 或 `opus`。 */
  format?: string;
  /** 语速倍率。 */
  speed?: number;
  /** Provider 私有参数，例如 `{ openai: {...}, elevenlabs: {...} }`。 */
  provider_options?: UserJsonObject;
}

/** 语音识别输入。 */
export interface UserAsrInput extends UserServiceInput {
  /** 远程音频 URL。 */
  url?: string;
  /** data URL 音频内容。 */
  data_url?: string;
  /** 本地或资源系统里的音频路径。 */
  audio_path?: string;
  /** 音频 MIME 类型，例如 `audio/ogg`。 */
  media_type?: string;
  /** 原始文件名，便于 provider 推断格式。 */
  filename?: string;
  /** Provider 私有参数，例如 `{ openai: {...}, groq: {...} }`。 */
  provider_options?: UserJsonObject;
}

/** 发给任意 service 的输入 */
export interface UserServiceInput {
  /** AIService 调用必须显式传入的模型引用或模型 ID。 */
  model: UserModelInput;
  /** 模型推理强度档位，必须来自模型目录 `reasoning.efforts`。 */
  reasoning_effort?: string;
  [key: string]: unknown;
}
