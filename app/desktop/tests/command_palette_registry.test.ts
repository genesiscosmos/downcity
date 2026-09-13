/** Desktop 命令面板注册表测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../src/renderer/features/command-palette/registry.ts";
import type { CommandDefinition } from "../src/renderer/features/command-palette/types.ts";

/** 构造一条最小可用命令。 */
function command(id: string): CommandDefinition {
  return { id, title: id, group: "navigation", run: () => undefined };
}

test("按注册顺序返回快照，注销只移除自己的条目", () => {
  const registry = new CommandRegistry();
  const unregister_first = registry.register([command("nav.first")]);
  const unregister_second = registry.register([command("nav.second")]);

  assert.deepEqual(registry.get_snapshot().map((item) => item.id), ["nav.first", "nav.second"]);

  unregister_first();
  assert.deepEqual(registry.get_snapshot().map((item) => item.id), ["nav.second"]);

  unregister_second();
  assert.deepEqual(registry.get_snapshot(), []);
});

test("严格模式下 id 冲突抛错且注册表内容不变", () => {
  const registry = new CommandRegistry({ strict: true });
  registry.register([command("nav.duplicate")]);

  assert.throws(
    () => registry.register([command("nav.duplicate"), command("nav.fresh")]),
    /Duplicate command id: nav\.duplicate/,
  );
  // 原子语义：冲突批次内的其他命令也不得进入注册表。
  assert.deepEqual(registry.get_snapshot().map((item) => item.id), ["nav.duplicate"]);
});

test("非严格模式下 id 冲突只跳过冲突项并保留先注册者", () => {
  const registry = new CommandRegistry();
  const original = { ...command("nav.duplicate"), title: "first" };
  registry.register([original]);

  const unregister = registry.register([{ ...command("nav.duplicate"), title: "second" }, command("nav.fresh")]);

  assert.deepEqual(registry.get_snapshot().map((item) => item.title), ["first", "nav.fresh"]);

  // 注销冲突批次不得误删他人注册的同 id 命令。
  unregister();
  assert.deepEqual(registry.get_snapshot().map((item) => item.id), ["nav.duplicate"]);
});

test("订阅者收到注册与注销通知，取消订阅后不再收到", () => {
  const registry = new CommandRegistry();
  let notifications = 0;
  const unsubscribe = registry.subscribe(() => {
    notifications += 1;
  });

  const unregister = registry.register([command("nav.one")]);
  assert.equal(notifications, 1);

  unregister();
  assert.equal(notifications, 2);

  unsubscribe();
  registry.register([command("nav.two")]);
  assert.equal(notifications, 2);
});

test("空批次注册是空操作", () => {
  const registry = new CommandRegistry();
  let notifications = 0;
  registry.subscribe(() => {
    notifications += 1;
  });

  const unregister = registry.register([]);
  unregister();

  assert.equal(notifications, 0);
  assert.deepEqual(registry.get_snapshot(), []);
});

test("同 id 先后注册再注销不抛错（React StrictMode 序列）", () => {
  const registry = new CommandRegistry({ strict: true });

  const unregister_first = registry.register([command("nav.strict")]);
  unregister_first();
  const unregister_second = registry.register([command("nav.strict")]);

  assert.deepEqual(registry.get_snapshot().map((item) => item.id), ["nav.strict"]);
  unregister_second();
  assert.deepEqual(registry.get_snapshot(), []);
});

test("无变更时快照引用保持稳定", () => {
  const registry = new CommandRegistry();
  registry.register([command("nav.stable")]);

  const first = registry.get_snapshot();
  assert.equal(registry.get_snapshot(), first);

  const unregister = registry.register([command("nav.more")]);
  assert.notEqual(registry.get_snapshot(), first);

  const after_register = registry.get_snapshot();
  unregister();
  assert.notEqual(registry.get_snapshot(), after_register);
});
