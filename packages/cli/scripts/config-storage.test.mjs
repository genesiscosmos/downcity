/**
 * CLI Agent 全局配置与 Chat 装配行为测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";

function create_temp_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-config-storage-"));
}

test("Agent 配置只从全局 DB 读取", async () => {
  const platform_root = create_temp_root();
  const project_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    fs.writeFileSync(path.join(project_root, "downcity.json"), JSON.stringify({
      id: "legacy_agent",
      version: "1.0.0",
    }));
    const store = await import("../bin/city/process/registry/AgentConfigStore.js");
    assert.equal(store.readAgentConfig(project_root), null);

    const { PlatformStore } = await import("../bin/city/runtime/store/index.js");
    const platform_store = new PlatformStore();
    platform_store.setSecureSettingJsonSync("city.agent.configs", {
      v: 1,
      configs: [{
        project_root: project_root,
        id: "migrated_agent",
        version: "1.0.0",
        execution: { type: "api", modelId: "model_a" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }],
    });
    platform_store.close();

    assert.equal(store.readAgentConfig(project_root).id, "migrated_agent");

    store.upsertAgentConfig({
      project_root: project_root,
      id: "db_agent",
      plugins: { chat: { queue: { maxConcurrency: 3 } } },
    });
    const merged_config = store.readAgentConfig(project_root);
    assert.equal(merged_config.id, "db_agent");
    assert.equal(merged_config.execution.modelId, "model_a");
    assert.equal(merged_config.plugins.chat.queue.maxConcurrency, 3);
    assert.equal(fs.existsSync(path.join(platform_root, "downcity.db")), true);

    const second_project_root = path.join(platform_root, "second-agent");
    store.upsertAgentConfig({
      project_root: second_project_root,
      id: "second_agent",
      version: "1.0.0",
      execution: { type: "api", modelId: "model_b" },
    });
    store.upsertAgentConfig({
      project_root: project_root,
      start: { port: 7001 },
    });
    assert.equal(store.readAgentConfig(second_project_root).execution.modelId, "model_b");
    assert.equal(store.readAgentConfig(project_root).execution.modelId, "model_a");
    assert.equal(store.readAgentConfig(project_root).start.port, 7001);

    const rolling_upgrade_store = new PlatformStore();
    rolling_upgrade_store.setSecureSettingJsonSync("city.agent.configs", {
      v: 1,
      configs: [
        {
          ...store.readAgentConfig(project_root),
          id: "newer_legacy_daemon_update",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
        {
          ...store.readAgentConfig(second_project_root),
          id: "stale_legacy_daemon_value",
          updated_at: "2000-01-01T00:00:00.000Z",
        },
      ],
    });
    rolling_upgrade_store.close();
    assert.equal(
      store.readAgentConfig(project_root).id,
      "newer_legacy_daemon_update",
    );
    assert.equal(store.readAgentConfig(second_project_root).id, "second_agent");

    const database = new Database(path.join(platform_root, "downcity.db"));
    const row_count = database.prepare(
      "SELECT COUNT(*) AS count FROM agent_configs;",
    ).get().count;
    const legacy_count = database.prepare(`
      SELECT COUNT(*) AS count
      FROM platform_secure_settings
      WHERE key = 'city.agent.configs';
    `).get().count;
    database.close();
    assert.equal(row_count, 2);
    assert.equal(legacy_count, 0);
  } finally {
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(project_root, { recursive: true, force: true });
  }
});

test("Agent model 命令已注册到 CLI", () => {
  const cli_path = path.resolve("bin/downcity.js");
  const result = spawnSync(
    process.execPath,
    [cli_path, "agent", "model", "--help"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: \S+ agent model/);
  assert.match(result.stdout, /--set <model-id>/);
  assert.doesNotMatch(result.stdout, /--session-id/);
});

test("Agent 模型选择只接受对话执行模型", async () => {
  const binding = await import(
    "../bin/city/runtime/city-model/CityAiServiceBinding.js"
  );
  const descriptor = (id, modalities) => ({
    id,
    name: id,
    description: "",
    modalities,
    tags: [],
    meta: {},
  });
  const choices = binding.toCityAiModelChoices([
    descriptor("chat", ["text", "stream"]),
    descriptor("compatible", ["openai"]),
    descriptor("image", ["image"]),
    descriptor("speech", ["tts", "asr"]),
  ]);
  assert.deepEqual(choices.map((choice) => choice.value), ["chat", "compatible"]);
});

test("Chat 装配严格使用当前 Agent 绑定与 queue 配置", async () => {
  const { createCityStaticBuiltinPlugins } = await import(
    "../bin/city/runtime/plugins/CityBuiltinPlugins.js"
  );
  const plugins = createCityStaticBuiltinPlugins({
    config: {
      id: "agent_test",
      version: "1.0.0",
      plugins: {
        chat: {
          queue: { maxConcurrency: 5 },
          channels: {
            telegram: {
              enabled: true,
              channelAccountId: "telegram_bound",
            },
          },
        },
      },
    },
  });
  const chat = plugins.find((plugin) => plugin.name === "chat");
  assert.ok(chat);
  assert.equal(chat.getChannelAccountId({}, "telegram"), "telegram_bound");
  assert.equal(chat.isChannelEnabled({}, "telegram"), true);
  assert.equal(chat.isChannelEnabled({}, "feishu"), false);
  assert.deepEqual(chat.getQueueWorkerConfig({}), { maxConcurrency: 5 });

  const unbound = createCityStaticBuiltinPlugins().find((plugin) => plugin.name === "chat");
  assert.equal(unbound.isChannelEnabled({}, "telegram"), false);
  assert.equal(unbound.getChannelAccountId({}, "telegram"), "");
});

test("CLI 通过 City Store Adapter 向 ChatPlugin 注入共享账号", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const { CityChatAccountStore } = await import(
      "../bin/city/runtime/plugins/CityChatAccountStore.js"
    );
    const account_store = new CityChatAccountStore();
    await account_store.upsert({
      id: "telegram-main",
      channel: "telegram",
      name: "main bot",
    });

    const { createCityStaticBuiltinPlugins } = await import(
      "../bin/city/runtime/plugins/CityBuiltinPlugins.js"
    );
    const plugins = createCityStaticBuiltinPlugins({
      config: {
        id: "agent_test",
        version: "1.0.0",
        plugins: {
          chat: {
            channels: {
              telegram: {
                enabled: true,
                channelAccountId: "telegram-main",
              },
            },
          },
        },
      },
    });
    const chat = plugins.find((plugin) => plugin.name === "chat");
    assert.equal(chat.resolveChannelAccount({}, "telegram")?.name, "main bot");
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});
