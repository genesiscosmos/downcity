/**
 * Federation CLI 项目配置、registry 与 Local deploy 生命周期测试。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parse_toml, stringify as stringify_toml } from "smol-toml";

/** 创建隔离临时目录。 */
function create_temp_dir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 将模板文件写入测试项目。 */
function write_template_files(project_dir, files) {
  for (const file of files) {
    const file_path = path.join(project_dir, file.path);
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, file.content);
  }
}

/** 判断 PID 当前是否存活。 */
function is_process_alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 生成可由 release builder 编译的最小项目；不通过 shell 启动源码。 */
function write_local_release_fixture(project_dir, config) {
  fs.writeFileSync(path.join(project_dir, "federation.toml"), stringify_toml(config));
  fs.writeFileSync(path.join(project_dir, "package.json"), JSON.stringify({
    name: "federation-lifecycle-fixture",
    version: "1.0.0",
    type: "module",
    files: ["assets"],
  }));
  fs.mkdirSync(path.join(project_dir, "assets"));
  fs.writeFileSync(path.join(project_dir, "assets/message.txt"), "installed resource");
  fs.writeFileSync(path.join(project_dir, ".env"), "TEST_RUNTIME_VALUE=isolated\n");
  fs.writeFileSync(path.join(project_dir, config.entry), `
import http from "node:http";
const port: number = Number(process.env.PORT);
http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      fed_id: process.env.DOWNCITY_FED_ID,
      release_id: process.env.DOWNCITY_RELEASE_ID,
      instance_id: process.env.DOWNCITY_FED_INSTANCE_ID,
    }));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(port, process.env.HOST);
`);
}

