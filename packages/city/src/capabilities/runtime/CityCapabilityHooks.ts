/**
 * City Capability 的 Session Hook 投影。
 *
 * 关键点（中文）
 * - Capability 只贡献 system 说明，不参与 pipeline / effect。
 * - 与 Plugin Hook 组合成一个 SessionHooks：`open()` 打开 Plugin 作用域后，
 *   在其上叠加 capability system blocks，保证一个 Step 内的 system 视图一致。
 * - Capability 没有生命周期，因此不需要额外释放资源。
 */

import { SessionHooks } from "@downcity/agent";
import type { SessionHookContext, SessionSystemBlock } from "@downcity/type";
import type { CityCapabilityRuntime } from "@/capabilities/runtime/CityCapabilityRuntime.js";
import type { CityCapabilityContextFactory } from "@/capabilities/runtime/CityCapabilityRuntime.js";

/** 组合 Plugin Hook 与 Capability system 说明。 */
export function create_capability_hooks(input: {
  /** City capability 运行时。 */
  runtime: CityCapabilityRuntime;
  /** 基础 Hook：Plugin 提供。 */
  base: SessionHooks;
  /** 按当前 Hook 快照投影 capability 上下文。 */
  create_context: (hook_context?: SessionHookContext) => CityCapabilityContextFactory;
}): SessionHooks {
  const capability_blocks = async (
    hook_context?: SessionHookContext,
  ): Promise<SessionSystemBlock[]> =>
    await input.runtime.system_blocks(input.create_context(hook_context));

  return new SessionHooks({
    system_blocks: async (hook_context) => [
      ...await input.base.system_blocks(hook_context),
      ...await capability_blocks(hook_context),
    ],
    pipeline: async <TValue>(point_name: string, value: TValue) =>
      await input.base.pipeline(point_name, value),
    effect: async <TValue>(point_name: string, value: TValue) =>
      await input.base.effect(point_name, value),
    open: async () => {
      const scope = await input.base.open();
      return {
        system_blocks: async (hook_context) => [
          ...await scope.system_blocks(hook_context),
          ...await capability_blocks(hook_context),
        ],
        pipeline: async <TValue>(point_name: string, value: TValue) =>
          await scope.pipeline(point_name, value),
        effect: async <TValue>(point_name: string, value: TValue) =>
          await scope.effect(point_name, value),
        close: async () => await scope.close(),
      };
    },
  });
}
