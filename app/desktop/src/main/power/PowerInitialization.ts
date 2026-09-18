/**
 * Desktop Power 启动策略。
 *
 * City 负责单个 Power 生命周期的原子性；Desktop 负责并行等待全部 Power，记录
 * 每个失败并继续启动其余主体，避免可选扩展成为整个应用的启动前置条件。
 */

import type { CityPowerRegistration } from "@downcity/city/power";

/** 初始化全部 Desktop Power，并把失败隔离到对应 Power。 */
export async function initialize_desktop_powers(input: {
  /** 当前宿主需要登记的全部 Power。 */
  readonly registrations: readonly CityPowerRegistration[];
  /** 把一个 Power 原子加入 City 的生命周期入口。 */
  readonly add: (registration: CityPowerRegistration) => Promise<void>;
  /** 记录单个 Power 初始化失败的宿主观察入口。 */
  readonly report_failure: (power_id: string, error: unknown) => void;
}): Promise<void> {
  const results = await Promise.allSettled(
    input.registrations.map(async (registration) => {
      await input.add(registration);
    }),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    input.report_failure(
      input.registrations[index]?.power.name || "unknown",
      result.reason,
    );
  }
}
