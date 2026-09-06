/** 官方简单设置 Plugin 的宿主配置 action 实现。 */

import {
  type PluginJsonObject,
  type PluginJsonValue,
  type PluginLifecycleContext,
} from "@downcity/city/plugin";
import type {
  PluginSettingField,
  PluginSettingsDefinition,
} from "@/builtin/types/PluginSettings.js";

/** 简单设置 action 保存后的可选资源同步策略。 */
interface PluginSettingsActionOptions {
  /** 配置持久化完成后刷新 Plugin 自己拥有的长期资源。 */
  after_save?(): Promise<void> | void;
}

/** 为一个字段集合注册唯一配置的读取和保存 action。 */
export function register_plugin_settings_actions(
  context: PluginLifecycleContext,
  definition: PluginSettingsDefinition,
  options: PluginSettingsActionOptions = {},
): void {
  context.plugin.config_action({
    id: "config.read",
    run: async (_input, action_context) => action_context.config.get(),
  });
  context.plugin.config_action({
    id: "config.save",
    run: async (input, action_context) => {
      const config = normalize_settings(input, definition.fields);
      await action_context.config.set(config);
      await options.after_save?.();
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
    throw new Error("Plugin config must be an object");
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
  return new Error(`Invalid Plugin config field: ${key}`);
}
