/** Plugin JSON Schema 配置协议的统一校验实现。 */

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import formats_plugin from "ajv-formats";
import type { JsonObject } from "@downcity/agent";

const plugin_config_ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
});

// `x_downcity` 只承载表单展示提示，不参与配置值校验。
plugin_config_ajv.addKeyword({
  keyword: "x_downcity",
  schemaType: "object",
  valid: true,
});

(formats_plugin as unknown as (ajv: Ajv2020) => Ajv2020)(plugin_config_ajv);

/** 校验 `plugin.json` 声明的配置 JSON Schema。 */
export function validate_local_plugin_config_schema(schema: JsonObject): void {
  const valid = plugin_config_ajv.validateSchema(schema);
  if (!valid) {
    throw new Error(`Invalid Plugin config schema: ${format_ajv_errors(
      plugin_config_ajv.errors,
      "config",
    )}`);
  }
  compile_plugin_config_schema(schema);
}

/** 使用 Plugin JSON Schema 校验一个完整 profile。 */
export function validate_local_plugin_config(
  config: JsonObject,
  schema: JsonObject | undefined,
  label = "Plugin config",
): void {
  if (!schema) return;
  const validate = compile_plugin_config_schema(schema);
  if (validate(config)) return;
  throw new Error(`Invalid ${label}: ${format_ajv_errors(validate.errors, label)}`);
}

/** 编译 Plugin 配置 Schema，并统一包装非法 Schema 错误。 */
function compile_plugin_config_schema(schema: JsonObject): ValidateFunction {
  try {
    return plugin_config_ajv.compile(schema);
  } catch (error) {
    throw new Error(
      `Invalid Plugin config schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 把 Ajv 结构化错误收敛为稳定文本。 */
function format_ajv_errors(
  errors: ErrorObject[] | null | undefined,
  label: string,
): string {
  if (!errors || errors.length === 0) return "unknown validation error";
  const root_label = label === "Plugin config" ? "config" : label;
  return errors
    .map((error) => {
      const path = error.instancePath ? `${root_label}${error.instancePath}` : root_label;
      return `${path} ${error.message || error.keyword}`;
    })
    .join("; ");
}
