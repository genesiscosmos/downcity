/** Agent 向 Plugin 提供的可选外部服务能力。 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";

/** Plugin 可使用的 Web 服务最小协议。 */
export interface PluginWebServices {
  /** 搜索公开 Web 内容。 */
  search(input: JsonObject): Promise<JsonValue>;
  /** 读取指定 Web 文档。 */
  open(input: JsonObject): Promise<JsonValue>;
}