/** 健康检查必须同时确认业务成功与当前受管实例的三个身份字段。 */
async function assert_release_health(server) {
  const response = await fetch(`${server.base_url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    fed_id: server.fed_id,
    release_id: server.release_id,
    instance_id: server.instance_id,
  });
}

test("City 登录无需来源或产品注册参数", () => {
  const cli_path = fileURLToPath(new URL("../bin/downcity.js", import.meta.url));
  const platform_root = create_temp_dir("downcity-city-login-help-");
  try {
    const output = execFileSync(
      process.execPath,
      [cli_path, "--lang", "en", "federation", "login", "--help"],
      { encoding: "utf8", env: { ...process.env, DC_PLATFORM_ROOT: platform_root } },
    );
    assert.doesNotMatch(output, /--bureau-id/u);
    assert.doesNotMatch(output, /--city-id/u);
  } finally {
    fs.rmSync(platform_root, { recursive: true, force: true });
  }
});

test("Federation 管理命令不提供机器注册或凭据入口", () => {
  const cli_path = fileURLToPath(new URL("../bin/downfed.js", import.meta.url));
  const output = execFileSync(process.execPath, [cli_path, "--lang", "en", "--help"], { encoding: "utf8" });
  assert.doesNotMatch(output, /^\s+bureau\b/mu);
});

test("内置模板生成严格的新 Federation 配置", async () => {
  const project_dir = create_temp_dir("downcity-fed-template-");
  try {
    const template = await import("../bin/federation/create/templates/LocalNodeTemplate.js");
    const reader = await import("../bin/federation/deploy/config/FederationProjectConfigReader.js");
    write_template_files(project_dir, template.create_local_node_template_files({
      fed_id: "fed_template_test",
      name: "template-test",
    }));

    const config_file = reader.read_federation_project_config(project_dir);
    assert.equal(config_file.config.type, "federation");
    assert.equal(config_file.config.id, "fed_template_test");
    assert.equal(config_file.config.deployment.target, "local");
    assert.equal(config_file.config.deployment.port, 12314);
    assert.equal(path.basename(config_file.config_path), "federation.toml");
    assert.deepEqual(config_file.config.deployment.resources, {});
    assert.equal(fs.existsSync(path.join(project_dir, "src/index.ts")), true);
    assert.equal(config_file.config.deployment.scripts?.deploy, undefined);
    assert.equal(fs.existsSync(path.join(project_dir, "package.json")), true);
  } finally {
    fs.rmSync(project_dir, { recursive: true, force: true });
  }
});

test("Cloudflare 模板通过统一 deployment 配置生成 Wrangler binding", async () => {
  const project_dir = create_temp_dir("downcity-fed-cloudflare-");
  try {
    const template = await import("../bin/federation/create/templates/CloudflareWorkersTemplate.js");
    const reader = await import("../bin/federation/deploy/config/FederationProjectConfigReader.js");
    const writer = await import("../bin/federation/deploy/runtime/WranglerConfigWriter.js");
    write_template_files(project_dir, template.create_cloudflare_workers_template_files({
      fed_id: "fed_cloudflare_test",
      name: "cloudflare-test",
    }));

    const config_path = path.join(project_dir, "federation.toml");
    const raw_config = parse_toml(fs.readFileSync(config_path, "utf8"));
    raw_config.deployment.crons = ["  */5   * * * *  "];
    fs.writeFileSync(config_path, stringify_toml(raw_config));
    const config_file = reader.read_federation_project_config(project_dir);
    assert.equal(config_file.config.deployment.target, "cloudflare-workers");
    assert.deepEqual(config_file.config.deployment.crons, ["*/5 * * * *"]);
    assert.equal(config_file.config.deployment.resources.d1.name, "cloudflare-test-db");
    assert.equal(config_file.config.deployment.resources.queue.name, "cloudflare-test-queue");
    assert.equal(config_file.config.deployment.resources.storage.name, "cloudflare-test-storage");

    const result = writer.writeWranglerConfig(
      config_file,
      "00000000-0000-0000-0000-000000000001",
    );
    const wrangler = fs.readFileSync(result.config_path, "utf8");
    assert.match(wrangler, /binding = "DB"/u);
    assert.match(wrangler, /database_name = "cloudflare-test-db"/u);
    assert.match(wrangler, /queue = "cloudflare-test-queue"/u);
    assert.match(wrangler, /bucket_name = "cloudflare-test-storage"/u);
    assert.ok(wrangler.includes('[triggers]\ncrons = ["*/5 * * * *"]'));
    assert.doesNotMatch(wrangler, /DOWNCITY_FEDERATION_ADMIN_/u);
    fs.rmSync(path.dirname(result.config_path), { recursive: true, force: true });
  } finally {
    fs.rmSync(project_dir, { recursive: true, force: true });
  }
});

test("Cloudflare 管理员恢复通过 Wrangler 直接写入 D1 SQL", async () => {
  const project_dir = create_temp_dir("downcity-fed-admin-d1-");
  const bin_dir = path.join(project_dir, "bin");
  const captured_sql = path.join(project_dir, "captured.sql");
  const captured_args = path.join(project_dir, "captured-args.json");
  fs.mkdirSync(bin_dir, { recursive: true });
  fs.writeFileSync(path.join(project_dir, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(bin_dir, "pnpm"), `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
const command = args[args.indexOf("--command") + 1];
fs.writeFileSync(process.env.DOWNCITY_TEST_ADMIN_SQL, command);
fs.writeFileSync(process.env.DOWNCITY_TEST_ADMIN_ARGS, JSON.stringify(args));
process.stdout.write(JSON.stringify([{ results: [{ admin_id: process.env.DOWNCITY_TEST_ADMIN_ID, provision_id: process.env.DOWNCITY_TEST_PROVISION_ID }] }]));
`);
  fs.chmodSync(path.join(bin_dir, "pnpm"), 0o755);
  const previous_path = process.env.PATH;
  process.env.PATH = `${bin_dir}:${previous_path}`;
  process.env.DOWNCITY_TEST_ADMIN_SQL = captured_sql;
  process.env.DOWNCITY_TEST_ADMIN_ARGS = captured_args;
  process.env.DOWNCITY_TEST_ADMIN_ID = "admin_recovered";
  process.env.DOWNCITY_TEST_PROVISION_ID = "fap_cloudflare_reset";
  try {
    const provisioner = await import("../bin/federation/deploy/runtime/AdminDatabaseProvisioner.js");
    const result = await provisioner.provision_cloudflare_admin_database({
      project_dir,
      account_id: "account-test",
      wrangler_config_path: "/tmp/generated-wrangler.toml",
      database_binding: "DB",
      database_id: "00000000-0000-0000-0000-000000000001",
      credentials: {
        mode: "reset",
        provision_id: "fap_cloudflare_reset",
        admin_id: "admin_recovered",
        password_hash: "pbkdf2_sha256$210000$salt$digest",
        password: "fed_secret_should_not_enter_sql",
      },
    });
    assert.deepEqual(result, { admin_id: "admin_recovered", credentials_applied: true });
    const args = JSON.parse(fs.readFileSync(captured_args, "utf8"));
    assert.equal(args[4], "DB");
    assert.equal(args[args.indexOf("--config") + 1], "/tmp/generated-wrangler.toml");
    assert.equal(args.includes("00000000-0000-0000-0000-000000000001"), false);
    assert.equal(args.includes("downcity-db"), false);
    const sql = fs.readFileSync(captured_sql, "utf8");
    assert.match(sql, /UPDATE federation_admin_sessions SET status = 'revoked'/u);
    assert.match(sql, /pbkdf2_sha256\$210000\$salt\$digest/u);
    assert.doesNotMatch(sql, /fed_secret_should_not_enter_sql/u);
  } finally {
    process.env.PATH = previous_path;
    delete process.env.DOWNCITY_TEST_ADMIN_SQL;
    delete process.env.DOWNCITY_TEST_ADMIN_ARGS;
    delete process.env.DOWNCITY_TEST_ADMIN_ID;
    delete process.env.DOWNCITY_TEST_PROVISION_ID;
    fs.rmSync(project_dir, { recursive: true, force: true });
  }
});

test("Local 管理员写入独立 runtime 数据库并支持显式恢复", async () => {
  const platform_root = create_temp_dir("downcity-fed-admin-state-");
  const project_dir = create_temp_dir("downcity-fed-admin-project-");
  try {
    const runtime = await import("../bin/federation/deploy/release/LocalRuntimeConfig.js");
    const provisioner = await import("../bin/federation/deploy/runtime/AdminDatabaseProvisioner.js");
    const { default: Database } = await import("better-sqlite3");
    const config_dir = path.join(platform_root, "config/fed_admin_test");
    const data_dir = path.join(platform_root, "data/fed_admin_test");
    const prepared = runtime.prepare_local_runtime_config(project_dir, config_dir, data_dir);
    assert.equal(prepared.database_path, path.join(data_dir, "data.sqlite"));
    assert.equal(fs.statSync(prepared.config_path).mode & 0o777, 0o600);
    const credentials = {
      mode: "initialize",
      provision_id: "fap_local_initialize",
      admin_id: "admin_initial",
      password_hash: "pbkdf2_sha256$210000$salt$digest",
      password: "fixture_password_not_persisted",
    };
    assert.deepEqual(provisioner.provision_local_admin_database(
      project_dir, credentials, prepared.database_path,
    ), { admin_id: credentials.admin_id, credentials_applied: true });
    assert.deepEqual(provisioner.provision_local_admin_database(project_dir, {
      ...credentials, provision_id: "fap_ignored", admin_id: "admin_ignored",
    }, prepared.database_path), { admin_id: credentials.admin_id, credentials_applied: false });
    const reset_credentials = {
      ...credentials, mode: "reset", provision_id: "fap_local_reset", admin_id: "admin_reset",
    };
    assert.deepEqual(provisioner.provision_local_admin_database(
      project_dir, reset_credentials, prepared.database_path,
    ), { admin_id: reset_credentials.admin_id, credentials_applied: true });
    const database = new Database(prepared.database_path);
    try {
      assert.deepEqual(database.prepare(
        "SELECT admin_id, password_hash FROM federation_administrators",
      ).all(), [{ admin_id: reset_credentials.admin_id, password_hash: credentials.password_hash }]);
    } finally {
      database.close();
    }
    assert.equal(fs.existsSync(path.join(project_dir, "data.sqlite")), false);
    assert.doesNotMatch(fs.readFileSync(prepared.config_path, "utf8"), /fixture_password/u);
  } finally {
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(project_dir, { recursive: true, force: true });
  }
});

test("部署 URL 变化时只更新 registry，不保存全局操作目标", async () => {
  const platform_root = create_temp_dir("downcity-fed-registry-state-");
  process.env.DC_PLATFORM_ROOT = platform_root;
  try {
    const session = await import("../bin/federation/core/session.js");
    const config = {
      schema: 1,
      type: "federation",
      id: "fed_registry_test",
      name: "registry-test",
      entry: "src/index.ts",
      deployment: {
        target: "cloudflare-workers",
        resources: {},
      },
    };
    const release_metadata = {
      release_id: "release_registry_test",
      release_dir: path.join(platform_root, "releases/release_registry_test"),
      runtime_config_path: path.join(platform_root, "config/runtime.env.json"),
      data_dir: path.join(platform_root, "data"),
    };
    const first = session.register_deployed_server({
      config,
      ...release_metadata,
      project_dir: platform_root,
      base_url: "https://first.example.workers.dev",
      status: "deployed",
      admin_id: "admin_test",
    });
    assert.equal("active_server_url" in session.readConfig(), false);
    assert.equal(session.readServer(first.base_url)?.fed_id, config.id);
    const saved_server = session.readServer(first.base_url);
    for (const [key, value] of Object.entries(release_metadata)) {
      assert.equal(saved_server[key], value);
    }
    const second = session.register_deployed_server({
      config,
      project_dir: platform_root,
      base_url: "https://second.example.workers.dev",
      status: "deployed",
    });
    assert.equal("active_server_url" in session.readConfig(), false);
    assert.equal(session.readConfig().servers.length, 1);
    assert.equal(second.admin_id, "admin_test");
  } finally {
    fs.rmSync(platform_root, { recursive: true, force: true });
    delete process.env.DC_PLATFORM_ROOT;
  }
});

test("Local deploy 登记全局状态并替换同一 Fed 的旧实例", async () => {
  const platform_root = create_temp_dir("downcity-fed-state-");
  const project_dir = create_temp_dir("downcity-fed-project-");
  process.env.DC_PLATFORM_ROOT = platform_root;
  // 测试显式指定隔离端口，避免触碰开发者正在使用的默认实例。
  const test_port = 25000 + (process.pid % 1000);

  const config = {
    schema: 1,
    type: "federation",
    id: "fed_lifecycle_test",
    name: "lifecycle-test",
    entry: "server.ts",
    deployment: {
      target: "local",
      port: test_port,
    },
  };
  write_local_release_fixture(project_dir, config);

  const reader = await import("../bin/federation/deploy/config/FederationProjectConfigReader.js");
  const deployer = await import("../bin/federation/deploy/runtime/LocalFederationDeployer.js");
  const session = await import("../bin/federation/core/session.js");
  const options = {
    source: project_dir,
    dry_run: false,
    verify_only: false,
    verify: true,
    skip_build: true,
    skip_typecheck: true,
    admin_reset: false,
    yes: false,
  };

  let latest_server;
  try {
    const config_file = reader.read_federation_project_config(project_dir);
    const runtime = await import("../bin/federation/deploy/release/LocalRuntimeConfig.js");
    const provisioner = await import("../bin/federation/deploy/runtime/AdminDatabaseProvisioner.js");
    const prepared = runtime.prepare_local_runtime_config(project_dir,
      path.join(platform_root, "federation/config", config.id),
      path.join(platform_root, "federation/data", config.id));
    provisioner.provision_local_admin_database(project_dir, {
      mode: "initialize", provision_id: "fap_lifecycle_fixture", admin_id: "admin_existing",
      password_hash: "pbkdf2_sha256$210000$salt$digest", password: "fixture_password_not_persisted",
    }, prepared.database_path);
    const legacy_server = session.register_deployed_server({
      config: config_file.config,
      project_dir,
      base_url: "http://127.0.0.1:12314",
      status: "stopped",
      admin_id: "admin_existing",
    });
    await assert.rejects(() => deployer.restart_managed_local_server(legacy_server),
      /no independent release/iu);
    await assert.rejects(() => deployer.deploy_local_federation({
      ...config_file,
      config: { ...config_file.config, deployment: {
        ...config_file.config.deployment, scripts: { deploy: "forbidden-shell-command" },
      } },
    }, options), (error) => {
      assert.match(error.message, /Local Federation deployment failed/iu);
      assert.match(error.note, /do not support shell deploy scripts/iu);
      return true;
    });
    // 已存在独立数据库和管理员，fixture 部署不进入交互式凭证输入。
    await deployer.deploy_local_federation(config_file, options);
    const first_server = session.read_server_by_fed_id(config.id, "local");
    latest_server = first_server;
    assert.ok(first_server);
    assert.equal(first_server.status, "running");
    assert.equal(first_server.port, test_port);
    assert.ok(is_process_alive(first_server.pid));
    assert.ok(first_server.release_id);
    assert.equal(first_server.release_dir, path.join(platform_root,
      "federation/deployments", config.id, "releases", first_server.release_id));
    assert.equal(first_server.runtime_config_path, path.join(platform_root,
      "federation/config", config.id, "runtime.env.json"));
    assert.equal(first_server.data_dir, path.join(platform_root, "federation/data", config.id));
    assert.equal(fs.statSync(first_server.runtime_config_path).mode & 0o777, 0o600);
    const runtime_env = JSON.parse(fs.readFileSync(first_server.runtime_config_path, "utf8"));
    assert.equal(runtime_env.DATABASE_PATH, path.join(first_server.data_dir, "data.sqlite"));
    assert.equal(runtime_env.TEST_RUNTIME_VALUE, "isolated");
    assert.equal(fs.existsSync(path.join(first_server.release_dir, "app/.env")), false);
    assert.equal(fs.readFileSync(path.join(first_server.release_dir, "app/assets/message.txt"), "utf8"),
      "installed resource");
    await assert_release_health(first_server);

    const outside_dir = create_temp_dir("downcity-fed-outside-");
    const previous_cwd = process.cwd();
    process.chdir(outside_dir);
    try {
      assert.equal("active_server_url" in session.readConfig(), false);
      assert.equal(session.read_server_by_fed_id(config.id, "local").fed_id, config.id);
    } finally {
      process.chdir(previous_cwd);
      fs.rmSync(outside_dir, { recursive: true, force: true });
    }

    const selected_server = session.addServer({
      base_url: "https://selected.example.com",
      name: "selected",
    });
    assert.equal(session.readServer(selected_server.base_url)?.name, "selected");
    assert.equal("active_server_url" in session.readConfig(), false);

    await deployer.deploy_local_federation(config_file, options);
    latest_server = session.read_server_by_fed_id(config.id, "local");
    assert.ok(latest_server);
    assert.notEqual(latest_server.pid, first_server.pid);
    assert.equal(latest_server.port, first_server.port);
    assert.equal(is_process_alive(first_server.pid), false);
    assert.notEqual(latest_server.release_id, first_server.release_id);
    assert.notEqual(latest_server.instance_id, first_server.instance_id);
    await assert_release_health(latest_server);
    const current_path = path.join(platform_root, "federation/deployments", config.id, "current.json");
    assert.equal(JSON.parse(fs.readFileSync(current_path, "utf8")).release_id, latest_server.release_id);

    // 源码删除后仍只能重启已安装产物，release 不变而进程身份必须更新。
    fs.rmSync(project_dir, { recursive: true, force: true });
    const before_restart = latest_server;
    await deployer.restart_managed_local_server(before_restart);
    latest_server = session.read_server_by_fed_id(config.id, "local");
    assert.equal(latest_server.release_id, before_restart.release_id);
    assert.equal(latest_server.release_dir, before_restart.release_dir);
    assert.notEqual(latest_server.instance_id, before_restart.instance_id);
    assert.equal(is_process_alive(before_restart.pid), false);
    await assert_release_health(latest_server);
    assert.equal(session.readServer(selected_server.base_url)?.name, "selected");

    session.removeServer(selected_server.base_url);
    assert.equal(session.readServer(selected_server.base_url), undefined);
    assert.equal("active_server_url" in session.readConfig(), false);
    assert.equal(session.read_server_by_fed_id(config.id, "local").base_url, latest_server.base_url);
  } finally {
    const current_server = session.read_server_by_fed_id(config.id, "local");
    if (current_server?.pid) await deployer.stop_managed_local_server(current_server);
    fs.rmSync(platform_root, { recursive: true, force: true });
    fs.rmSync(project_dir, { recursive: true, force: true });
    delete process.env.DC_PLATFORM_ROOT;
  }
});
