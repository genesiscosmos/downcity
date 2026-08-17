/** Agent 向 Plugin 提供的可选外部服务能力。 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";

/** Plugin 可使用的 AI 服务最小协议。 */
export interface PluginAiServices {
  /** 读取当前用户可用模型目录。 */
  catalog(): Promise<PluginModelCatalog>;
  /** 创建图片任务。 */
  image_create(input: JsonObject): Promise<JsonValue>;
  /** 查询图片任务。 */
  image_result(input: JsonObject): Promise<JsonValue>;
  /** 执行语音转写。 */
  asr(input: JsonObject): Promise<JsonValue>;
  /** 执行语音合成。 */
  tts(input: JsonObject): Promise<JsonValue>;
}

/** AI 模型目录的最小运行时视图。 */
export interface PluginModelCatalog {
  /** 返回当前用户可用的全部模型。 */
  all(): readonly PluginModelDescriptor[];
}

/** Plugin 可读取的模型目录项。 */
export interface PluginModelDescriptor {
  /** 模型唯一标识。 */
  readonly id: string;
  /** 模型展示名称。 */
  readonly name: string;
  /** 模型用途说明。 */
  readonly description?: string;
  /** 模型支持的能力。 */
  readonly modalities: readonly string[];
  /** 模型筛选标签。 */
  readonly tags?: readonly string[];
  /** Provider 扩展元数据；Plugin 不解释其内部结构。 */
  readonly meta?: unknown;
}

/** Plugin 可使用的 Web 服务最小协议。 */
export interface PluginWebServices {
  /** 搜索公开 Web 内容。 */
  search(input: JsonObject): Promise<JsonValue>;
  /** 读取指定 Web 文档。 */
  open(input: JsonObject): Promise<JsonValue>;
}
