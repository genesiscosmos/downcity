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

test("Agent 与 Workspace 在全局 DB 中独立管理", async () => {
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
    const workspaces = await import(
      "../bin/city/process/registry/WorkspaceRepository.js"
    );

    const workspace = workspaces.create_workspace({
      workspace_path: project_root,
      name: "Project",
    });
    repository.create_managed_agent({
      agent_id: "db_agent",
      workspace_id: workspace.workspace_id,
      execution: { type: "api", model_id: "model_a" },
    });
    const plugins = await import(
      "../bin/city/process/registry/PluginRepository.js"
    );
    assert.deepEqual(plugins.list_agent_plugin_bindings("db_agent"), []);
    plugins.set_agent_plugin_binding({
      agent_id: "db_agent",
      plugin_name: "chat",
      enabled: true,
      config: { queue: { max_concurrency: 3 } },
    });
    const config = repository.get_managed_agent("db_agent");
    assert.equal(config.agent_id, "db_agent");
    assert.equal(config.execution.model_id, "model_a");
    assert.equal("workspace_path" in config, false);
    assert.equal("plugins" in config, false);
    assert.equal(
      plugins.get_agent_plugin_binding("db_agent", "chat").config.queue.max_concurrency,
      3,
    );
    assert.equal(fs.existsSync(path.join(platform_root, "downcity.db")), true);

    repository.create_managed_agent({
      agent_id: "second_agent",
      workspace_id: workspace.workspace_id,
      execution: { type: "api", model_id: "model_b" },
    });
    assert.equal(repository.get_managed_agent("second_agent").execution.model_id, "model_b");
    assert.equal(repository.get_managed_agent("db_agent").execution.model_id, "model_a");
    assert.equal(repository.get_managed_agent("db_agent").workspace_id, workspace.workspace_id);
    assert.equal(repository.get_managed_agent("second_agent").workspace_id, workspace.workspace_id);
    assert.equal(workspaces.get_workspace(workspace.workspace_id).workspace_path, project_root);
    assert.equal(workspaces.get_workspace_by_path(project_root).workspace_id, workspace.workspace_id);
    assert.equal(workspaces.list_workspaces().length, 1);

    const database = new Database(path.join(platform_root, "downcity.db"));
    const row_count = database.prepare(
      "SELECT COUNT(*) AS count FROM managed_agents;",
    ).get().count;
    const agent_columns = database.prepare("PRAGMA table_info(managed_agents);")
      .all().map((column) => column.name);
    const workspace_row_count = database.prepare(
      "SELECT COUNT(*) AS count FROM workspaces;",
    ).get().count;
    database.close();
    assert.equal(row_count, 2);
    assert.equal(agent_columns.includes("workspace_path"), false);
    assert.equal(workspace_row_count, 1);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(project_root, { recursive: true, force: true });
  }
});

