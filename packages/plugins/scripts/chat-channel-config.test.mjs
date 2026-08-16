/**
 * Chat channel 构造配置公开行为测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ChatPlugin, TelegramChannel } from "../bin/index.js";

function create_channel(name) {
  return {
    name,
    isEnabled: () => false,
    get_channel_id: () => "",
    getAccount: () => null,
  };
}

test("ChatPlugin 配置只来自 constructor", () => {
  const telegram = create_channel("telegram");
  const queue = { max_concurrency: 7, merge_debounce_ms: 123 };
  const plugin = new ChatPlugin({ queue, channels: [telegram] });

  assert.equal(plugin.channels[0], telegram);
  assert.deepEqual(plugin.getQueueWorkerConfig({}), queue);
});

test("ChatPlugin 不提供配置修改 action", () => {
  const plugin = new ChatPlugin({ channels: [] });

  assert.equal("open" in plugin.actions, false);
  assert.equal("close" in plugin.actions, false);
  assert.equal("configuration" in plugin.actions, false);
  assert.equal("configure" in plugin.actions, false);
});

test("ChatPlugin 只消费宿主已经解析的 profile 渠道配置", () => {
  const plugin = new ChatPlugin({
    channels: [new TelegramChannel({
      id: "telegram-main",
      name: "main bot",
      bot_token: "token",
    })],
  });

  assert.equal(plugin.get_channel_id({}, "telegram"), "telegram-main");
  const account = plugin.resolveChannelAccount({}, "telegram");
  assert.ok(account);
  assert.deepEqual(account, {
    id: "telegram-main",
    channel: "telegram",
    name: "main bot",
    bot_token: "token",
    created_at: account.created_at,
    updated_at: account.updated_at,
  });
});
