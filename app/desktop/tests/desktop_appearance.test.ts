/** Desktop 最终明暗外观判定测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve_dark_appearance } from "../src/renderer/features/settings/lib/desktop_appearance.ts";

test("显式明暗模式不受系统偏好影响", () => {
  assert.equal(resolve_dark_appearance("dark", false), true);
  assert.equal(resolve_dark_appearance("light", true), false);
});

test("系统模式跟随系统明暗偏好", () => {
  assert.equal(resolve_dark_appearance("system", true), true);
  assert.equal(resolve_dark_appearance("system", false), false);
});
