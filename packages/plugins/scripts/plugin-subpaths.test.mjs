/**
 * 内建 plugin 独立子路径入口回归测试。
 *
 * 关键点（中文）
 * - 每个子路径必须通过 package exports 独立解析并暴露对应 plugin class。
 * - 子路径入口不能回流根入口或已删除的内建集合工厂。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const plugin_entries = [
  ["chat", "ChatPlugin"],
  ["contact", "ContactPlugin"],
  ["image", "ImagePlugin"],
  ["memory", "MemoryPlugin"],
  ["skill", "SkillPlugin"],
  ["sound", "SoundPlugin"],
  ["task", "TaskPlugin"],
  ["web", "WebPlugin"],
  ["workboard", "WorkboardPlugin"],
];

test("所有内建 plugin 子路径均可独立导入", async () => {
  for (const [plugin_name, class_name] of plugin_entries) {
    const plugin_module = await import(`@downcity/plugins/${plugin_name}`);
    assert.equal(
      typeof plugin_module[class_name],
      "function",
      `${plugin_name} 应导出 ${class_name}`,
    );
  }
});

test("内建 plugin 子路径不加载根入口或集合工厂", async () => {
  for (const [plugin_name] of plugin_entries) {
    const entry_source = await fs.readFile(
      new URL(`../bin/${plugin_name}.js`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(entry_source, /BuiltinPlugins|from ["']\.\/index\.js/);
  }
});

test("根入口不再导出默认内建集合工厂", async () => {
  const plugin_module = await import("@downcity/plugins");
  assert.equal("createBuiltinPlugins" in plugin_module, false);
  assert.equal("BUILTIN_PLUGIN_CLASSES" in plugin_module, false);
});

test("memory 子路径导出 Provider 与 Storage Adapter", async () => {
  const memory_module = await import("@downcity/plugins/memory");
  assert.equal(typeof memory_module.MemoryPlugin, "function");
  assert.equal(typeof memory_module.BuiltinMemoryProvider, "function");
  assert.equal(typeof memory_module.FileMemoryStorageAdapter, "function");
  assert.equal(typeof memory_module.get_default_file_memory_root_path, "function");
});
