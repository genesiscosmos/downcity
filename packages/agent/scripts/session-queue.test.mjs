/**
 * @file 验证 SessionQueue 只保存最小 Command 数据并维护确定的 FIFO 顺序。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionQueue } from "../bin/session/SessionQueue.js";

function create_command(name, executed, cancel) {
  return {
    kind: cancel ? "prompt" : "maintenance",
    execute: async () => {
      executed.push(name);
    },
    ...(cancel ? { cancel } : {}),
  };
}

test("SessionQueue 按 FIFO 返回具体 Command 对象", async () => {
  const queue = new SessionQueue();
  const executed = [];
  const first = create_command("first", executed);
  const second = create_command("second", executed);

  queue.enqueue_command(first);
  queue.enqueue_command(second);

  assert.equal(queue.take_next(), first);
  assert.equal(queue.take_next(), second);
  assert.equal(queue.take_next(), undefined);
  assert.equal(queue.has_command(), false);

  await first.execute();
  await second.execute();
  assert.deepEqual(executed, ["first", "second"]);
});

test("SessionQueue drain 保留 Command 对象的原始顺序", async () => {
  const queue = new SessionQueue();
  const executed = [];
  queue.enqueue_command(create_command("first", executed));
  queue.enqueue_command(create_command("second", executed));
  queue.enqueue_command(create_command("third", executed));

  const commands = queue.drain();
  assert.equal(queue.has_command(), false);
  for (const command of commands) await command.execute();
  assert.deepEqual(executed, ["first", "second", "third"]);
});

test("SessionQueue cancel 只移除拥有取消行为的 Command", async () => {
  const queue = new SessionQueue();
  const executed = [];
  const cancelled = [];
  queue.enqueue_command(create_command("prompt", executed, () => {
    cancelled.push("prompt");
  }));
  queue.enqueue_command(create_command("action", executed));

  assert.equal(queue.cancel(), 1);
  assert.deepEqual(cancelled, ["prompt"]);

  const retained = queue.drain();
  assert.equal(retained.length, 1);
  await retained[0].execute();
  assert.deepEqual(executed, ["action"]);
});

test("SessionQueue 可以把未处理 Command 恢复到队列头部", async () => {
  const queue = new SessionQueue();
  const executed = [];
  const head = create_command("head", executed);
  const middle = create_command("middle", executed);
  const tail = create_command("tail", executed);
  queue.enqueue_command(tail);
  queue.restore_front([head, middle]);

  for (const command of queue.drain()) await command.execute();
  assert.deepEqual(executed, ["head", "middle", "tail"]);
});

test("SessionQueue 保留 Command 的类别与完成信息", async () => {
  const queue = new SessionQueue();
  const completion = {
    type: "action",
    id: "config-completed",
    title: "Configuration updated",
    description: "The next step uses the new configuration.",
  };
  const command = {
    kind: "maintenance",
    execute: async () => {},
    completion,
  };
  queue.enqueue_command(command);

  assert.equal(queue.take_next(), command);
  assert.equal(command.kind, "maintenance");
  assert.deepEqual(command.completion, completion);
});
