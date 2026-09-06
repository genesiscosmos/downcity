/** Desktop Plugin 初始化失败隔离测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { CityPluginRegistration } from "@downcity/city/plugin";
import { initialize_desktop_plugins } from "../src/main/plugin/PluginInitialization.ts";

/** 创建测试使用的最小 Plugin 注册。 */
function create_registration(plugin_id: string): CityPluginRegistration {
  return {
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    plugin: {
      name: plugin_id,
      title: plugin_id,
      description: `${plugin_id} plugin`,
      actions: {},
    },
  };
}

test("单个 Plugin 初始化失败不会阻止其他 Plugin 完成启动", async () => {
  const registrations = [
    create_registration("healthy-a"),
    create_registration("broken"),
    create_registration("healthy-b"),
  ];
  const initialized: string[] = [];
  const failures: Array<{ plugin_id: string; error: unknown }> = [];

  await initialize_desktop_plugins({
    registrations,
    add: async (registration) => {
      if (registration.plugin.name === "broken") {
        throw new Error("initialize failed");
      }
      initialized.push(registration.plugin.name);
    },
    report_failure: (plugin_id, error) => failures.push({ plugin_id, error }),
  });

  assert.deepEqual(initialized.sort(), ["healthy-a", "healthy-b"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.plugin_id, "broken");
  assert.match(String(failures[0]?.error), /initialize failed/u);
});
