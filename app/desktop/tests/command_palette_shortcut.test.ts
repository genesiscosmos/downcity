/** Desktop 命令面板键位展示测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { command_shortcuts, format_shortcut, resolve_command_shortcut } from "../src/renderer/features/command-palette/shortcut_display.ts";
import { command_id_prefixes } from "../src/renderer/features/command-palette/types.ts";

test("mac 使用符号，windows 与 linux 使用可读修饰键名", () => {
  assert.equal(format_shortcut("Mod+1", "mac"), "⌘1");
  assert.equal(format_shortcut("Mod+1", "windows"), "Ctrl+1");
  assert.equal(format_shortcut("Mod+1", "linux"), "Ctrl+1");
});

test("Escape 在所有平台都显示为 Esc", () => {
  assert.equal(format_shortcut("Escape", "mac"), "Esc");
  assert.equal(format_shortcut("Escape", "windows"), "Esc");
  assert.equal(format_shortcut("Escape", "linux"), "Esc");
});

test("多修饰键按平台规则拼接", () => {
  assert.equal(format_shortcut("Mod+Shift+P", "mac"), "⌘⇧P");
  assert.equal(format_shortcut("Mod+Shift+P", "windows"), "Ctrl+Shift+P");
  assert.equal(format_shortcut("Mod+,", "mac"), "⌘,");
});

test("无键位的命令返回 undefined", () => {
  assert.equal(resolve_command_shortcut("goto.session", "mac"), undefined);
  assert.equal(resolve_command_shortcut("nav.open-settings", "mac"), "⌘,");
  assert.equal(resolve_command_shortcut("nav.open-settings", "windows"), "Ctrl+,");
});

/**
 * 展示映射快照。
 *
 * 这张表会与 `DesktopShell` 的键盘分支形成第二份键位事实源（见 PRD 6.6）。
 * 该断言锁死内容，使任何单侧改动都会失败，从而强制修改者回到 shell 里同步，
 * 并提醒后续把两处收敛为 features/shortcuts/ 的单一事实源。
 */
test("键位展示映射与 DesktopShell 现有键盘分支一一对应", () => {
  assert.deepEqual(command_shortcuts, {
    "nav.open-workspace": ["Mod+1"],
    "nav.open-chat": ["Mod+2"],
    "nav.open-powers": ["Mod+3"],
    "nav.toggle-sidebar": ["Mod+B"],
    "nav.toggle-baybar": ["Mod+L"],
    "nav.open-settings": ["Mod+,"],
    "create.conversation": ["Mod+R"],
    "nav.back-from-settings": ["Escape"],
  });
});

test("键位展示映射只包含已实现的命名空间", () => {
  const prefixes = Object.values(command_id_prefixes);
  for (const command_id of Object.keys(command_shortcuts)) {
    assert.ok(
      prefixes.some((prefix) => command_id.startsWith(prefix)),
      `${command_id} 不符合 <group>.<name> 命名空间约定`,
    );
  }
});
