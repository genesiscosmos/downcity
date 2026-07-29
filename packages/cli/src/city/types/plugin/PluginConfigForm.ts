/** Plugin JSON Schema 表单输入类型。 */

import type { JsonObject } from "@downcity/agent";

/** 通用 Plugin 配置表单入口参数。 */
export interface PromptPluginConfigInput {
  /** Plugin 稳定名称，用于表单标题和字段路径。 */
  plugin_name: string;

  /** Plugin Catalog 提供的标准 JSON Schema。 */
  schema: JsonObject;

  /** 当前完整 Binding 配置或 Catalog 默认配置。 */
  current_config: JsonObject;
}