test("旧 Federation 管理配置一次性迁入 downcity.db", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  process.env.DC_MODEL_DB_KEY = "federation-config-migration-test";
  let reset_key_cache = () => {};
  try {
    const crypto = await import("../bin/city/runtime/store/crypto.js");
    reset_key_cache = crypto.resetModelDbKeyCache;
    reset_key_cache();
    const { PlatformStore, create_federation_platform_store } = await import(
      "../bin/city/runtime/store/index.js"
    );
    const legacy_store = new PlatformStore(path.join(platform_root, "federation.db"));
    legacy_store.setSecureSettingJsonSync("federation.config", {
      active_server_url: "https://legacy.example.com",
      servers: [{
        name: "legacy",
        base_url: "https://legacy.example.com",
      }],
    });
    legacy_store.close();

    const unified_store = create_federation_platform_store();
    assert.equal(
      unified_store.getSecureSettingJsonSync("federation.config").active_server_url,
      "https://legacy.example.com",
    );
    unified_store.setSecureSettingJsonSync("federation.config", {
      active_server_url: "https://current.example.com",
      servers: [],
    });
    unified_store.close();

    const changed_legacy_store = new PlatformStore(path.join(platform_root, "federation.db"));
    changed_legacy_store.setSecureSettingJsonSync("federation.config", {
      active_server_url: "https://stale.example.com",
      servers: [],
    });
    changed_legacy_store.close();

    const reopened_store = create_federation_platform_store();
    assert.equal(
      reopened_store.getSecureSettingJsonSync("federation.config").active_server_url,
      "https://current.example.com",
    );
    reopened_store.close();
    assert.equal(fs.existsSync(path.join(platform_root, "downcity.db")), true);
  } finally {
    reset_key_cache();
    delete process.env.DC_PLATFORM_ROOT;
    delete process.env.DC_MODEL_DB_KEY;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("旧 City 状态 key 一次性迁入 Downcity 配置", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  process.env.DC_MODEL_DB_KEY = "downcity-config-key-migration-test";
  let reset_key_cache = () => {};
  try {
    const crypto = await import("../bin/city/runtime/store/crypto.js");
    reset_key_cache = crypto.resetModelDbKeyCache;
    reset_key_cache();
    const { create_downcity_platform_store } = await import(
      "../bin/city/runtime/store/index.js"
    );
    const store = create_downcity_platform_store();
    store.setSecureSettingJsonSync("city.city.state", {
      selected_federation_url: "https://legacy.example.com",
      profiles: [{
        name: "legacy",
        federation_url: "https://legacy.example.com",
      }],
      sessions: {},
    });
    store.close();

    const config_store = await import(
      "../bin/city/shared/DowncityConfigStore.js"
    );
    const migrated = config_store.read_downcity_config();
    assert.equal(migrated.selected_federation_url, "https://legacy.example.com");

    const reopened_store = create_downcity_platform_store();
    const persisted = reopened_store.getSecureSettingJsonSync("downcity.config");
    reopened_store.close();
    assert.equal(persisted.selected_federation_url, "https://legacy.example.com");
  } finally {
    reset_key_cache();
    delete process.env.DC_PLATFORM_ROOT;
    delete process.env.DC_MODEL_DB_KEY;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Embassy 会话只接受新的 Federation 身份环境变量", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  process.env.DC_MODEL_DB_KEY = "embassy-session-env-test";
  let reset_key_cache = () => {};
  try {
    const crypto = await import("../bin/city/runtime/store/crypto.js");
    reset_key_cache = crypto.resetModelDbKeyCache;
    reset_key_cache();
    const { EmbassySessionResolver } = await import(
      "../bin/city/shared/EmbassySessionResolver.js"
    );
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
    assert.equal(current.source, "env");
    assert.deepEqual(current.env_overrides, {
      federation_url: true,
      user_token: true,
    });

    const legacy = await resolver.resolve_current_user({
      env: {
        DOWNCITY_CITY_URL: "https://legacy.example.com",
        DOWNCITY_CITY_USER_TOKEN: "legacy-user-token",
        CITY_URL: "https://older.example.com",
        CITY_USER_TOKEN: "older-user-token",
      },
      require_user_token: false,
      verify_user: false,
    });
    assert.equal(legacy.federation_url, "https://base.downcity.ai");
    assert.equal(legacy.user_token, "");
    assert.equal(legacy.source, "embassy-session");
    assert.deepEqual(legacy.env_overrides, {
      federation_url: false,
      user_token: false,
    });
  } finally {
    reset_key_cache();
    delete process.env.DC_PLATFORM_ROOT;
    delete process.env.DC_MODEL_DB_KEY;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("平台 Env 不向 Workspace 泄漏新旧身份凭证", async () => {
  const { strip_platform_session_env } = await import(
    "../bin/city/env/ProcessEnv.js"
  );
  assert.deepEqual(strip_platform_session_env({
    SAFE_VALUE: "kept",
    DOWNCITY_FEDERATION_URL: "https://federation.example.com",
    DOWNCITY_USER_TOKEN: "current-user-token",
    DOWNCITY_CITY_URL: "https://legacy.example.com",
    DOWNCITY_CITY_USER_TOKEN: "legacy-user-token",
    CITY_URL: "https://older.example.com",
    CITY_USER_TOKEN: "older-user-token",
  }), {
    SAFE_VALUE: "kept",
  });
});

test("CLI City daemon 使用唯一的全局 runtime", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const paths = await import("../bin/city/process/registry/CityPaths.js");
    const daemon = await import("../bin/city/process/daemon/Manager.js");
    const runtime_dir = paths.get_city_daemon_runtime_dir_path();
    assert.equal(runtime_dir, path.join(platform_root, "runtimes", "city"));
    assert.equal(
      daemon.get_daemon_pid_path(),
      path.join(runtime_dir, "daemon.pid"),
    );
    assert.equal(
      daemon.get_daemon_meta_path(),
      path.join(runtime_dir, "daemon.json"),
    );
    assert.equal(
      daemon.get_daemon_log_path(),
      path.join(runtime_dir, "daemon.log"),
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

test("一个入口安装多个 Plugin constructor 并使用统一 CLI Factory", async () => {
  const platform_root = create_temp_root();
  const workspace_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const config_schema = {
      type: "object",
      required: ["endpoint"],
      properties: { endpoint: { type: "string" } },
      additionalProperties: false,
    };
    const resource_schema = {
      title: "Example API",
      type: "object",
      required: ["id", "type", "name", "api_key"],
      properties: {
        id: { type: "string", readOnly: true },
        type: { type: "string", const: "api" },
        name: { type: "string", readOnly: true },
        api_key: { type: "string", writeOnly: true },
      },
      additionalProperties: false,
    };
    const installation_manifest = {
      manifest_version: 3,
      entry: "index.js",
      plugins: [
        {
          name: "example",
          version: "1.0.0",
          description: "Example Plugin for configuration tests.",
          config: { schema: config_schema },
          resources: { schema: structuredClone(resource_schema) },
        },
        {
          name: "companion",
          version: "1.0.0",
          title: "Companion",
          description: "Companion Plugin from the same entry.",
        },
      ],
    };
    fs.writeFileSync(
      path.join(plugin_source, "downcity.plugin.json"),
      JSON.stringify(installation_manifest),
    );
    fs.writeFileSync(path.join(plugin_source, "index.js"), `
globalThis.__example_project_loads = (globalThis.__example_project_loads || 0) + 1;
const config_schema = ${JSON.stringify(config_schema)};
const resource_schema = ${JSON.stringify(resource_schema)};
class ExamplePlugin {
  static manifest = {
    name: "example",
    version: "1.0.0",
    description: "Example Plugin for configuration tests.",
    config: { schema: config_schema },
    resources: { schema: resource_schema },
  };
  static resolve_resource({ resource }) {
    return { name: \`API \${resource.api_key.slice(-4)}\` };
  }
  constructor({ config, resources }) {
    this.name = "example";
    this.title = "Example";
    this.description = \`\${config.endpoint} · \${resources[0]?.name || "none"}\`;
    this.actions = {};
  }
}
class CompanionPlugin {
  static manifest = {
    name: "companion",
    version: "1.0.0",
    title: "Companion",
    description: "Companion Plugin from the same entry.",
  };
  constructor() {
    this.name = "companion";
    this.title = "Companion";
    this.description = \`loads=\${globalThis.__example_project_loads}\`;
    this.actions = {};
  }
}
export const plugins = [ExamplePlugin, CompanionPlugin];
`);
    const agents = await import("../bin/city/process/registry/ManagedAgentRepository.js");
    const workspaces = await import("../bin/city/process/registry/WorkspaceRepository.js");
    const plugins = await import("../bin/city/process/registry/PluginRepository.js");
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    const workspace = workspaces.create_workspace({ workspace_path: workspace_root });
    agents.create_managed_agent({
      agent_id: "plugin_agent",
      workspace_id: workspace.workspace_id,
    });
    const installation = await installer.install_plugins(plugin_source);
    assert.deepEqual(
      installation.manifest.plugins.map((plugin) => plugin.name),
      ["example", "companion"],
    );
    assert.equal(fs.existsSync(installation.entry_path), true);
    assert.match(installation.integrity, /^sha256-[a-f0-9]{64}$/u);
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
      resource_ids: [],
    });
    const resource_service = await import(
      "../bin/city/process/plugin/PluginResourceService.js"
    );
    const resource = await resource_service.create_plugin_resource({
      plugin_name: "example",
      fields: { type: "api", api_key: "secret-key" },
    });
    const resolved_binding = plugins.set_agent_plugin_binding({
      agent_id: "plugin_agent",
      plugin_name: "example",
      enabled: true,
      config: { endpoint: "https://example.com" },
      resource_ids: [resource.resource_id],
    });
    const companion_binding = plugins.set_agent_plugin_binding({
      agent_id: "plugin_agent",
      plugin_name: "companion",
      enabled: true,
      config: {},
      resource_ids: [],
    });
    assert.equal(binding.config.endpoint, "https://example.com");
    assert.equal(resource.item.name, "API -key");
    const runtime = await import("../bin/city/runtime/plugins/PluginAssembler.js");
    const runtime_plugins = await runtime.assemble_plugins({
      bindings: [resolved_binding, companion_binding],
    });
    assert.equal(runtime_plugins.length, 2);
    assert.equal(runtime_plugins[0].name, "example");
    assert.equal(runtime_plugins[0].description, "https://example.com · API -key");
    assert.equal(runtime_plugins[1].name, "companion");
    assert.equal(runtime_plugins[1].description, "loads=1");

    installation_manifest.plugins[0].resources.schema.required.push("region");
    installation_manifest.plugins[0].resources.schema.properties.region = { type: "string" };
    fs.writeFileSync(
      path.join(plugin_source, "downcity.plugin.json"),
      JSON.stringify(installation_manifest),
    );
    await assert.rejects(
      () => installer.update_plugin("example"),
      /Resource schema is incompatible with.*region/,
    );
    assert.equal(plugins.get_installed_plugin("example").manifest.version, "1.0.0");

    installation_manifest.plugins[0].resources.schema = resource_schema;
    const removing_manifest = structuredClone(installation_manifest);
    removing_manifest.plugins = removing_manifest.plugins
      .filter((plugin) => plugin.name !== "companion");
    fs.writeFileSync(
      path.join(plugin_source, "downcity.plugin.json"),
      JSON.stringify(removing_manifest),
    );
    await assert.rejects(
      () => installer.update_plugin("example"),
      /Plugin is still bound to agent plugin_agent: companion/,
    );
    fs.writeFileSync(
      path.join(plugin_source, "downcity.plugin.json"),
      JSON.stringify(installation_manifest),
    );

    plugins.remove_agent_plugin_binding("plugin_agent", "example");
    assert.throws(
      () => plugins.remove_plugin_installation("example"),
      /still owns Resource/,
    );
    const resource_repository = await import(
      "../bin/city/process/registry/PluginResourceRepository.js"
    );
    resource_repository.remove_plugin_resource("example", resource.resource_id);
    assert.throws(
      () => plugins.remove_plugin_installation("example"),
      /Plugin is still bound to agent plugin_agent: companion/,
    );
    plugins.remove_agent_plugin_binding("plugin_agent", "companion");
    const removed_installation = plugins.remove_plugin_installation("example");
    assert.deepEqual(
      removed_installation.manifest.plugins.map((plugin) => plugin.name),
      ["example", "companion"],
    );
    assert.equal(plugins.get_installed_plugin("example"), null);
    assert.equal(plugins.get_installed_plugin("companion"), null);
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
    assert.equal(chat.description, "Connects Agents to Telegram, Feishu, and QQ channels.");
    assert.equal(
      chat.resource_schema.oneOf[0].properties.id.readOnly,
      true,
    );
    assert.equal(
      chat.resource_schema.oneOf[0].properties.bot_token.writeOnly,
      true,
    );
    assert.equal(chat.resource_schema.oneOf[0].properties.type.const, "telegram");
    const list_result = spawnSync(
      process.execPath,
      [path.resolve("bin/downcity.js"), "plugin", "list"],
      {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    assert.equal(list_result.status, 0, list_result.stderr);
    assert.match(list_result.stdout, /Chat \(chat\)/);
    assert.match(
      list_result.stdout,
      /description\s+Connects Agents to Telegram, Feishu, and QQ channels\./,
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("内建 Plugin 静态 Manifest 不复制运行时 Action", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const catalog = await import("../bin/city/process/plugin/PluginCatalog.js");
    const loader = await import("../bin/city/runtime/plugins/PluginTypeLoader.js");
    const plugin_types = await loader.load_plugin_types("chat");
    for (const plugin_type of plugin_types) {
      const plugin_name = plugin_type.manifest.name;
      const item = catalog.get_plugin_catalog_item(plugin_name);
      assert.ok(item, `Missing Catalog item: ${plugin_name}`);
      const config = plugin_name === "web"
        ? { cdp_url: "http://127.0.0.1:9222" }
        : item.default_config;
      const plugin = new plugin_type({ config, resources: [] });
      assert.equal(plugin.name, plugin_name);
      assert.equal("actions" in plugin_type.manifest, false);
      assert.equal("actions" in item, false);
      assert.equal(typeof plugin.actions, "object");
    }
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Plugin 数组安装拒绝名称冲突与非法 Manifest", async () => {
  const platform_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    fs.writeFileSync(path.join(plugin_source, "index.js"), "export const plugins = [];\n");
    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 3,
      entry: "index.js",
      plugins: [{ name: "chat", description: "Conflicts with the built-in Chat Plugin." }],
    }));
    await assert.rejects(
      () => installer.install_plugins(plugin_source),
      /Plugin name is already installed: chat/,
    );

    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 3,
      entry: "index.js",
      plugins: [{
        name: "static-actions",
        description: "Invalid Plugin with duplicated static Actions.",
        actions: [],
      }],
    }));
    await assert.rejects(
      () => installer.install_plugins(plugin_source),
      /contains unknown field: actions/,
    );

    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 3,
      entry: "index.js",
      plugins: [{ name: "missing-description" }],
    }));
    await assert.rejects(
      () => installer.install_plugins(plugin_source),
      /Plugin description is required: missing-description/,
    );

    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 3,
      entry: "index.js",
      plugins: [{
        name: "invalid-defaults",
        description: "Invalid Plugin defaults fixture.",
        config: { schema: { type: "object", properties: {} }, defaults: [] },
      }],
    }));
    await assert.rejects(
      () => installer.install_plugins(plugin_source),
      /config.defaults must be an object/,
    );

    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 3,
      entry: "../outside.js",
      plugins: [{ name: "escaped-entry", description: "Escaped entry fixture." }],
    }));
    await assert.rejects(
      () => installer.install_plugins(plugin_source),
      /entry must stay inside the installation directory/,
    );

    fs.symlinkSync("index.js", path.join(plugin_source, "linked-entry.js"));
    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 3,
      entry: "linked-entry.js",
      plugins: [{ name: "linked-entry", description: "Linked entry fixture." }],
    }));
    await assert.rejects(
      () => installer.install_plugins(plugin_source),
      /artifact cannot contain symlinks/,
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(plugin_source, { recursive: true, force: true });
  }
});

