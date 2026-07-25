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
      plugins: { chat: { queue: { maxConcurrency: 3 } } },
    });
    const config = repository.get_managed_agent("db_agent");
    assert.equal(config.agent_id, "db_agent");
    assert.equal(config.execution.model_id, "model_a");
    assert.equal(config.plugins.chat.queue.maxConcurrency, 3);
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
    const auth_service = new AuthService();
    const app = new Hono();
    app.use("*", createRouteAuthGuardMiddleware(
      auth_service,
      SERVER_AUTH_ROUTE_POLICIES,
    ));
    app.get("/health", (context) => context.json({ status: "ok" }));
    app.get("/private", (context) => context.json({ status: "ok" }));

    assert.equal((await app.request("/health")).status, 200);
    assert.equal((await app.request("/private")).status, 401);

    const issued = auth_service.ensureLocalCliAccess({ token_name: "test" });
    const authenticated = await app.request("/private", {
      headers: { authorization: `Bearer ${issued.token.token}` },
    });
    assert.equal(authenticated.status, 200);
    auth_service.close();
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
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
