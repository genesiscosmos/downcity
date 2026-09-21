/** CLI 文件型 Agent/Power 配置与本地控制面行为测试。 */

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

function write_power_source(root, input = {}) {
  const id = input.id ?? "example";
  const version = input.version ?? "1.0.0";
  const description = input.description ?? "Example Power for configuration tests.";
  const main = input.main === null ? undefined : input.main ?? "dist/main.js";
  const renderer_input = input.renderer === null ? undefined : input.renderer ?? "dist/mainview.js";
  const renderer = typeof renderer_input === "string"
    ? { entry: renderer_input, sidebar: true, mainview: true, config: true }
    : renderer_input;
  const readme_path = input.readme_path === null ? undefined : input.readme_path ?? "README.md";
  fs.writeFileSync(
    path.join(root, "package.json"),
    input.package_source ?? JSON.stringify({ type: "module" }),
  );
  if (readme_path && input.write_readme !== false) {
    const readme_file_path = path.join(root, readme_path);
    fs.mkdirSync(path.dirname(readme_file_path), { recursive: true });
    fs.writeFileSync(
      readme_file_path,
      input.readme ?? "# Example Power\n\nConfiguration and usage.\n",
    );
  }
  fs.writeFileSync(path.join(root, "power.json"), JSON.stringify({
    schema_version: 1,
    id,
    version,
    description,
    ...(readme_path ? { readme: readme_path } : {}),
    ...(main ? { main } : {}),
    ...(renderer ? { renderer } : {}),
    ...(input.extra_manifest ?? {}),
  }));
  if (main) {
    const main_path = path.join(root, main);
    fs.mkdirSync(path.dirname(main_path), { recursive: true });
    fs.writeFileSync(main_path, input.main_source ?? `
export default {
  name: ${JSON.stringify(input.runtime_id ?? id)},
  title: "Example",
  description: "Example Power",
  actions: {},
  initialize(context) {
    context.power.config_action({ id: "config.read", run: async (_input, action_context) => action_context.config.get() });
  },
};
`);
  }
  if (renderer) {
    const renderer_path = path.join(root, renderer.entry);
    fs.mkdirSync(path.dirname(renderer_path), { recursive: true });
    fs.writeFileSync(renderer_path, input.renderer_source ?? "export default { sidebar: function ExampleSidebar() { return null; }, mainview: function ExampleMainview() { return null; }, config: function ExampleConfig() { return null; } };\n");
  }
  if (input.source_config) {
    fs.writeFileSync(path.join(root, "config.toml"), input.source_config);
  }
}

test("City reset 只删除 SQLite 数据库文件", async () => {
  const platform_root = create_temp_root();
  const database_path = path.join(platform_root, "downcity.db");
  const preserved_files = [
    path.join(platform_root, ".env"),
    path.join(platform_root, "agents", "keep", "agent.json"),
    path.join(platform_root, "powers", "keep.txt"),
  ];
  try {
    fs.mkdirSync(path.join(platform_root, "agents", "keep"), { recursive: true });
    fs.mkdirSync(path.join(platform_root, "powers"), { recursive: true });
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
    const powers = await import("../bin/city/process/registry/PowerRepository.js");
    const workspace = workspaces.create_workspace({ workspace_path: project_root, name: "Project" });
    agents.create_agent_config({
      agent_id: "file_agent",
      execution: { type: "api", model_id: "model_a" },
      instruction: "You are File Agent.",
    });
    await powers.save_power_config("chat", { channels: [] });
    assert.equal(workspaces.get_workspace(workspace.workspace_id).workspace_path, project_root);

    const agent_dir = path.join(platform_root, "agents", "file_agent");
    const agent_file = JSON.parse(fs.readFileSync(path.join(agent_dir, "agent.json"), "utf8"));
    assert.equal(agent_file.schema_version, 2);
    assert.equal("powers" in agent_file, false);
    assert.equal(fs.readFileSync(path.join(agent_dir, "SOUL.md"), "utf8"), "You are File Agent.");
    assert.match(
      fs.readFileSync(path.join(platform_root, "powers", "chat", "config.toml"), "utf8"),
      /\[config\]/u,
    );

    const database = new Database(path.join(platform_root, "downcity.db"));
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table';")
      .all().map((row) => row.name);
    database.close();
    assert.equal(tables.includes("managed_agents"), false);
    assert.equal(tables.includes("agent_powers"), false);
    assert.equal(tables.includes("power_resources"), false);
    assert.equal(tables.includes("power_installations"), false);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(project_root, { recursive: true, force: true });
  }
});

