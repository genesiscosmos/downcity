/** 快捷键模块的跨平台匹配与注册行为测试。 */
import test from "node:test";
import assert from "node:assert/strict";
import { format_shortcut_display, list_registered_shortcut_definitions, matches_shortcut, register_shortcuts } from "../dist/index.js";

test("Mod uses Meta on macOS and Ctrl elsewhere", () => {
  assert.equal(matches_shortcut({ key: "b", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, "Mod+B", "mac"), true);
  assert.equal(matches_shortcut({ key: "b", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, "Mod+B", "windows"), true);
});

test("shortcut display formats common command keys", () => {
  assert.equal(format_shortcut_display("Mod+,", "mac"), "⌘,");
  assert.equal(format_shortcut_display("Mod+Shift+I", "windows"), "Ctrl+Shift+I");
});

test("registered shortcuts can be removed", () => {
  const dispose = register_shortcuts([{ id: "test.bold", title: "Bold", keys: ["Mod+B"], scope: "global", run: () => true }]);
  assert.equal(list_registered_shortcut_definitions().some((item) => item.id === "test.bold"), true);
  dispose();
  assert.equal(list_registered_shortcut_definitions().some((item) => item.id === "test.bold"), false);
});
