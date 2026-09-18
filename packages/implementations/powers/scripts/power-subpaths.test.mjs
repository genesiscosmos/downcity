/**
 * 内建 power 独立子路径入口回归测试。
 *
 * 关键点（中文）
 * - 每个子路径必须通过 package exports 独立解析并暴露对应 power class。
 * - 子路径入口不能回流根入口或已删除的内建集合工厂。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const power_entries = [
  ["chat", "ChatPower"],
  ["memory", "MemoryPower"],
  ["skill", "SkillPower"],
  ["task", "TaskPower"],
  ["web", "WebPower"],
];

test("所有内建 power 子路径均可独立导入", async () => {
  for (const [power_name, class_name] of power_entries) {
    const power_module = await import(`@downcity/powers/${power_name}`);
    assert.equal(
      typeof power_module[class_name],
      "function",
      `${power_name} 应导出 ${class_name}`,
    );
  }
});

test("内建 power 子路径不加载根入口或集合工厂", async () => {
  for (const [power_name] of power_entries) {
    const entry_source = await fs.readFile(
      new URL(`../bin/${power_name}.js`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(entry_source, /BuiltinPowers|from ["']\.\/index\.js/);
  }
});

test("根入口不再导出默认内建集合工厂", async () => {
  const power_module = await import("@downcity/powers");
  assert.equal("createBuiltinPowers" in power_module, false);
  assert.equal("BUILTIN_POWER_CLASSES" in power_module, false);
});

test("已删除的 Contact 与 Workboard Power 不再公开", async () => {
  const power_module = await import("@downcity/powers");
  assert.equal("ContactPower" in power_module, false);
  assert.equal("WorkboardPower" in power_module, false);
  await assert.rejects(() => import("@downcity/powers/contact"), /Package subpath/u);
  await assert.rejects(() => import("@downcity/powers/workboard"), /Package subpath/u);
  assert.deepEqual(
    power_module.create_builtin_power_registrations()
      .map((registration) => registration.power.name)
      .filter((power_id) => ["contact", "workboard"].includes(power_id)),
    [],
  );
});

test("内建 Power 注册使用随 package 发布的独立 README 资产", async () => {
  const power_module = await import("@downcity/powers");
  const registrations = power_module.create_builtin_power_registrations();
  for (const registration of registrations) {
    assert.equal(
      path.basename(registration.readme),
      `${registration.power.name}.readme.md`,
    );
    assert.match(await fs.readFile(registration.readme, "utf8"), /^# /u);
  }
});

test("Renderer 子路径统一导出 React Surface registry", async () => {
  const power_react = await import("@downcity/city/power/react");
  const renderers = await import("@downcity/powers/renderers");
  assert.equal(typeof power_react.define_power_renderer, "function");
  assert.deepEqual(Object.keys(renderers.BUILTIN_POWER_RENDERERS).sort(), [
    "chat",
    "skill",
    "task",
    "web",
  ]);
  for (const renderer of Object.values(renderers.BUILTIN_POWER_RENDERERS)) {
    assert.equal(typeof renderer, "object");
    assert.equal(
      (typeof renderer.sidebar === "function" && typeof renderer.mainview === "function") || typeof renderer.config === "function",
      true,
    );
  }
});

test("内建 Power 子路径不再公开宿主通用配置 Schema", async () => {
  const schema_exports = [
    ["chat", "CHAT_POWER_CONFIG_JSON_SCHEMA"],
    ["web", "WEB_POWER_CONFIG_JSON_SCHEMA"],
  ];
  for (const [power_name, export_name] of schema_exports) {
    const power_module = await import(`@downcity/powers/${power_name}`);
    assert.equal(export_name in power_module, false, `${power_name} 不应导出 ${export_name}`);
  }
});

test("memory 子路径导出 Provider 与 Storage Adapter", async () => {
  const memory_module = await import("@downcity/powers/memory");
  assert.equal(typeof memory_module.MemoryPower, "function");
  assert.equal(typeof memory_module.BuiltinMemoryProvider, "function");
  assert.equal(typeof memory_module.FileMemoryStorageAdapter, "function");
  assert.equal(typeof memory_module.get_default_file_memory_root_path, "function");
});