test("Embassy 只接受新的 Federation 身份环境变量", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
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

test("第三方 Power 使用 definition ID 目录和统一入口协议", async () => {
  const platform_root = create_temp_root();
  const power_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_power_source(power_source);
    fs.mkdirSync(path.join(power_source, "src"), { recursive: true });
    fs.writeFileSync(path.join(power_source, "src", "index.ts"), "export {};\n");
    fs.writeFileSync(path.join(power_source, "tsconfig.json"), "{}\n");
    fs.writeFileSync(path.join(power_source, "tsup.config.ts"), "export default {};\n");
    const powers = await import("../bin/city/process/registry/PowerRepository.js");
    const installer = await import("../bin/city/process/power/PowerInstaller.js");
    const local_data = await import("../bin/city/runtime/LocalData.js");
    const assembly = await import("../bin/city/runtime/AgentAssembly.js");

    const installed = await installer.install_power(power_source);
    assert.equal(installed.id, "example");
    assert.equal(installed.main, "dist/main.js");
    assert.deepEqual(installed.renderer, { entry: "dist/mainview.js", sidebar: true, mainview: true, config: true });
    assert.equal(installed.readme, "README.md");
    assert.match(installed.integrity, /^sha256-[a-f0-9]{64}$/u);
    const power_dir = path.join(platform_root, "powers", "example");
    assert.equal(fs.existsSync(path.join(power_dir, "power.json")), true);
    assert.equal(fs.existsSync(path.join(power_dir, "dist", "main.js")), true);
    assert.equal(fs.existsSync(path.join(power_dir, "dist", "mainview.js")), true);
    assert.equal(fs.existsSync(path.join(power_dir, "artifact")), false);
    assert.equal(fs.existsSync(path.join(power_dir, "src")), false);
    assert.equal(fs.existsSync(path.join(power_dir, "package.json")), true);
    assert.equal(fs.existsSync(path.join(power_dir, "README.md")), true);
    assert.equal(fs.existsSync(path.join(power_dir, "tsconfig.json")), false);
    assert.equal(fs.existsSync(path.join(power_dir, "tsup.config.ts")), false);

    await powers.save_power_config("example", {
      endpoint: "https://example.com",
      api_key: "plain-secret",
      timeout_ms: 10000,
    });
    assert.match(fs.readFileSync(path.join(power_dir, "config.toml"), "utf8"), /plain-secret/u);

    const data = local_data.create_cli_local_data();
    try {
      const loader = assembly.create_cli_power_loader({ power_repository: data.powers });
      const registration = await loader.load_power_registration("example");
      assert.equal(registration.power.name, "example");
      fs.appendFileSync(path.join(power_dir, "dist", "main.js"), "\n// tampered\n");
      const catalog = await import("../bin/city/process/power/PowerCatalog.js");
      await assert.rejects(
        () => catalog.resolve_power_catalog_item("example"),
        /integrity check failed/u,
      );
      await assert.rejects(
        () => loader.load_power_registration("example"),
        /integrity check failed/u,
      );
    } finally {
      data.database.close();
    }

    write_power_source(power_source, {
      version: "1.1.0",
      source_config: "schema_version = 2\n[config]\nendpoint = \"overwritten\"\n",
    });
    const updated = await installer.update_power("example");
    assert.equal(updated.version, "1.1.0");
    assert.match(fs.readFileSync(path.join(power_dir, "config.toml"), "utf8"), /plain-secret/u);
    powers.remove_installed_power("example");
    assert.equal(fs.existsSync(power_dir), false);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(power_source, { recursive: true, force: true });
  }
});