test("Plugin constructor 静态 Manifest 必须与安装快照一致", async () => {
  const platform_root = create_temp_root();
  const plugin_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    fs.writeFileSync(path.join(plugin_source, "downcity.plugin.json"), JSON.stringify({
      manifest_version: 3,
      entry: "index.js",
      plugins: [{ name: "declared", description: "Static Manifest mismatch fixture." }],
    }));
    fs.writeFileSync(path.join(plugin_source, "index.js"), `
class UnexpectedPlugin {
  static manifest = { name: "unexpected", description: "Static Manifest mismatch fixture." };
  constructor() { this.name = "unexpected"; this.actions = {}; }
}
export const plugins = [UnexpectedPlugin];
`);
    const installer = await import("../bin/city/process/plugin/PluginInstaller.js");
    const loader = await import("../bin/city/runtime/plugins/PluginTypeLoader.js");
    await installer.install_plugins(plugin_source);
    await assert.rejects(
      () => loader.load_plugin_types("declared"),
      /static manifests do not match installed snapshot/,
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(plugin_source, { recursive: true, force: true });
  }
});

test("CLI 生命周期只属于 City，Agent 不注册生命周期命令", () => {
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
  assert.doesNotMatch(root_help.stdout, /^\s+(init|update|config|chat|task|memory|skill|contact)\b/m);
  assert.match(root_help.stdout, /^\s+on\b/m);
  assert.match(root_help.stdout, /^\s+off\b/m);
  assert.match(root_help.stdout, /^\s+restart\b/m);
  assert.match(root_help.stdout, /^\s+status\b/m);
  assert.doesNotMatch(root_help.stdout, /^\s+web\b/m);
  assert.match(agent_help.stdout, /^\s+chat\b/m);
  assert.doesNotMatch(agent_help.stdout, /^\s+(start|stop|restart|status|doctor|history)\b/m);
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
    const workspaces = await import(
      "../bin/city/process/registry/WorkspaceRepository.js"
    );
    const workspace = workspaces.create_workspace({ workspace_path: workspace_root });
    repository.create_managed_agent({
      agent_id: "workspace_agent",
      workspace_id: workspace.workspace_id,
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
      [cli_path, "agent", "token", "list"],
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
      [cli_path, "agent", "token", "list", "workspace_agent"],
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
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const { load_plugin_type } = await import(
      "../bin/city/runtime/plugins/PluginTypeLoader.js"
    );
    const chat_type = await load_plugin_type("chat");
    const chat = new chat_type({
      config: { queue: { max_concurrency: 5 } },
      resources: [{
        id: "telegram-bound",
        type: "telegram",
        name: "Bound Bot",
        bot_token: "token",
      }],
    });
    assert.ok(chat);
    assert.equal(chat.getResourceId({}, "telegram"), "telegram-bound");
    assert.equal(chat.isChannelEnabled({}, "telegram"), true);
    assert.equal(chat.isChannelEnabled({}, "feishu"), false);
    assert.deepEqual(chat.getQueueWorkerConfig({}), { max_concurrency: 5 });

    const unbound = new chat_type({ config: {}, resources: [] });
    assert.equal(unbound.isChannelEnabled({}, "telegram"), false);
    assert.equal(unbound.getResourceId({}, "telegram"), "");
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Plugin Resource Resolver 写入动态字段并通过 ID 绑定", async () => {
  const platform_root = create_temp_root();
  const workspace_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  const original_fetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      result: {
        id: 778899,
        username: "downcity_bot",
        first_name: "Downcity",
        last_name: "Assistant",
      },
    }), { status: 200 });
    const agents = await import("../bin/city/process/registry/ManagedAgentRepository.js");
    const workspaces = await import("../bin/city/process/registry/WorkspaceRepository.js");
    const resource_service = await import(
      "../bin/city/process/plugin/PluginResourceService.js"
    );
    const plugins_repository = await import(
      "../bin/city/process/registry/PluginRepository.js"
    );
    const workspace = workspaces.create_workspace({ workspace_path: workspace_root });
    agents.create_managed_agent({
      agent_id: "resource_agent",
      workspace_id: workspace.workspace_id,
    });
    const resource = await resource_service.create_plugin_resource({
      plugin_name: "chat",
      fields: { type: "telegram", bot_token: "token" },
    });
    assert.equal(resource.item.name, "Downcity Assistant");
    assert.equal(resource.item.username, "@downcity_bot");
    assert.equal(resource.item.bot_user_id, "778899");
    const schema_tools = await import(
      "../bin/city/process/plugin/PluginResourceSchema.js"
    );
    const chat_catalog = (await import(
      "../bin/city/process/plugin/PluginCatalog.js"
    )).get_plugin_catalog_item("chat");
    const safe_item = schema_tools.redact_plugin_schema_value(
      resource.item,
      chat_catalog.resource_schema,
    );
    assert.equal(safe_item.bot_token, "[REDACTED]");
    assert.equal(safe_item.name, "Downcity Assistant");
    const binding = plugins_repository.set_agent_plugin_binding({
      agent_id: "resource_agent",
      plugin_name: "chat",
      enabled: true,
      config: { queue: { max_concurrency: 3 } },
      resource_ids: [resource.resource_id],
    });
    const resolved = resource_service.resolve_plugin_binding_resources(
      binding,
      (await import("@downcity/plugins/chat")).CHAT_PLUGIN_RESOURCE_JSON_SCHEMA,
    );
    assert.equal(Object.isFrozen(resolved), true);
    assert.equal(Object.isFrozen(resolved[0]), true);

    const { load_plugin_type } = await import(
      "../bin/city/runtime/plugins/PluginTypeLoader.js"
    );
    const chat_type = await load_plugin_type("chat");
    const chat = new chat_type({
      config: binding.config,
      resources: resolved,
    });
    assert.equal(chat.getResourceId({}, "telegram"), resource.resource_id);
    assert.equal(chat.resolveChannelAccount({}, "telegram")?.name, "Downcity Assistant");
    assert.equal(chat.resolveChannelAccount({}, "telegram")?.bot_token, "token");
  } finally {
    globalThis.fetch = original_fetch;
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(workspace_root, { recursive: true, force: true });
  }
});

