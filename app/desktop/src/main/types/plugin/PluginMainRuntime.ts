/** Desktop Plugin main runtime 的内部装配类型。 */

import type { PluginMainModule } from "@downcity/plugin";

/** Plugin main 模块解析结果。 */
export interface ResolvedPluginMain {
  /** 当前 Plugin 的稳定 ID。 */
  readonly plugin_id: string;

  /** 已加载且通过结构校验的 main 生命周期对象。 */
  readonly module: PluginMainModule;
}

/** Plugin main runtime 的依赖。 */
export interface PluginMainRuntimeOptions {
  /** 按 Plugin ID 延迟解析内置或第三方 main。 */
  readonly resolve_main: (plugin_id: string) => Promise<ResolvedPluginMain | null>;
}