test("Power 在 City 级只有一个实例和一份配置", async () => {
  const platform_root = create_temp_root();
  const power_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_power_source(power_source);
    const agents = await import("../bin/city/process/registry/AgentConfigRepository.js");
    const powers = await import("../bin/city/process/registry/PowerRepository.js");
    const installer = await import("../bin/city/process/power/PowerInstaller.js");
    const local_data = await import("../bin/city/runtime/LocalData.js");
    const assembly = await import("../bin/city/runtime/AgentAssembly.js");
    agents.create_agent_config({ agent_id: "agent_one" });
    agents.create_agent_config({ agent_id: "agent_two" });
    await installer.install_power(power_source);
    await powers.save_power_config("example", {
      endpoint: "https://example.com",
      timeout_ms: 10000,
    });

    const data = local_data.create_cli_local_data();
    try {
      const loader = assembly.create_cli_power_loader({ power_repository: data.powers });
      const registrations = await loader.list_registrations();
      assert.equal(registrations.filter((item) => item.power.name === "example").length, 1);
      assert.deepEqual(data.powers.get_config("example"), {
        endpoint: "https://example.com",
        timeout_ms: 10000,
      });
    } finally {
      data.database.close();
    }

    for (const agent_id of ["agent_one", "agent_two"]) {
      const agent = JSON.parse(fs.readFileSync(path.join(platform_root, "agents", agent_id, "agent.json"), "utf8"));
      assert.equal("powers" in agent, false);
    }
    assert.match(
      fs.readFileSync(path.join(platform_root, "powers", "example", "config.toml"), "utf8"),
      /\[config\]/u,
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(power_source, { recursive: true, force: true });
  }
});

test("第三方 Power 安装本地 icon 并保留远程 icon 地址", async () => {
  const platform_root = create_temp_root();
  const local_source = create_temp_root();
  const remote_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_power_source(local_source, {
      id: "local-icon",
      extra_manifest: { icon: "assets/icon.svg" },
    });
    fs.mkdirSync(path.join(local_source, "assets"), { recursive: true });
    fs.writeFileSync(path.join(local_source, "assets", "icon.svg"), "<svg></svg>\n");
    const installer = await import("../bin/city/process/power/PowerInstaller.js");
    const local_installed = await installer.install_power(local_source);
    const local_dir = path.join(platform_root, "powers", "local-icon");
    assert.equal(local_installed.icon, "assets/icon.svg");
    assert.equal(fs.existsSync(path.join(local_dir, "assets", "icon.svg")), true);

    write_power_source(remote_source, {
      id: "remote-icon",
      extra_manifest: { icon: "https://example.com/icon.svg" },
    });
    const remote_installed = await installer.install_power(remote_source);
    assert.equal(remote_installed.icon, "https://example.com/icon.svg");
    assert.equal(fs.existsSync(path.join(platform_root, "powers", "remote-icon", "icon.svg")), false);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(local_source, { recursive: true, force: true });
    fs.rmSync(remote_source, { recursive: true, force: true });
  }
});