test("旧 Chat Account 与 Binding 原子迁移为 Plugin Resource", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  process.env.DC_MODEL_DB_KEY = "plugin-resource-migration-test";
  let reset_key_cache = () => {};
  try {
    const crypto = await import("../bin/city/runtime/store/crypto.js");
    reset_key_cache = crypto.resetModelDbKeyCache;
    reset_key_cache();
    const database_path = path.join(platform_root, "downcity.db");
    const database = new Database(database_path);
    database.exec(`
      CREATE TABLE channel_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        channel TEXT NOT NULL,
        name TEXT NOT NULL,
        identity TEXT,
        bot_token_encrypted TEXT,
        app_id_encrypted TEXT,
        app_secret_encrypted TEXT,
        domain TEXT,
        sandbox INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_plugins (
        agent_id TEXT NOT NULL,
        plugin_name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        config_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, plugin_name)
      );
    `);
    database.prepare(`
      INSERT INTO channel_accounts (
        id, channel, name, identity, bot_token_encrypted,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);
    `).run(
      "telegram-legacy",
      "telegram",
      "Legacy Bot",
      "@legacy_bot",
      crypto.encryptTextSync("legacy-token"),
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    database.prepare(`
      INSERT INTO agent_plugins (
        agent_id, plugin_name, enabled, config_encrypted, created_at, updated_at
      ) VALUES (?, 'chat', 1, ?, ?, ?);
    `).run(
      "legacy-agent",
      crypto.encryptTextSync(JSON.stringify({
        queue: { maxConcurrency: 3 },
        channels: {
          telegram: {
            enabled: true,
            channelAccountId: "telegram-legacy",
          },
        },
      })),
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    database.close();

    const { LocalCityStore } = await import("@downcity/city");
    const store = new LocalCityStore({ root_path: platform_root });
    store.close();
    const reopened_store = new LocalCityStore({ root_path: platform_root });
    reopened_store.close();

    const migrated = new Database(database_path);
    const resource_row = migrated.prepare(`
      SELECT resource_id, item_encrypted FROM plugin_resources
      WHERE plugin_name = 'chat';
    `).get();
    const binding_row = migrated.prepare(`
      SELECT config_encrypted, resource_ids_json FROM agent_plugins
      WHERE agent_id = 'legacy-agent' AND plugin_name = 'chat';
    `).get();
    const legacy_table = migrated.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'channel_accounts';
    `).get();
    migrated.close();
    assert.equal(resource_row.resource_id, "telegram-legacy");
    assert.deepEqual(JSON.parse(crypto.decryptTextSync(resource_row.item_encrypted)), {
      id: "telegram-legacy",
      type: "telegram",
      name: "Legacy Bot",
      bot_token: "legacy-token",
      username: "@legacy_bot",
    });
    assert.deepEqual(JSON.parse(binding_row.resource_ids_json), ["telegram-legacy"]);
    assert.deepEqual(JSON.parse(crypto.decryptTextSync(binding_row.config_encrypted)), {
      queue: { max_concurrency: 3 },
    });
    assert.equal(legacy_table, undefined);
  } finally {
    reset_key_cache();
    delete process.env.DC_PLATFORM_ROOT;
    delete process.env.DC_MODEL_DB_KEY;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});
