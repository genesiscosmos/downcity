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
    const repository = await import(
      "../bin/city/process/registry/ManagedAgentRepository.js"
    );
    assert.equal(repository.list_managed_agents_by_workspace(project_root).length, 0);

    repository.create_managed_agent({
      agent_id: "db_agent",
      workspace_path: project_root,
      execution: { type: "api", model_id: "model_a" },
    });
    const plugins = await import(
      "../bin/city/process/registry/PluginRepository.js"
    );
    plugins.set_agent_plugin_binding({
      agent_id: "db_agent",
      plugin_name: "chat",
      enabled: true,
      config: { queue: { max_concurrency: 3 } },
    });
    const config = repository.get_managed_agent("db_agent");
    assert.equal(config.agent_id, "db_agent");
    assert.equal(config.execution.model_id, "model_a");
    assert.equal("plugins" in config, false);
    assert.equal(
      plugins.get_agent_plugin_binding("db_agent", "chat").config.queue.max_concurrency,
      3,
    );
    assert.equal(fs.existsSync(path.join(platform_root, "downcity.db")), true);

    repository.create_managed_agent({
      agent_id: "second_agent",
      workspace_path: project_root,
      execution: { type: "api", model_id: "model_b" },
    });
    repository.update_managed_agent({
      agent_id: "db_agent",
      start: { port: 7001 },
    });
    assert.equal(repository.get_managed_agent("second_agent").execution.model_id, "model_b");
    assert.equal(repository.get_managed_agent("db_agent").execution.model_id, "model_a");
    assert.equal(repository.get_managed_agent("db_agent").start.port, 7001);
    assert.deepEqual(
      repository.list_managed_agents_by_workspace(project_root)
        .map((agent) => agent.agent_id),
      ["db_agent", "second_agent"],
    );
    assert.throws(
      () => repository.get_managed_agent_by_workspace(project_root),
      /multiple agents/,
    );

    const database = new Database(path.join(platform_root, "downcity.db"));
    const row_count = database.prepare(
      "SELECT COUNT(*) AS count FROM managed_agents;",
    ).get().count;
    database.close();
    assert.equal(row_count, 2);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(project_root, { recursive: true, force: true });
  }
});

test("Daemon 状态按 agent_id 隔离在全局 runtime", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const paths = await import("../bin/city/process/registry/CityPaths.js");
    const daemon = await import("../bin/city/process/daemon/Manager.js");
    const runtime_dir = paths.get_agent_runtime_dir_path("agent_one");
    assert.equal(runtime_dir, path.join(platform_root, "runtimes", "agent_one"));
    assert.equal(
      daemon.getDaemonPidPath("agent_one"),
      path.join(runtime_dir, "daemon.pid"),
    );
    assert.equal(
      daemon.getDaemonMetaPath("agent_one"),
      path.join(runtime_dir, "daemon.json"),
    );
    assert.equal(
      daemon.getDaemonLogPath("agent_one"),
      path.join(runtime_dir, "daemon.log"),
    );
    assert.throws(
      () => paths.get_agent_runtime_dir_path("../outside"),
      /Invalid agent_id/,
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Agent HTTP 路由默认拒绝未认证请求", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const { Hono } = await import("hono");
    const { AuthService } = await import("../bin/city/runtime/auth/AuthService.js");
    const {
      createRouteAuthGuardMiddleware,
      SERVER_AUTH_ROUTE_POLICIES,
    } = await import("../bin/city/runtime/auth/RoutePolicy.js");
    const auth_service = new AuthService({ agent_id: "agent_one" });
    const app = new Hono();
    app.use("*", createRouteAuthGuardMiddleware(
      auth_service,
      SERVER_AUTH_ROUTE_POLICIES,
    ));
    app.get("/health", (context) => context.json({ status: "ok" }));
    app.get("/private", (context) => context.json({ status: "ok" }));

    assert.equal((await app.request("/health")).status, 200);
    assert.equal((await app.request("/private")).status, 401);

    const issued = auth_service.create_token({ name: "test" });
    const authenticated = await app.request("/private", {
      headers: { authorization: `Bearer ${issued.token}` },
    });
    assert.equal(authenticated.status, 200);

    const other_agent_service = new AuthService({ agent_id: "agent_two" });
    assert.throws(
      () => other_agent_service.authenticate_bearer_header(`Bearer ${issued.token}`),
      /Invalid bearer token/,
    );
    auth_service.close();
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Plugin 安装与 Agent Binding 配置使用全局数据库", async () => {
  const platform_root = create_temp_root();
  const workspace_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 1,
      name: "example",
      version: "1.0.0",
      entry: "index.js",
      config: {
        schema: "config.schema.json",
      },
    }));
    fs.writeFileSync(path.join(plugin_source, "config.schema.json"), JSON.stringify({
        type: "object",
        required: ["endpoint"],
        properties: { endpoint: { type: "string" } },
        additionalProperties: false,
    }));
    fs.writeFileSync(path.join(plugin_source, "index.js"), `
export const plugin_factory = {
  create({ config }) {
    return {
      name: "example",
      title: "Example",
      description: config.endpoint,
      actions: {},
    };
  },
};
`);
    const agents = await import("../bin/city/process/registry/ManagedAgentRepository.js");
    const plugins = await import("../bin/city/process/registry/PluginRepository.js");
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    agents.create_managed_agent({ agent_id: "plugin_agent", workspace_path: workspace_root });
    const installed = await installer.install_plugin(plugin_source);
    assert.equal(installed.plugin_name, "example");
    assert.equal(fs.existsSync(installed.entry_path), true);
    assert.match(installed.integrity, /^sha256-[a-f0-9]{64}$/u);
    assert.throws(
      () => plugins.set_agent_plugin_binding({
        agent_id: "plugin_agent",
        plugin_name: "example",
        enabled: true,
        config: {},
      }),
      /config must have required property 'endpoint'/,
    );
    const binding = plugins.set_agent_plugin_binding({
      agent_id: "plugin_agent",
      plugin_name: "example",
      enabled: true,
      config: { endpoint: "https://example.com" },
    });
    assert.equal(binding.config.endpoint, "https://example.com");
    const runtime = await import("../bin/city/runtime/plugins/CityExternalPlugins.js");
    const runtime_plugins = await runtime.create_external_plugins({ bindings: [binding] });
    assert.equal(runtime_plugins.length, 1);
    assert.equal(runtime_plugins[0].name, "example");
    assert.equal(runtime_plugins[0].description, "https://example.com");
    const renamed_manifest = JSON.parse(
      fs.readFileSync(path.join(plugin_source, "downcity.plugin.json"), "utf8"),
    );
    renamed_manifest.name = "renamed-example";
    fs.writeFileSync(
      path.join(plugin_source, "downcity.plugin.json"),
      JSON.stringify(renamed_manifest),
    );
    await assert.rejects(
      () => installer.update_plugin("example"),
      /Plugin update name mismatch/,
    );
    assert.equal(plugins.get_installed_plugin("example").version, "1.0.0");
    assert.equal(agents.get_managed_agent("plugin_agent").plugins, undefined);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(workspace_root, { recursive: true, force: true });
    fs.rmSync(plugin_source, { recursive: true, force: true });
  }
});