test("第三方 Power 必须声明并提供 Markdown README", async () => {
  const platform_root = create_temp_root();
  const power_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const installer = await import("../bin/city/process/power/PowerInstaller.js");

    write_power_source(power_source, { readme_path: null });
    await assert.rejects(() => installer.install_power(power_source), /readme is required/u);

    write_power_source(power_source, { write_readme: false });
    await assert.rejects(() => installer.install_power(power_source), /README not found/u);

    write_power_source(power_source, { readme_path: "../README.md", write_readme: false });
    await assert.rejects(
      () => installer.install_power(power_source),
      /README must stay inside the Power directory/u,
    );

    write_power_source(power_source, { readme_path: "/README.md", write_readme: false });
    await assert.rejects(() => installer.install_power(power_source), /readme must be relative/u);

    write_power_source(power_source, { readme_path: "docs/guide.txt" });
    await assert.rejects(() => installer.install_power(power_source), /readme must use .md/u);

    write_power_source(power_source, {
      readme_path: "docs/power-guide.md",
      readme: "# Nested Guide\n",
    });
    const installed = await installer.install_power(power_source);
    assert.equal(installed.readme, "docs/power-guide.md");
    assert.equal(
      fs.readFileSync(
        path.join(platform_root, "powers", "example", "docs", "power-guide.md"),
        "utf8",
      ),
      "# Nested Guide\n",
    );
    fs.appendFileSync(
      path.join(platform_root, "powers", "example", "docs", "power-guide.md"),
      "\nTampered.\n",
    );
    const catalog = await import("../bin/city/process/power/PowerCatalog.js");
    await assert.rejects(
      () => catalog.resolve_power_catalog_item("example"),
      /integrity check failed/u,
    );
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(power_source, { recursive: true, force: true });
  }
});

test("Power 安装拒绝内置 ID、非法清单与逃逸入口", async () => {
  const platform_root = create_temp_root();
  const power_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const installer = await import("../bin/city/process/power/PowerInstaller.js");
    write_power_source(power_source, { id: "chat" });
    await assert.rejects(() => installer.install_power(power_source), /conflicts with builtin/u);

    write_power_source(power_source, { extra_manifest: { actions: [] } });
    await assert.rejects(() => installer.install_power(power_source), /unknown field: actions/u);

    write_power_source(power_source, {
      extra_manifest: { config: { schema: { type: "invalid" } } },
    });
    await assert.rejects(() => installer.install_power(power_source), /unknown field: config/u);

    write_power_source(power_source, { main: "../outside.js" });
    await assert.rejects(() => installer.install_power(power_source), /stay inside the Power directory/u);

    write_power_source(power_source, { main: "dist/main.ts" });
    await assert.rejects(() => installer.install_power(power_source), /main must use .js or .mjs/u);

    write_power_source(power_source, { renderer: "dist/mainview.html" });
    await assert.rejects(() => installer.install_power(power_source), /renderer\.entry must use .js or .mjs/u);

    write_power_source(power_source, { main: null, renderer: null });
    await assert.rejects(() => installer.install_power(power_source), /must provide main or renderer/u);

    write_power_source(power_source);
    fs.rmSync(path.join(power_source, "package.json"));
    await assert.rejects(() => installer.install_power(power_source), /package not found/u);

    write_power_source(power_source, { package_source: JSON.stringify({ type: "commonjs" }) });
    await assert.rejects(() => installer.install_power(power_source), /must declare "type": "module"/u);

    write_power_source(power_source);
    fs.renameSync(
      path.join(power_source, "dist", "main.js"),
      path.join(power_source, "dist", "real.js"),
    );
    fs.symlinkSync("real.js", path.join(power_source, "dist", "main.js"));
    await assert.rejects(() => installer.install_power(power_source), /main cannot use symlinks/u);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(power_source, { recursive: true, force: true });
  }
});

test("Power 安装不执行入口，City 加载注册时才执行 main", async () => {
  const platform_root = create_temp_root();
  const power_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_power_source(power_source, {
      main_source: 'throw new Error("main executed");',
      renderer_source: 'throw new Error("renderer executed");',
    });
    const installer = await import("../bin/city/process/power/PowerInstaller.js");
    const local_data = await import("../bin/city/runtime/LocalData.js");
    const assembly = await import("../bin/city/runtime/AgentAssembly.js");
    await assert.doesNotReject(() => installer.install_power(power_source));
    const data = local_data.create_cli_local_data();
    try {
      const loader = assembly.create_cli_power_loader({ power_repository: data.powers });
      await assert.rejects(
        () => loader.load_power_registration("example"),
        /main executed/u,
      );
    } finally {
      data.database.close();
    }
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(power_source, { recursive: true, force: true });
  }
});

