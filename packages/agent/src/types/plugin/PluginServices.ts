/** Agent 向 Plugin 提供的可选外部服务能力。 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";

/** Plugin 可使用的 AI 服务最小协议。 */
export interface PluginAiServices {
  /** 列出当前用户可用模型。 */
  list_models(): Promise<JsonValue>;
  /** 创建图片任务。 */
  image_create(input: JsonObject): Promise<JsonValue>;
  /** 查询图片任务。 */
  image_result(input: JsonObject): Promise<JsonValue>;
  /** 执行语音转写。 */
  asr(input: JsonObject): Promise<JsonValue>;
  /** 执行语音合成。 */
  tts(input: JsonObject): Promise<JsonValue>;
}

/** Plugin 可使用的 Web 服务最小协议。 */
export interface PluginWebServices {
  /** 搜索公开 Web 内容。 */
  search(input: JsonObject): Promise<JsonValue>;
  /** 读取指定 Web 文档。 */
  open(input: JsonObject): Promise<JsonValue>;
}

/** Agent 级 Plugin 外部服务集合。 */
export interface PluginServices {
  /** 当前用户的 AI 能力；未配置时对应 Plugin 返回不可用。 */
  readonly ai?: PluginAiServices;
  /** 当前宿主的 Web 搜索与文档能力。 */
  readonly web?: PluginWebServices;
}
