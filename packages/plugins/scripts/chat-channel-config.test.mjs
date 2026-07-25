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
    getChannelAccountId: () => "",
    getAccount: () => null,
  };
}

test("ChatPlugin 配置只来自 constructor", () => {
  const telegram = create_channel("telegram");
  const queue = { maxConcurrency: 7, mergeDebounceMs: 123 };
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

test("ChatPlugin 只通过宿主注入的 account_store 解析共享账号", () => {
  const account = {
    id: "telegram-main",
    channel: "telegram",
    name: "main bot",
    botToken: "token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const reads = [];
  const account_store = {
    list: () => [account],
    get: (account_id) => {
      reads.push(account_id);
      return account_id === account.id ? account : null;
    },
    upsert: async () => {},
    remove: async () => {},
  };
  const plugin = new ChatPlugin({
    account_store,
    channels: [new TelegramChannel({ channelAccountId: account.id })],
  });

  assert.equal(plugin.resolveChannelAccount({}, "telegram"), account);
  assert.deepEqual(reads, [account.id]);
});