test("保存 Power 配置不执行任何入口", async () => {
  const platform_root = create_temp_root();
  const power_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_power_source(power_source, {
      main_source: 'throw new Error("main must not run while saving config");',
      renderer_source: 'throw new Error("renderer must not run while saving config");',
    });
    const installer = await import("../bin/city/process/power/PowerInstaller.js");
    const powers = await import("../bin/city/process/registry/PowerRepository.js");
    await installer.install_power(power_source);
    await assert.doesNotReject(() => powers.save_power_config("example", {}));
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(power_source, { recursive: true, force: true });
  }
});

test("Power 实例 ID 必须匹配 power.json", async () => {
  const platform_root = create_temp_root();
  const power_source = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    write_power_source(power_source, { id: "declared", runtime_id: "unexpected" });
    const installer = await import("../bin/city/process/power/PowerInstaller.js");
    const local_data = await import("../bin/city/runtime/LocalData.js");
    const assembly = await import("../bin/city/runtime/AgentAssembly.js");
    await installer.install_power(power_source);
    const data = local_data.create_cli_local_data();
    try {
      const loader = assembly.create_cli_power_loader({ power_repository: data.powers });
      await assert.rejects(
        () => loader.load_power_registration("declared"),
        /Power ID does not match its instance/u,
      );
    } finally {
      data.database.close();
    }
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(power_source, { recursive: true, force: true });
  }
});

test("内建 Power Catalog 暴露统一运行与 Renderer 能力", async () => {
  const platform_root = create_temp_root();
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const catalog = await import("../bin/city/process/power/PowerCatalog.js");
    const chat = await catalog.resolve_power_catalog_item("chat");
    assert.equal(chat.power_id, "chat");
    assert.equal(chat.source, "builtin");
    assert.equal(chat.has_main, true);
    // Chat 现在自己提供 Mainview（Channel 管理界面），配置改由 Mainview 承担。
    // 这两个值随 BuiltinPowerTypes 的注册表变化，断言必须与那份注册表一致。
    assert.equal(chat.has_config, false);
    assert.equal(chat.has_mainview, true);
    const memory = await catalog.resolve_power_catalog_item("memory");
    assert.equal(memory.has_main, true);
    assert.equal(memory.has_config, false);
    // Memory 现在自带 Mainview（浏览、详情与写入），与 BuiltinPowerTypes 一致。
    assert.equal(memory.has_sidebar, true);
    assert.equal(memory.has_mainview, true);
    const web = await catalog.resolve_power_catalog_item("web");
    assert.equal(web.has_main, true);
    assert.equal(web.has_config, true);
    // Web 的 Mainview 是只读状态页，同时保留独立 Config。
    assert.equal(web.has_sidebar, true);
    assert.equal(web.has_mainview, true);
    const skill = await catalog.resolve_power_catalog_item("skill");
    assert.equal(skill.has_main, true);
    assert.equal(skill.has_config, false);
    assert.equal(skill.has_sidebar, true);
    assert.equal(skill.has_mainview, true);
    const result = spawnSync(process.execPath, [path.resolve("bin/downcity.js"), "power", "list"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    // 断言稳定的 power_id，而不是展示名：`power list` 输出的是 Power 的 title
    //（chat 的 title 是 "Channels"），title 属于可调整的展示文案。
    assert.match(result.stdout, /\(chat\)/u);
  } finally {
    delete process.env.DC_PLATFORM_ROOT;
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

/*
 * 已删除："内建 Chat Power 使用 City 持有的唯一 TOML 配置"。
 *
 * 它断言的是 `registration.power.get_channel_id / getQueueWorkerConfig /
 * resolveChannelAccount`——这三个方法全仓已不存在（Power 改为通过 City 持有的配置与
 * Mainview 装配，不再由 Power 实例暴露 channel 读取方法）。
 * 该能力现由 `@downcity/powers` 自己的 `scripts/chat-channel-config.test.mjs`
 *（`pnpm -C packages/implementations/powers test:chat-config`）覆盖，因此不再在这里重复。
 */

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
