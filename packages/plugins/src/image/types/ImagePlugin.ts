/**
 * ImagePlugin 类型定义。
 *
 * 关键点（中文）
 * - 这里仅定义图片 plugin 对图片能力的最低层协议，不绑定 city 或任意上游 provider。
 * - 图片成功结果使用 AI SDK UIMessage，保证 session 落盘格式与现有消息系统一致。
 * - 字段保持 JSON 可序列化，便于通过 plugin action 与 tool bridge 传递。
 */

import type { UIMessage } from "ai";
import type {
  JsonObject,
  JsonValue,
} from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";

/**
 * 图片生成文本内容片段。
 */
export interface ImagePluginTextContent {
  /** 内容类型，固定为文本。 */
  type: "text";
  /** 生图提示词或上下文文本。 */
  text: string;
}

/**
 * 图片生成图片内容片段。
 */
export interface ImagePluginFileContent {
  /** 内容类型，固定为图片。 */
  type: "image";
  /** 图片地址，支持 http(s) URL、本地绝对路径或相对项目根目录的路径。 */
  url: string;
  /** 图片 MIME 类型，例如 `image/png`。 */
  media_type?: string;
}

/**
 * 图片生成多模态内容片段。
 */
export type ImagePluginContent =
  | ImagePluginTextContent
  | ImagePluginFileContent;

/**
 * ImagePlugin 内部解析后的图片内容片段。
 */
export type ImagePluginResolvedContent =
  | ImagePluginContent
  | {
    /** 内容类型，固定为图片。 */
    type: "image";
    /** 本地图片由 ImagePlugin 读取后转换得到的 data URL。 */
    data_url: string;
    /** 图片 MIME 类型，例如 `image/png`。 */
    media_type: string;
  };

/**
 * ImagePlugin 内部解析后的图片消息。
 */
export interface ImagePluginResolvedMessage {
  /** 消息角色。ImagePlugin 目前只会生成单条 user 消息。 */
  role: "user";
  /** 已解析的文本与图片内容。 */
  content: ImagePluginResolvedContent[];
}

/**
 * ImagePlugin 调用输入。
 */
export interface ImagePluginInput {
  /** 图片模型引用。 */
  model?: string;
  /** 单句快捷提示词。 */
  prompt?: string;
  /** 简单多模态内容。带参考图或改图时使用。 */
  content?: ImagePluginContent[];
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
  provider_options?: JsonObject;
  /** 允许外部 image 函数接收其他 JSON 可序列化参数。 */
  [key: string]: JsonValue | ImagePluginContent[] | undefined;
}

/**
 * ImagePlugin 传给 image_create 回调的已解析输入。
 *
 * 关键点（中文）
 * - Agent 公开 payload 只使用 `prompt` 或 `content`。
 * - 当公开 payload 使用 `content` 时，ImagePlugin 会把本地图片读取为 data URL，并把内容转成 `messages`。
 * - 这个类型只描述 ImagePlugin 到 City / provider adapter 的内部边界，不是 Agent 调用 payload。
 */
export interface ImagePluginResolvedInput {
  /** 图片模型引用。 */
  model?: string;
  /** 单句快捷提示词。纯文本生成时保留。 */
  prompt?: string;
  /** 已解析后的多模态消息。带参考图或改图时由 `content` 转换得到。 */
  messages?: ImagePluginResolvedMessage[];
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
  provider_options?: JsonObject;
  /** 允许外部 image 函数接收其他 JSON 可序列化参数。 */
  [key: string]: JsonValue | ImagePluginResolvedMessage[] | undefined;
}

/**
 * ImagePlugin 图片成功结果。
 */
export type ImagePluginResult = UIMessage;

/**
 * 图片生成任务状态。
 */
export type ImagePluginJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

/**
 * 图片任务创建结果。
 */
export interface ImagePluginJobCreateResult {
  /** 图片任务 ID。 */
  job_id: string;
  /** 创建后的任务状态。 */
  status: ImagePluginJobStatus;
  /** 建议下一次轮询的间隔毫秒数。 */
  poll_after_ms?: number;
}

/**
 * 图片任务查询结果。
 */
