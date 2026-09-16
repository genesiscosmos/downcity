/**
 * Image capability 类型定义。
 *
 * 关键点（中文）
 * - 这里只定义图片能力对模型与 City 图片服务的最低层协议，不绑定任意上游 provider。
 * - 图片成功结果使用 Downcity Session 消息，保证结果可直接写入会话时间线。
 * - 字段保持 JSON 可序列化，便于通过工具输入与 ActionResult 传递。
 */

import type { ActionResultMessage } from "@downcity/agent";
import type { PluginJsonObject, PluginJsonValue } from "@/plugin/index.js";

/** Image capability 使用的最小图片 AI 服务协议。 */
export interface ImageAiService {
  /** 读取当前可用的图片模型目录。 */
  catalog(): Promise<{ all(): readonly unknown[] }>;

  /** 创建图片生成任务。 */
  image_create(input: PluginJsonObject): Promise<unknown>;

  /** 查询图片生成任务。 */
  image_result(input: PluginJsonObject): Promise<unknown>;
}

/** 图片生成文本内容片段。 */
export interface ImageTextContent {
  /** 内容类型，固定为文本。 */
  type: "text";
  /** 生图提示词或上下文文本。 */
  text: string;
}

/** 图片生成图片内容片段。 */
export interface ImageFileContent {
  /** 内容类型，固定为图片。 */
  type: "image";
  /** 图片地址，支持 http(s) URL、本地绝对路径或相对 Workspace 根目录的路径。 */
  url: string;
  /** 图片 MIME 类型，例如 `image/png`。 */
  media_type?: string;
}

/** 图片生成多模态内容片段。 */
export type ImageContent = ImageTextContent | ImageFileContent;

/** 内部解析后的图片内容片段：本地图片已经转成 data URL。 */
export type ImageResolvedContent =
  | ImageContent
  | {
    /** 内容类型，固定为图片。 */
    type: "image";
    /** 本地图片读取后转换得到的 data URL。 */
    data_url: string;
    /** 图片 MIME 类型，例如 `image/png`。 */
    media_type: string;
  };

/** 内部解析后的图片消息。当前只会生成单条 user 消息。 */
export interface ImageResolvedMessage {
  /** 消息角色。 */
  role: "user";
  /** 已解析的文本与图片内容。 */
  content: ImageResolvedContent[];
}

/** `image_create` 的模型输入。 */
export interface ImageCreateInput {
  /** 图片模型引用。 */
  model?: string;
  /** 单句快捷提示词。 */
  prompt?: string;
  /** 简单多模态内容。带参考图或改图时使用。 */
  content?: ImageContent[];
  /** 生成图片数量。 */
  n?: number;
  /** 生成图片数量，兼容部分上游使用的 count 命名。 */
  count?: number;
  /** 图片尺寸，例如 `1024x1024`。 */
  size?: string;
  /** 图片宽高比，例如 `16:9`。 */
  aspect_ratio?: string;
  /** 图片宽高比，兼容部分上游使用的 ratio 命名。 */
  ratio?: string;
  /** 图片质量，例如 `standard`、`hd`、`ultra`、`4k`。 */
  quality?: string;
  /** 随机种子。 */
  seed?: number;
  /** 业务侧任务 ID，用于 provider 侧幂等、追踪和恢复。 */
  client_job_id?: string;
  /** Provider 私有参数，例如 `{ openai: {...}, gemini: {...} }`。 */
  provider_options?: PluginJsonObject;
  /** 允许调用方透传其他 JSON 可序列化参数。 */
  [key: string]: PluginJsonValue | ImageContent[] | undefined;
}

/**
 * 传给图片服务的已解析输入。
 *
 * 关键点（中文）
 * - 模型公开输入只使用 `prompt` 或 `content`。
 * - 使用 `content` 时，本地图片会被读取为 data URL，并转成 `messages`。
 * - 本类型只描述 capability 到 City 图片服务的内部边界，不是模型调用 payload。
 */
