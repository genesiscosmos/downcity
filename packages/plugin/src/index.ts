/**
 * @downcity/plugin 主入口。
 *
 * 该入口只定义 Plugin main 与宿主之间的最小协议，不包含 City、Agent 或 Electron
 * 实现。Plugin 包可以直接默认导出 `define_plugin_main(...)` 的结果。
 */

import type { PluginMainModule } from "./types/PluginMain.js";

/** 保留 Plugin main 的精确类型并返回原对象。 */
export function define_plugin_main(module: PluginMainModule): PluginMainModule {
  return module;
}

export type {
  PluginJsonObject,
  PluginJsonPrimitive,
  PluginJsonValue,
} from "./types/Json.js";

export type {
  PluginMainAction,
  PluginMainActionContext,
  PluginMainContext,
  PluginMainLogger,
  PluginMainModule,
  PluginMainSelf,
  PluginMainSystem,
  PluginProfileConfigStore,
} from "./types/PluginMain.js";