test("内建与外部 Plugin 使用统一 Catalog 配置协议", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const catalog = await import("../bin/city/process/plugin/PluginCatalog.js");
    const chat = catalog.get_plugin_catalog_item("chat");
    assert.ok(chat);
    assert.equal(chat.source, "builtin");
    assert.equal(
      chat.config_schema.properties.channels.properties.telegram
        .properties.channel_account_id.type,
      "string",
    );
    assert.equal(
      chat.config_schema.properties.channels.properties.telegram
        .properties.channel_account_id.x_downcity.resource_type,
      "channel_account",
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("内建 Plugin 静态 Catalog 的 Action 与 Runtime 保持一致", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const catalog = await import("../bin/city/process/plugin/PluginCatalog.js");
    const runtime = await import("../bin/city/runtime/plugins/CityBuiltinPlugins.js");
    for (const plugin of runtime.createCityStaticBuiltinPlugins()) {
      const item = catalog.get_plugin_catalog_item(plugin.name);
      assert.ok(item, `Missing Catalog item: ${plugin.name}`);
      assert.deepEqual(item.actions, Object.keys(plugin.actions || {}).sort());
    }
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Plugin 安装拒绝保留名称与非法 Manifest 默认配置", async () => {
  const platform_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    fs.writeFileSync(path.join(plugin_source, "index.js"), "export const plugin_factory = {};\n");
    fs.writeFileSync(path.join(plugin_source, "config.schema.json"), JSON.stringify({
      type: "object",
      properties: {},
    }));
    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 1,
      name: "chat",
      version: "1.0.0",
      entry: "index.js",
    }));
    await assert.rejects(
      () => installer.install_plugin(plugin_source),
      /name is reserved by a built-in Plugin/,
    );

    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 1,
      name: "invalid-defaults",
      version: "1.0.0",
      entry: "index.js",
      config: {
        schema: "config.schema.json",
        defaults: [],
      },
    }));
    await assert.rejects(
      () => installer.install_plugin(plugin_source),
      /config.defaults must be an object/,
    );

    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 1,
      name: "escaped-entry",
      version: "1.0.0",
      entry: "../outside.js",
    }));
    await assert.rejects(
      () => installer.install_plugin(plugin_source),
      /entry must stay inside the plugin directory/,
    );

    fs.symlinkSync("index.js", path.join(plugin_source, "linked-entry.js"));
    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 1,
      name: "linked-entry",
      version: "1.0.0",
      entry: "linked-entry.js",
    }));
    await assert.rejects(
      () => installer.install_plugin(plugin_source),
      /artifact cannot contain symlinks/,
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(plugin_source, { recursive: true, force: true });
  }
});

