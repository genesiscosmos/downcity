/**
 * 内建 plugin 独立子路径入口回归测试。
 *
 * 关键点（中文）
 * - 每个子路径必须通过 package exports 独立解析并暴露对应 plugin class。
 * - 子路径入口不能回流根入口或已删除的内建集合工厂。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const plugin_entries = [
  ["chat", "ChatPlugin"],
  ["image", "ImagePlugin"],
  ["memory", "MemoryPlugin"],
  ["skill", "SkillPlugin"],
  ["sound", "SoundPlugin"],
  ["task", "TaskPlugin"],
  ["web", "WebPlugin"],
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

test("已删除的 Contact 与 Workboard Plugin 不再公开", async () => {
  const plugin_module = await import("@downcity/plugins");
  assert.equal("ContactPlugin" in plugin_module, false);
  assert.equal("WorkboardPlugin" in plugin_module, false);
  await assert.rejects(() => import("@downcity/plugins/contact"), /Package subpath/u);
  await assert.rejects(() => import("@downcity/plugins/workboard"), /Package subpath/u);
  assert.deepEqual(
    plugin_module.create_builtin_plugin_registrations()
      .map((registration) => registration.id)
      .filter((plugin_id) => ["contact", "workboard"].includes(plugin_id)),
    [],
  );
});

test("内建 Plugin 注册使用随 package 发布的独立 README 资产", async () => {
  const plugin_module = await import("@downcity/plugins");
  const registrations = plugin_module.create_builtin_plugin_registrations();
  for (const registration of registrations) {
    assert.equal(
      path.basename(registration.readme),
      `${registration.id}.readme.md`,
    );
    assert.match(await fs.readFile(registration.readme, "utf8"), /^# /u);
  }
});

test("Renderer 子路径统一导出 React Surface registry", async () => {
  const plugin_react = await import("@downcity/plugin/react");
  const renderers = await import("@downcity/plugins/renderers");
  assert.equal(typeof plugin_react.define_plugin_renderer, "function");
  assert.deepEqual(Object.keys(renderers.BUILTIN_PLUGIN_RENDERERS).sort(), [
    "chat",
    "image",
    "skill",
    "sound",
    "task",
    "web",
  ]);
  for (const renderer of Object.values(renderers.BUILTIN_PLUGIN_RENDERERS)) {
    assert.equal(typeof renderer, "object");
    assert.equal(
      (typeof renderer.sidebar === "function" && typeof renderer.mainview === "function") || typeof renderer.config === "function",
      true,
    );
  }
});

test("内建 Plugin 子路径不再公开宿主通用配置 Schema", async () => {
  const schema_exports = [
    ["chat", "CHAT_PLUGIN_CONFIG_JSON_SCHEMA"],
    ["image", "IMAGE_PLUGIN_CONFIG_JSON_SCHEMA"],
    ["sound", "SOUND_PLUGIN_CONFIG_JSON_SCHEMA"],
    ["web", "WEB_PLUGIN_CONFIG_JSON_SCHEMA"],
  ];
  for (const [plugin_name, export_name] of schema_exports) {
    const plugin_module = await import(`@downcity/plugins/${plugin_name}`);
    assert.equal(export_name in plugin_module, false, `${plugin_name} 不应导出 ${export_name}`);
  }
});

test("memory 子路径导出 Provider 与 Storage Adapter", async () => {
  const memory_module = await import("@downcity/plugins/memory");
  assert.equal(typeof memory_module.MemoryPlugin, "function");
  assert.equal(typeof memory_module.BuiltinMemoryProvider, "function");
  assert.equal(typeof memory_module.FileMemoryStorageAdapter, "function");
  assert.equal(typeof memory_module.get_default_file_memory_root_path, "function");
});
