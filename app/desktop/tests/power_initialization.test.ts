/** Desktop Power 初始化失败隔离测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { CityPowerRegistration } from "@downcity/city/power";
import { initialize_desktop_powers } from "../src/main/power/PowerInitialization.ts";

/** 创建测试使用的最小 Power 注册。 */
function create_registration(power_id: string): CityPowerRegistration {
  return {
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    power: {
      name: power_id,
      title: power_id,
      description: `${power_id} power`,
      actions: {},
    },
  };
}

test("单个 Power 初始化失败不会阻止其他 Power 完成启动", async () => {
  const registrations = [
    create_registration("healthy-a"),
    create_registration("broken"),
    create_registration("healthy-b"),
  ];
  const initialized: string[] = [];
  const failures: Array<{ power_id: string; error: unknown }> = [];

  await initialize_desktop_powers({
    registrations,
    add: async (registration) => {
      if (registration.power.name === "broken") {
        throw new Error("initialize failed");
      }
      initialized.push(registration.power.name);
    },
    report_failure: (power_id, error) => failures.push({ power_id, error }),
  });

  assert.deepEqual(initialized.sort(), ["healthy-a", "healthy-b"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.power_id, "broken");
  assert.match(String(failures[0]?.error), /initialize failed/u);
});
