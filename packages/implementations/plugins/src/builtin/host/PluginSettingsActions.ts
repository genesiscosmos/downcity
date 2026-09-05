/** 官方简单设置 Plugin 的宿主配置 action 实现。 */

import {
  type PluginJsonObject,
  type PluginJsonValue,
  type PluginStartContext,
} from "@downcity/city/plugin";
import type {
  PluginSettingField,
  PluginSettingsDefinition,
} from "@/builtin/types/PluginSettings.js";

/** 为一个字段集合注册 Profile 读取和保存 action。 */
export function register_plugin_settings_actions(
  context: PluginStartContext,
  definition: PluginSettingsDefinition,
): void {
  context.plugin.config_action({
    id: "profile.read",
    run: async (_input, action_context) => await action_context.config.get(),
  });
  context.plugin.config_action({
    id: "profile.save",
    run: async (input, action_context) => {
      const config = normalize_settings(input, definition.fields);
      await action_context.config.set(config);
      return config;
    },
  });
}

/** 按 Plugin 自己声明的字段校验并规范化配置。 */
function normalize_settings(
  input: PluginJsonValue | undefined,
  fields: readonly PluginSettingField[],
): PluginJsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Plugin Profile config must be an object");
  }
  const source = input as PluginJsonObject;
  const result: PluginJsonObject = {};
  for (const field of fields) {
    const value = source[field.key];
    if (value === undefined || value === "") continue;
    if (field.type === "boolean") {
      if (typeof value !== "boolean") throw invalid_field(field.key);
      result[field.key] = value;
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw invalid_field(field.key);
      if (field.minimum !== undefined && value < field.minimum) throw invalid_field(field.key);
      if (field.maximum !== undefined && value > field.maximum) throw invalid_field(field.key);
      result[field.key] = value;
      continue;
    }
    if (typeof value !== "string") throw invalid_field(field.key);
    const normalized = value.trim();
    if (!normalized) continue;
    if (field.type === "select" && !field.options?.some((item) => item.value === normalized)) {
      throw invalid_field(field.key);
    }
    result[field.key] = normalized;
  }
  return result;
}

/** 创建稳定的字段校验错误。 */
function invalid_field(key: string): Error {
  return new Error(`Invalid Plugin Profile field: ${key}`);
}