export interface ImagePluginJobResult {
  /** 图片任务 ID。 */
  job_id: string;
  /** 当前任务状态。 */
  status: ImagePluginJobStatus;
  /** 成功时返回的 AI SDK UIMessage。 */
  result?: ImagePluginResult;
  /** 失败时返回的错误消息。 */
  error?: string;
  /** 当前任务状态说明。 */
  message?: string;
  /** 建议下一次轮询的间隔毫秒数。 */
  poll_after_ms?: number;
}

/**
 * 图片任务查询输入。
 */
export interface ImagePluginJobResultInput {
  /** 图片任务 ID，由 `image_create` 返回。 */
  job_id: string;
  /**
   * 是否阻塞等待任务到达终态（`succeeded` / `failed`）。
   *
   * 关键点（中文）
   * - 默认 false：行为与历史一致，调用一次 provider 即返回。
   * - true：plugin 内部按 `poll_interval_ms` 节奏轮询，直到任务终止或 `max_wait_ms` 到期。
   */
  until_done?: boolean;
  /**
   * 轮询的总等待上限（毫秒）。
   *
   * 关键点（中文）
   * - 仅当 `until_done` 为 true 时生效。
   * - 默认 60_000；命中上限后返回当前最后一次状态，不抛错。
   */
  max_wait_ms?: number;
  /**
   * 单次轮询之间的等待间隔（毫秒）。
   *
   * 关键点（中文）
   * - 仅当 `until_done` 为 true 时生效。
   * - 默认 1500；若 provider 返回 `poll_after_ms`，则取两者较大值。
   */
  poll_interval_ms?: number;
}

/**
 * ImagePlugin 可见模型信息。
 */
export interface ImagePluginModel {
  /** 模型唯一 ID，用于 `image_create` payload 的 `model` 字段。 */
  id: string;
  /** 模型展示名称。 */
  name: string;
  /** 模型说明文本。 */
  description?: string;
  /** 模型支持的能力列表，例如 `image`。 */
  modalities: string[];
  /** 模型标签。 */
  tags?: string[];
  /** 模型元数据。 */
  meta?: JsonObject;
}

/**
 * ImagePlugin 模型列表结果。
 */
export interface ImagePluginModelsResult {
  /** 可用于图片生成的模型列表。 */
  items: ImagePluginModel[];
}

/**
 * 默认图片模型解析函数输入。
 */
export interface ImagePluginDefaultModelResolverInput {
  /** 当前 Agent 运行上下文，可用于读取项目根目录、会话上下文或宿主状态。 */
  context: PluginContext;
  /** 已解析后的图片生成输入，可用于根据 prompt、messages、尺寸或质量选择模型。 */
  input: ImagePluginResolvedInput;
}

/**
 * 默认图片模型配置。
 */
export type ImagePluginDefaultModel =
  | string
  | ((
    input: ImagePluginDefaultModelResolverInput,
  ) => string | undefined | null | Promise<string | undefined | null>);

/**
 * ImagePlugin 构造参数。
 */
export interface ImagePluginOptions {
  /** Plugin 稳定名称，默认 `image`。 */
  name?: string;
  /** Plugin 展示标题，默认 `Image`。 */
  title?: string;
  /** Plugin 用途说明。 */
  description?: string;
  /** 默认图片模型配置。Agent 调用 `image_create` 未传 `model` 时会自动使用字符串值或函数返回值。 */
  default_model?: ImagePluginDefaultModel;
  /** 创建图片生成任务，通常传入 `(input) => city.ai.image_create(input)`。 */
  image_create?: (
    input: ImagePluginResolvedInput,
  ) => Promise<ImagePluginJobCreateResult> | ImagePluginJobCreateResult;
  /** 查询图片生成任务，通常传入 `(input) => city.ai.image_result(input)`。 */
  image_result?: (
    input: ImagePluginJobResultInput,
  ) => Promise<ImagePluginJobResult> | ImagePluginJobResult;
  /** 列出可用图片模型，通常传入 `async () => city.ai.catalog().then((catalog) => catalog.forModality("image"))`。 */
  list_models?: () => Promise<ImagePluginModel[]> | ImagePluginModel[];
}