export interface ImageResolvedCreateInput {
  /** 图片模型引用。 */
  model?: string;
  /** 单句快捷提示词。纯文本生成时保留。 */
  prompt?: string;
  /** 已解析后的多模态消息。带参考图或改图时由 `content` 转换得到。 */
  messages?: ImageResolvedMessage[];
  /** 生成图片数量。 */
  n?: number;
  /** 生成图片数量，兼容部分上游使用的 count 命名。 */
  count?: number;
  /** 图片尺寸，例如 `1024x1024`。 */
  size?: string;
  /** 图片宽高比，例如 `16:9`。 */
  aspect_ratio?: string;
  /** 图片宽高比，兼容部分上游使用的 ratio 命名。 */
  ratio?: string;
  /** 图片质量。 */
  quality?: string;
  /** 随机种子。 */
  seed?: number;
  /** 业务侧任务 ID。 */
  client_job_id?: string;
  /** Provider 私有参数。 */
  provider_options?: PluginJsonObject;
  /** 允许透传其他 JSON 可序列化参数。 */
  [key: string]: PluginJsonValue | ImageResolvedMessage[] | undefined;
}

/** 图片成功结果：可直接追加到 canonical Agent 回复的 Session 消息。 */
export type ImageResult = Extract<ActionResultMessage, { role: "agent" }>;

/** 图片结果本地化输入。 */
export interface ImageResultStorageInput {
  /** 当前 capability 执行上下文。 */
  context: {
    /** 当前 capability 在当前 Agent 范围内的私有文件端口。 */
    files: import("@/workspace/index.js").FileSystem;
    /** 当前 Turn 取消信号。 */
    abort_signal?: AbortSignal;
  };
  /** 当前图片任务 ID，用于划分稳定的本地结果目录。 */
  job_id: string;
  /** City 或 provider 返回的原始 Session 消息。 */
  result: ImageResult;
}

/** 图片结果本地化输出。 */
export interface ImageResultStorageResult {
  /** 已将可下载远程图片替换为本地路径的 Session 消息。 */
  result: ImageResult;
  /** 未能完成本地化的图片错误；对应 File Part 会保留远程 URL。 */
  errors: string[];
}

/** 图片生成任务状态。 */
export type ImageJobStatus = "queued" | "running" | "succeeded" | "failed";

/** 图片任务创建结果。 */
export interface ImageJobCreateResult {
  /** 图片任务 ID。 */
  job_id: string;
  /** 创建后的任务状态。 */
  status: ImageJobStatus;
  /** 建议下一次轮询的间隔毫秒数。 */
  poll_after_ms?: number;
}

/** 图片任务查询结果。 */
export interface ImageJobResult {
  /** 图片任务 ID。 */
  job_id: string;
  /** 当前任务状态。 */
  status: ImageJobStatus;
  /** 成功时返回的 Session 消息。 */
  result?: ImageResult;
  /** 失败时返回的错误消息。 */
  error?: string;
  /** 当前任务状态说明。 */
  message?: string;
  /** 建议下一次轮询的间隔毫秒数。 */
  poll_after_ms?: number;
}

/**
 * 图片任务查询输入。
 *
 * 关键点（中文）
 * - 默认只读一次，行为与历史一致。
 * - `until_done` 为 true 时在 capability 内按节奏轮询，直到终态或 `max_wait_ms` 到期。
 */
export interface ImageResultInput {
  /** 图片任务 ID，由 `image_create` 返回。 */
  job_id: string;
  /** 是否阻塞等待任务到达 `succeeded` / `failed`。 */
  until_done?: boolean;
  /** 轮询总等待上限毫秒数，默认 60000；命中上限返回最后一次状态，不抛错。 */
  max_wait_ms?: number;
  /** 单次轮询间隔毫秒数，默认 1500；provider 的 `poll_after_ms` 更大时以它为准。 */
  poll_interval_ms?: number;
}

/** 图片模型信息。 */
export interface ImageModel {
  /** 模型唯一 ID，用于 `image_create` 的 `model` 字段。 */
  id: string;
  /** 模型展示名称。 */
  name: string;
  /** 模型说明文本。 */
  description?: string;
  /** 模型支持的能力列表。 */
  modalities: string[];
  /** 模型标签。 */
  tags?: string[];
  /** 模型元数据。 */
  meta?: PluginJsonObject;
}

/** 图片模型列表结果。 */
export interface ImageModelsResult {
  /** 可用于图片生成的模型列表。 */
  items: ImageModel[];
}
