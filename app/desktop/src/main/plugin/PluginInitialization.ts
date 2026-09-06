/**
 * Desktop Plugin 启动策略。
 *
 * City 负责单个 Plugin 生命周期的原子性；Desktop 负责并行等待全部 Plugin，记录
 * 每个失败并继续启动其余主体，避免可选扩展成为整个应用的启动前置条件。
 */

import type { CityPluginRegistration } from "@downcity/city/plugin";

/** 初始化全部 Desktop Plugin，并把失败隔离到对应 Plugin。 */
export async function initialize_desktop_plugins(input: {
  /** 当前宿主需要登记的全部 Plugin。 */
  readonly registrations: readonly CityPluginRegistration[];
  /** 把一个 Plugin 原子加入 City 的生命周期入口。 */
  readonly add: (registration: CityPluginRegistration) => Promise<void>;
  /** 记录单个 Plugin 初始化失败的宿主观察入口。 */
  readonly report_failure: (plugin_id: string, error: unknown) => void;
}): Promise<void> {
  const results = await Promise.allSettled(
    input.registrations.map(async (registration) => {
      await input.add(registration);
    }),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    input.report_failure(
      input.registrations[index]?.plugin.name || "unknown",
      result.reason,
    );
  }
}
