/** Plugin main 的 Profile action 与凭据边界测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_PLUGIN_MAIN } from "../bin/chat/main/ChatPluginMain.js";

/** 激活 main 并返回按 ID 注册的 action。 */
async function activate_chat_main() {
  const actions = new Map();
  await CHAT_PLUGIN_MAIN.activate({
    plugin: {
      id: "chat",
      action(action) {
        actions.set(action.id, action);
      },
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    system: {
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return actions;
}

/** 创建可观察完整替换结果的 Profile 配置上下文。 */
function create_config_context(initial_config) {
  let config = structuredClone(initial_config);
  return {
    context: {
      config: {
        async get() {
          return structuredClone(config);
        },
        async set(next) {
          config = structuredClone(next);
        },
      },
    },
    read: () => structuredClone(config),
  };
}

test("Chat main 读取 Profile 时不泄漏 Channel 凭据", async () => {
  const actions = await activate_chat_main();
  const store = create_config_context({
    channels: [
      { id: "telegram_main", type: "telegram", name: "Main", bot_token: "telegram-secret" },
      { id: "feishu_main", type: "feishu", name: "Work", app_id: "cli_a", app_secret: "feishu-secret" },
    ],
  });

  const profile = await actions.get("profile.read").run(undefined, store.context);

  assert.equal(JSON.stringify(profile).includes("telegram-secret"), false);
  assert.equal(JSON.stringify(profile).includes("feishu-secret"), false);
  assert.deepEqual(profile.channels.map((channel) => channel.secret_configured), [true, true]);
});

test("Chat main 保存时为空的凭据输入会保留已有凭据", async () => {
  const actions = await activate_chat_main();
  const store = create_config_context({
    channels: [
      { id: "telegram_main", type: "telegram", name: "Old", bot_token: "kept-secret" },
    ],
  });

  const result = await actions.get("profile.save").run({
    queue: { max_concurrency: 4 },
    channels: [{
      id: "telegram_main",
      type: "telegram",
      name: "New",
      bot_token: "",
      secret_configured: true,
    }],
  }, store.context);

  assert.equal(store.read().channels[0].bot_token, "kept-secret");
  assert.equal(result.channels[0].secret_configured, true);
  assert.equal("bot_token" in result.channels[0], false);
});

test("Chat main 拒绝没有凭据的新 Channel", async () => {
  const actions = await activate_chat_main();
  const store = create_config_context({ channels: [] });

  await assert.rejects(
    () => actions.get("profile.save").run({
      queue: {},
      channels: [{ id: "telegram_new", type: "telegram", name: "New" }],
    }, store.context),
    /Telegram Bot Token is required/u,
  );
});
