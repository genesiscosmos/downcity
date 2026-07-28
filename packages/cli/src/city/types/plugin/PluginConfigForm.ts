/** Plugin JSON Schema 表单与动态资源查询类型。 */

import type { JsonObject } from "@downcity/agent";
import type { PluginConfigResourceOption } from "@/city/types/plugin/PluginCatalog.js";

/** 通用 Plugin 配置表单入口参数。 */
export interface PromptPluginConfigInput {
  /** Plugin 稳定名称，用于表单标题和字段路径。 */
  plugin_name: string;

  /** Plugin Catalog 提供的标准 JSON Schema。 */
  schema: JsonObject;

  /** 当前完整 Binding 配置或 Catalog 默认配置。 */
  current_config: JsonObject;
}

/** 动态资源选项的查询参数。 */
export interface PluginConfigResourceQuery {
  /** CLI 可信注册表中的资源种类。 */
  resource_type: string;

  /** JSON Schema UI 注解声明的静态筛选条件。 */
  filter?: JsonObject;
}

/** 一个可信 City 资源选项 Provider。 */
export type PluginConfigResourceProvider = (
  /** JSON Schema UI 注解声明的静态筛选条件。 */
  filter: JsonObject | undefined,
) => PluginConfigResourceOption[];
