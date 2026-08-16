/** Plugin Zod 配置类型的校验与展示快照投影。 */

import type { JsonObject, JsonValue } from "@downcity/agent";
import { z, type ZodType } from "zod";
import type { LocalPluginConfigDefinition } from "@/types/LocalPlugin.js";

/** 判断第三方 constructor 暴露的值是否符合 Zod v4 类型协议。 */
export function is_zod_plugin_config_type(value: unknown): value is ZodType {
  return Boolean(
    value
    && typeof value === "object"
    && "_zod" in value
    && "parse" in value
    && typeof value.parse === "function"
    && "safeParse" in value
    && typeof value.safeParse === "function",
  );
}

/** 使用 Plugin 自己的 Zod 类型解析并收窄一个完整 profile。 */
export function parse_local_plugin_config(
  config_type: ZodType | undefined,
  value: JsonObject,
  label: string,
): JsonObject {
  if (!config_type) return structuredClone(value);
  try {
    const parsed = config_type.parse(value);
    if (!is_json_object(parsed)) {
      throw new TypeError(`${label} must resolve to a JSON object`);
    }
    assert_json_value(parsed, label);
    return structuredClone(parsed);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`Invalid ${label}`, { cause: error });
  }
}

/** 从 Zod 类型生成供管理界面使用的 JSON Schema 与默认配置快照。 */
export function create_local_plugin_config_definition(
  config_type: ZodType | undefined,
  label: string,
): LocalPluginConfigDefinition | undefined {
  if (!config_type) return undefined;
  let schema: JsonObject;
  try {
    const generated = z.toJSONSchema(config_type, {
      target: "draft-2020-12",
      io: "input",
    });
    if (!is_json_object(generated)) {
      throw new TypeError(`${label} JSON Schema must be an object`);
    }
    schema = structuredClone(generated);
  } catch (error) {
    throw new Error(`Cannot generate JSON Schema for ${label}`, { cause: error });
  }
  const defaults = config_type.safeParse({});
  if (!defaults.success || !is_json_object(defaults.data)) return { schema };
  assert_json_value(defaults.data, `${label} defaults`);
  return { schema, defaults: structuredClone(defaults.data) };
}

/** 递归确认 Zod 输出没有 Date、undefined 或其他非 JSON 值。 */
function assert_json_value(value: unknown, label: string): asserts value is JsonValue {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => assert_json_value(item, label));
    return;
  }
  if (is_json_object(value)) {
    Object.values(value).forEach((item) => assert_json_value(item, label));
    return;
  }
  throw new TypeError(`${label} must contain only JSON values`);
}

function is_json_object(value: unknown): value is JsonObject {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype,
  );
}
