/**
 * Plugin JSON Schema 展示快照校验器。
 *
 * 关键点（中文）
 * - Plugin 的配置类型与运行时校验由 Zod 拥有，JSON Schema 只服务 CLI 与 Desktop 控制面。
 * - Ajv 校验安装器生成的 JSON Schema 快照，避免控制面保存明显无效的原始配置。
 * - 表单提示只使用标准 Schema 注解，不注册宿主私有配置关键字。
 */

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import formats_plugin from "ajv-formats";
import type { JsonObject } from "@downcity/agent";

const plugin_config_ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
});

(formats_plugin as unknown as (ajv: Ajv2020) => Ajv2020)(plugin_config_ajv);

/** 校验 Plugin 声明的 JSON Schema 本身是否合法。 */
export function validate_plugin_config_schema(schema: JsonObject): void {
  const valid = plugin_config_ajv.validateSchema(schema);
  if (!valid) {
    throw new Error(`Invalid Plugin config schema: ${format_ajv_errors(plugin_config_ajv.errors)}`);
  }
  compile_plugin_config_schema(schema);
}

/** 按标准 JSON Schema 校验 Plugin 完整配置。 */
export function validate_plugin_config(
  config: JsonObject,
  schema: JsonObject | undefined,
): void {
  if (!schema) return;
  const validate = compile_plugin_config_schema(schema);
  if (validate(config)) return;
  throw new Error(`Invalid Plugin config: ${format_ajv_errors(validate.errors)}`);
}

/** 编译并返回可复用的 Plugin 配置校验器。 */
export function compile_plugin_config_schema(schema: JsonObject): ValidateFunction {
  try {
    return plugin_config_ajv.compile(schema);
  } catch (error) {
    throw new Error(
      `Invalid Plugin config schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 把 Ajv 的结构化错误收敛为稳定、可读的 CLI 文本。 */
function format_ajv_errors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown validation error";
  return errors
    .map((error) => {
      const path = error.instancePath ? `config${error.instancePath}` : "config";
      return `${path} ${error.message || error.keyword}`;
    })
    .join("; ");
}