test("CLI 不再注册旧 City 与 Plugin 特例命令", () => {
  const cli_path = path.resolve("bin/downcity.js");
  const platform_root = create_temp_root();
  const root_help = spawnSync(process.execPath, [cli_path, "--help"], {
    encoding: "utf8",
    env: { ...process.env, DC_PLATFORM_ROOT: platform_root },
  });
  const agent_help = spawnSync(process.execPath, [cli_path, "agent", "--help"], {
    encoding: "utf8",
    env: { ...process.env, DC_PLATFORM_ROOT: platform_root },
  });
  const plugin_help = spawnSync(process.execPath, [cli_path, "plugin", "--help"], {
    encoding: "utf8",
    env: { ...process.env, DC_PLATFORM_ROOT: platform_root },
  });
  fs.rmSync(platform_root, { recursive: true, force: true });
  assert.equal(root_help.status, 0, root_help.stderr);
  assert.doesNotMatch(root_help.stdout, /^\s+(init|update|config|chat|task|memory|skill|web|contact)\b/m);
  assert.doesNotMatch(agent_help.stdout, /^\s+(chat|history)\b/m);
  assert.doesNotMatch(plugin_help.stdout, /^\s+(command|schedule)\b/m);
  assert.match(plugin_help.stdout, /^\s+action\b/m);
});

test("Agent model 命令已注册到 CLI", () => {
  const cli_path = path.resolve("bin/downcity.js");
  const platform_root = create_temp_root();
  const result = spawnSync(
    process.execPath,
    [cli_path, "agent", "model", "--help"],
    {
      encoding: "utf8",
      env: { ...process.env, DC_PLATFORM_ROOT: platform_root },
    },
  );
  fs.rmSync(platform_root, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: \S+ agent model/);
  assert.match(result.stdout, /--set <model-id>/);
  assert.doesNotMatch(result.stdout, /--session-id/);
});

test("非交互 Agent 命令不根据当前 Workspace 推断目标", async () => {
  const platform_root = create_temp_root();
  const workspace_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  process.env.DC_MODEL_DB_KEY = "config-storage-agent-selection-test";
  let reset_key_cache = () => {};
  try {
    const crypto = await import("../bin/city/runtime/store/crypto.js");
    reset_key_cache = crypto.resetModelDbKeyCache;
    reset_key_cache();
    const repository = await import(
      "../bin/city/process/registry/ManagedAgentRepository.js"
    );
    repository.create_managed_agent({
      agent_id: "workspace_agent",
      workspace_path: workspace_root,
      execution: { type: "api", model_id: "model_a" },
    });

    const cli_path = path.resolve("bin/downcity.js");
    const environment = {
      ...process.env,
      DC_PLATFORM_ROOT: platform_root,
      NO_COLOR: "1",
    };
    const implicit_result = spawnSync(
      process.execPath,
      [cli_path, "agent", "status"],
      {
        cwd: workspace_root,
        encoding: "utf8",
        env: environment,
      },
    );
    assert.equal(implicit_result.status, 1);
    assert.match(
      `${implicit_result.stdout}\n${implicit_result.stderr}`,
      /Agent ID is required/,
    );

    const explicit_result = spawnSync(
      process.execPath,
      [cli_path, "agent", "status", "workspace_agent"],
      {
        cwd: workspace_root,
        encoding: "utf8",
        env: environment,
      },
    );
    assert.equal(explicit_result.status, 0, explicit_result.stderr);
    assert.doesNotMatch(
      `${explicit_result.stdout}\n${explicit_result.stderr}`,
      /Agent ID is required/,
    );
  } finally {
    reset_key_cache();
    delete process.env.DC_PLATFORM_ROOT;
    delete process.env.DC_MODEL_DB_KEY;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(workspace_root, { recursive: true, force: true });
  }
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
    chat_config: {
      queue: { max_concurrency: 5 },
      channels: {
        telegram: {
          enabled: true,
          channel_account_id: "telegram_bound",
        },
      },
    },
  });
  const chat = plugins.find((plugin) => plugin.name === "chat");
  assert.ok(chat);
  assert.equal(chat.getChannelAccountId({}, "telegram"), "telegram_bound");
  assert.equal(chat.isChannelEnabled({}, "telegram"), true);
  assert.equal(chat.isChannelEnabled({}, "feishu"), false);
  assert.deepEqual(chat.getQueueWorkerConfig({}), { max_concurrency: 5 });

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
      chat_config: {
        channels: {
          telegram: {
            enabled: true,
            channel_account_id: "telegram-main",
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
