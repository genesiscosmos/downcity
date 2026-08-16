/** CLI 文件型 Agent/Plugin 配置与本地控制面行为测试。 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";

const zod_module_url = import.meta.resolve("zod");

function create_temp_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-config-storage-"));
}

function write_plugin_source(root, input = {}) {
  const id = input.id ?? "example";
  const version = input.version ?? "1.0.0";
  const description = input.description ?? "Example Plugin for configuration tests.";
  fs.writeFileSync(path.join(root, "plugin.json"), JSON.stringify({
    schema_version: 1,
    id,
    version,
    description,
    entry: input.entry ?? "index.js",
    ...(input.extra_manifest ?? {}),
  }));
  fs.writeFileSync(path.join(root, "index.js"), input.module_source ?? `
import { z } from ${JSON.stringify(zod_module_url)};
const config_type = z.object({
  endpoint: z.string().min(1),
  api_key: z.string().optional().meta({ writeOnly: true }),
  timeout_ms: z.number().int().min(1000).default(10000),
}).strict();
class ExamplePlugin {
  static type = { config: config_type };
  constructor({ config }) {
    this.name = ${JSON.stringify(input.runtime_id ?? id)};
    this.title = "Example";
    this.description = config.endpoint;
    this.timeout_ms = config.timeout_ms;
    this.actions = {};
  }
}
export const plugin = ExamplePlugin;
`);
  if (input.source_config) {
    fs.writeFileSync(path.join(root, "config.toml"), input.source_config);
  }
}

test("City reset 只删除 SQLite 数据库文件", async () => {
  const platform_root = create_temp_root();
  const database_path = path.join(platform_root, "downcity.db");
  const preserved_files = [
    path.join(platform_root, ".env"),
    path.join(platform_root, "main", "model-db.key"),
    path.join(platform_root, "plugins", "keep.txt"),
  ];
  try {
    fs.mkdirSync(path.join(platform_root, "main"), { recursive: true });
    fs.mkdirSync(path.join(platform_root, "plugins"), { recursive: true });
    for (const file_path of [database_path, `${database_path}-wal`, `${database_path}-shm`, ...preserved_files]) {
      fs.writeFileSync(file_path, "keep");
    }
    const { reset_city_database } = await import("../bin/city/runtime/CityReset.js");
    const removed_files = await reset_city_database(platform_root);
    assert.deepEqual(removed_files.sort(), [
      database_path,
      `${database_path}-shm`,
      `${database_path}-wal`,
    ].sort());
    for (const file_path of preserved_files) assert.equal(fs.existsSync(file_path), true);
  } finally {
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Agent 文件定义与 Workspace 数据库索引独立管理", async () => {
  const platform_root = create_temp_root();
  const project_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const agents = await import("../bin/city/process/registry/AgentConfigRepository.js");
    const workspaces = await import("../bin/city/process/registry/WorkspaceRepository.js");
    const plugins = await import("../bin/city/process/registry/PluginRepository.js");
    const workspace = workspaces.create_workspace({ workspace_path: project_root, name: "Project" });
    agents.create_agent_config({
      agent_id: "file_agent",
      execution: { type: "api", model_id: "model_a" },
      instruction: "You are File Agent.",
    });
    plugins.save_plugin_profile("chat", "file_agent", { channels: [] });
    plugins.set_agent_plugin_reference({
      agent_id: "file_agent",
      plugin_id: "chat",
      profile: "file_agent",
    });
    assert.equal(plugins.get_agent_plugin_reference("file_agent", "chat").profile, "file_agent");
    assert.equal(workspaces.get_workspace(workspace.workspace_id).workspace_path, project_root);

    const agent_dir = path.join(platform_root, "agents", "file_agent");
    const agent_file = JSON.parse(fs.readFileSync(path.join(agent_dir, "agent.json"), "utf8"));
    assert.equal(agent_file.schema_version, 2);
    assert.deepEqual(agent_file.plugins, { chat: { profile: "file_agent" } });
    assert.equal(fs.readFileSync(path.join(agent_dir, "SOUL.md"), "utf8"), "You are File Agent.");
    assert.match(
      fs.readFileSync(path.join(platform_root, "plugins", "chat", "config.toml"), "utf8"),
      /\[profiles\.file_agent\]/u,
    );

    const database = new Database(path.join(platform_root, "downcity.db"));
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table';")
      .all().map((row) => row.name);
    database.close();
    assert.equal(tables.includes("managed_agents"), false);
    assert.equal(tables.includes("agent_plugins"), false);
    assert.equal(tables.includes("plugin_resources"), false);
    assert.equal(tables.includes("plugin_installations"), false);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(project_root, { recursive: true, force: true });
  }
});

test("Embassy 只接受新的 Federation 身份环境变量", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  process.env.DC_MODEL_DB_KEY = "embassy-session-env-test";
  try {
    const { EmbassySessionResolver } = await import("../bin/city/shared/EmbassySessionResolver.js");
    const resolver = new EmbassySessionResolver();
    const current = await resolver.resolve_current_user({
      env: {
        DOWNCITY_FEDERATION_URL: "https://federation.example.com/",
        DOWNCITY_USER_TOKEN: "current-user-token",
      },
      verify_user: false,
    });
    assert.equal(current.federation_url, "https://federation.example.com");
    assert.equal(current.user_token, "current-user-token");
    const legacy = await resolver.resolve_current_user({
      env: { CITY_URL: "https://legacy.example.com", CITY_USER_TOKEN: "legacy-token" },
      require_user_token: false,
      verify_user: false,
    });
    assert.equal(legacy.federation_url, "https://base.downcity.ai");
    assert.equal(legacy.user_token, "");
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    delete process.env.DC_MODEL_DB_KEY;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("平台身份凭证不会向 Workspace 泄漏", async () => {
  const { strip_platform_session_env } = await import("../bin/city/env/ProcessEnv.js");
  assert.deepEqual(strip_platform_session_env({
    SAFE_VALUE: "kept",
    DOWNCITY_FEDERATION_URL: "https://federation.example.com",
    DOWNCITY_USER_TOKEN: "token",
    CITY_URL: "https://legacy.example.com",
  }), { SAFE_VALUE: "kept" });
});

test("CLI City daemon 使用唯一的全局 runtime", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const paths = await import("../bin/city/process/registry/CityPaths.js");
    const daemon = await import("../bin/city/process/daemon/Manager.js");
    const runtime_dir = paths.get_city_daemon_runtime_dir_path();
    assert.equal(runtime_dir, path.join(platform_root, "runtimes", "city"));
    assert.equal(daemon.get_daemon_pid_path(), path.join(runtime_dir, "daemon.pid"));
    assert.equal(daemon.get_daemon_meta_path(), path.join(runtime_dir, "daemon.json"));
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Agent HTTP Bearer Token 按 Agent 隔离", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const { create_cli_local_data } = await import("../bin/city/runtime/LocalData.js");
    const { AuthService } = await import("../bin/city/runtime/auth/AuthService.js");
    const data = create_cli_local_data();
    const first = new AuthService({ agent_id: "agent_one", repository: data.agent_tokens });
    const token = first.create_token({ name: "test" });
    assert.equal(first.authenticate_bearer_header(`Bearer ${token.token}`).agent_id, "agent_one");
    const second = new AuthService({ agent_id: "agent_two", repository: data.agent_tokens });
    assert.throws(() => second.authenticate_bearer_header(`Bearer ${token.token}`), /Invalid bearer token/u);
    data.database.close();
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("第三方 Plugin 使用 definition ID 目录和单 constructor", async () => {
  const platform_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_plugin_source(plugin_source);
    const agents = await import("../bin/city/process/registry/AgentConfigRepository.js");
    const plugins = await import("../bin/city/process/registry/PluginRepository.js");
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    const local_data = await import("../bin/city/runtime/LocalData.js");
    const assembly = await import("../bin/city/runtime/AgentAssembly.js");

    agents.create_agent_config({ agent_id: "plugin_agent" });
    const installed = await installer.install_plugin(plugin_source);
    assert.equal(installed.id, "example");
    assert.equal(installed.entry, "index.js");
    assert.match(installed.integrity, /^sha256-[a-f0-9]{64}$/u);
    assert.equal(installed.config.schema.properties.api_key.writeOnly, true);
    assert.deepEqual(installed.config.defaults, undefined);
    const plugin_dir = path.join(platform_root, "plugins", "example");
    assert.equal(fs.existsSync(path.join(plugin_dir, "plugin.json")), true);
    assert.equal(fs.existsSync(path.join(plugin_dir, "index.js")), true);
    assert.equal(fs.existsSync(path.join(plugin_dir, "artifact")), false);

    assert.throws(
      () => plugins.save_plugin_profile("example", "default", {}),
      /required property 'endpoint'/u,
    );
    plugins.save_plugin_profile("example", "default", {
      endpoint: "https://example.com",
      api_key: "plain-secret",
    });
    plugins.set_agent_plugin_reference({
      agent_id: "plugin_agent",
      plugin_id: "example",
    });
    assert.match(fs.readFileSync(path.join(plugin_dir, "config.toml"), "utf8"), /plain-secret/u);

    const data = local_data.create_cli_local_data();
    try {
      const loader = assembly.create_cli_plugin_loader({ plugin_repository: data.plugins });
      const runtime_plugins = await loader.create_plugins(data.agents.get("plugin_agent"));
      assert.equal(runtime_plugins.length, 1);
      assert.equal(runtime_plugins[0].name, "example");
      assert.equal(runtime_plugins[0].description, "https://example.com");
      assert.equal(runtime_plugins[0].timeout_ms, 10000);
    } finally {
      data.database.close();
    }

    write_plugin_source(plugin_source, {
      version: "1.1.0",
      source_config: "schema_version = 1\n[profiles.default]\nendpoint = \"overwritten\"\n",
    });
    const updated = await installer.update_plugin("example");
    assert.equal(updated.version, "1.1.0");
    assert.match(fs.readFileSync(path.join(plugin_dir, "config.toml"), "utf8"), /plain-secret/u);
    assert.throws(() => plugins.remove_installed_plugin("example"), /registered by Agent plugin_agent/u);
    plugins.remove_agent_plugin_reference("plugin_agent", "example");
    plugins.remove_installed_plugin("example");
    assert.equal(fs.existsSync(plugin_dir), false);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(plugin_source, { recursive: true, force: true });
  }
});

test("Plugin 安装拒绝内置 ID、非法清单与逃逸入口", async () => {
  const platform_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    write_plugin_source(plugin_source, { id: "chat" });
    await assert.rejects(() => installer.install_plugin(plugin_source), /conflicts with builtin/u);

    write_plugin_source(plugin_source, { extra_manifest: { actions: [] } });
    await assert.rejects(() => installer.install_plugin(plugin_source), /unknown field: actions/u);

    write_plugin_source(plugin_source, { extra_manifest: { config: { schema: {} } } });
    await assert.rejects(() => installer.install_plugin(plugin_source), /unknown field: config/u);

    write_plugin_source(plugin_source, { entry: "../outside.js" });
    await assert.rejects(() => installer.install_plugin(plugin_source), /stay inside the Plugin directory/u);

    write_plugin_source(plugin_source, { module_source: "export const value = 1;" });
    await assert.rejects(
      () => installer.install_plugin(plugin_source),
      /must export plugin constructor/u,
    );

    write_plugin_source(plugin_source, {
      module_source: "export class InvalidPlugin { static type = { config: {} }; }\nexport const plugin = InvalidPlugin;",
    });
    await assert.rejects(
      () => installer.install_plugin(plugin_source),
      /type\.config must be a Zod type/u,
    );

    write_plugin_source(plugin_source);
    fs.symlinkSync("index.js", path.join(plugin_source, "linked.js"));
    await assert.rejects(() => installer.install_plugin(plugin_source), /cannot contain symlinks/u);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(plugin_source, { recursive: true, force: true });
  }
});

test("Plugin 实例 ID 必须匹配 plugin.json", async () => {
  const platform_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_plugin_source(plugin_source, { id: "declared", runtime_id: "unexpected" });
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    const agents = await import("../bin/city/process/registry/AgentConfigRepository.js");
    const plugins = await import("../bin/city/process/registry/PluginRepository.js");
    const local_data = await import("../bin/city/runtime/LocalData.js");
    const assembly = await import("../bin/city/runtime/AgentAssembly.js");
    await installer.install_plugin(plugin_source);
    agents.create_agent_config({ agent_id: "mismatch_agent" });
    plugins.save_plugin_profile("declared", "default", { endpoint: "https://example.com" });
    plugins.set_agent_plugin_reference({ agent_id: "mismatch_agent", plugin_id: "declared" });
    const data = local_data.create_cli_local_data();
    try {
      const loader = assembly.create_cli_plugin_loader({ plugin_repository: data.plugins });
      await assert.rejects(
        () => loader.create_plugins(data.agents.get("mismatch_agent")),
        /instance ID does not match definition/u,
      );
    } finally {
      data.database.close();
    }
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(plugin_source, { recursive: true, force: true });
  }
});

test("内建 Plugin Catalog 暴露 profile Schema", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const catalog = await import("../bin/city/process/plugin/PluginCatalog.js");
    const chat = catalog.get_plugin_catalog_item("chat");
    assert.equal(chat.plugin_id, "chat");
    assert.equal(chat.source, "builtin");
    assert.equal(chat.config_schema.properties.channels.type, "array");
    assert.equal(
      chat.config_schema.properties.channels.items.oneOf[0].properties.bot_token.writeOnly,
      true,
    );
    const result = spawnSync(process.execPath, [path.resolve("bin/downcity.js"), "plugin", "list"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Chat \(chat\)/u);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("内建 Chat Plugin 从 Agent 选择的 TOML profile 装配", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const agents = await import("../bin/city/process/registry/AgentConfigRepository.js");
    const plugins = await import("../bin/city/process/registry/PluginRepository.js");
    const local_data = await import("../bin/city/runtime/LocalData.js");
    const assembly = await import("../bin/city/runtime/AgentAssembly.js");
    agents.create_agent_config({ agent_id: "chat_agent" });
    plugins.save_plugin_profile("chat", "primary", {
      queue: { max_concurrency: 5 },
      channels: [{
        id: "telegram_primary",
        type: "telegram",
        name: "Primary Bot",
        bot_token: "plain-token",
      }],
    });
    plugins.set_agent_plugin_reference({
      agent_id: "chat_agent",
      plugin_id: "chat",
      profile: "primary",
    });
    const data = local_data.create_cli_local_data();
    try {
      const loader = assembly.create_cli_plugin_loader({ plugin_repository: data.plugins });
      const [chat] = await loader.create_plugins(data.agents.get("chat_agent"));
      assert.equal(chat.get_channel_id({}, "telegram"), "telegram_primary");
      assert.deepEqual(chat.getQueueWorkerConfig({}), { max_concurrency: 5 });
      assert.equal(chat.resolveChannelAccount({}, "telegram").bot_token, "plain-token");
    } finally {
      data.database.close();
    }
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("CLI 生命周期只属于 City 且 Agent model 命令可见", () => {
  const platform_root = create_temp_root();
  try {
    const result = spawnSync(process.execPath, [path.resolve("bin/downcity.js"), "agent", "--help"], {
      encoding: "utf8",
      env: { ...process.env, DC_PLATFORM_ROOT: platform_root, NO_COLOR: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /model/u);
    assert.doesNotMatch(result.stdout, /\bstart\b/u);
    assert.doesNotMatch(result.stdout, /\bstop\b/u);
  } finally {
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Agent 模型选择只接受对话执行模型", async () => {
  const binding = await import("../bin/city/runtime/city-model/CityAiServiceBinding.js");
  const descriptor = (id, modalities) => ({ id, name: id, description: id, modalities, tags: [] });
  const choices = binding.toCityAiModelChoices([
    descriptor("chat", ["text", "stream"]),
    descriptor("compatible", ["openai"]),
    descriptor("image", ["image"]),
    descriptor("speech", ["tts", "asr"]),
  ]);
  assert.deepEqual(choices.map((choice) => choice.value), ["chat", "compatible"]);
});
