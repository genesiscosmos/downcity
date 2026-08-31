/**
 * @file Downcity public packages 本地交互式发布器。
 *
 * 关键点（中文）
 * - 只负责本地发布，不自动 commit 或 push。
 * - `.env` 是 NPM_TOKEN 的唯一配置源，其他环境变量不会从文件注入发布进程。
 * - Token 只写入权限受限的临时 npm 配置，流程结束后立即清理。
 * - scoped package 按运行时依赖拓扑逐层发布，避免 workspace 依赖尚未存在。
 * - pnpm 负责把 workspace 协议转换为可发布的 semver。
 * - 每个 package 发布前先审计实际 tarball，禁止把 workspace 协议带入 Registry。
 * - 发布结束后统一等待 Registry 可见，并验证版本、latest 与依赖清单。
 */

import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseEnv, promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolve_publish_layers } from "../.github/scripts/resolve-publish-matrix.mjs";

const workspace_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli_package = read_package_manifest("packages/cli");
const exec_file = promisify(execFile);
const registry_url = "https://registry.npmjs.org/";
const registry_auth_key = "//registry.npmjs.org/:_authToken";
const dependency_fields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];

/** 从仓库 `.env` 读取唯一允许进入发布认证边界的 NPM_TOKEN。 */
function read_publish_token(env_path = path.join(workspace_root, ".env")) {
  if (!existsSync(env_path)) {
    throw new Error("仓库根目录缺少 .env，请添加 NPM_TOKEN 后重试");
  }
  const parsed_env = parseEnv(readFileSync(env_path, "utf8"));
  const npm_token = String(parsed_env.NPM_TOKEN ?? "").trim();
  if (!npm_token) {
    throw new Error(".env 缺少有效的 NPM_TOKEN");
  }
  return npm_token;
}

/** 创建只在本次发布生命周期内存在的 npm 用户配置。 */
function create_publish_auth(npm_token = read_publish_token()) {
  const auth_directory = mkdtempSync(path.join(tmpdir(), "downcity-npm-publish-"));
  const config_path = path.join(auth_directory, ".npmrc");
  chmodSync(auth_directory, 0o700);
  writeFileSync(
    config_path,
    `registry=${registry_url}\n${registry_auth_key}=${npm_token}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  let disposed = false;
  return {
    env: {
      ...process.env,
      NPM_CONFIG_USERCONFIG: config_path,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rmSync(auth_directory, { recursive: true, force: true });
    },
  };
}

/** 读取 package manifest。 */
function read_package_manifest(package_path) {
  const manifest_path = path.join(workspace_root, package_path, "package.json");
  return JSON.parse(readFileSync(manifest_path, "utf8"));
}

/** 读取一个 package 的 Downcity 运行时依赖。 */
function read_downcity_dependencies(package_path) {
  const manifest = read_package_manifest(package_path);
  const dependencies = new Set();
  for (const field_name of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const field = manifest[field_name];
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    for (const dependency_name of Object.keys(field)) {
      if (dependency_name.startsWith("@downcity/")) dependencies.add(dependency_name);
    }
  }
  return dependencies;
}

/** 将全部 package 展平为 name -> package。 */
function flatten_layers(graph) {
  return new Map(graph.layers.flat().map((item) => [item.name, item]));
}

/** 计算目标 scoped packages 及其全部运行时依赖闭包。 */
function resolve_scoped_selection(graph, targets) {
  const packages = flatten_layers(graph);
  const selected = new Set();
  const visit = (package_name) => {
    if (selected.has(package_name)) return;
    const package_info = packages.get(package_name);
    if (!package_info) throw new Error(`未找到可发布 package: ${package_name}`);
    selected.add(package_name);
    for (const dependency_name of read_downcity_dependencies(package_info.path)) {
      if (packages.has(dependency_name)) visit(dependency_name);
    }
  };
  for (const target of targets) visit(target);
  return selected;
}

/** 构造按拓扑顺序排列的发布清单。 */
function build_publish_plan(graph, selected_scoped_names, include_cli) {
  const packages = flatten_layers(graph);
  const scoped_names = new Set(selected_scoped_names);
  if (include_cli) {
    for (const dependency_name of read_downcity_dependencies("packages/cli")) {
      for (const package_name of resolve_scoped_selection(graph, [dependency_name])) {
        scoped_names.add(package_name);
      }
    }
  }
  const plan = graph.layers.flatMap((layer) => layer.filter((item) => scoped_names.has(item.name)));
  if (include_cli) {
    plan.push({
      name: cli_package.name,
      path: "packages/cli",
      version: cli_package.version,
    });
  }
  return plan.map((item) => ({ ...item, manifest: packages.get(item.name) ?? item }));
}

/** 执行命令并将输出直传到当前终端。 */
function run_command(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: workspace_root,
    stdio: "inherit",
    ...options,
  });
}

/** 返回 manifest 中仍使用 workspace 协议的依赖位置。 */
function find_workspace_dependencies(manifest) {
  const matches = [];
  for (const field_name of dependency_fields) {
    const dependencies = manifest?.[field_name];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    for (const [dependency_name, dependency_range] of Object.entries(dependencies)) {
      if (String(dependency_range).startsWith("workspace:")) {
        matches.push(`${field_name}.${dependency_name}=${dependency_range}`);
      }
    }
  }
  return matches;
}

/** 校验对外发布 manifest 不包含 workspace 协议。 */
function assert_publishable_manifest(manifest, package_spec) {
  const workspace_dependencies = find_workspace_dependencies(manifest);
  if (workspace_dependencies.length === 0) return;
  throw new Error(
    `${package_spec} 的发布内容仍包含 workspace 依赖：${workspace_dependencies.join(", ")}`,
  );
}

/**
 * 生成并审计 pnpm 实际发布 tarball。
 *
 * tarball 是 Registry 最终接收内容的最近边界，因此不能只检查工作区源 manifest。
 */
function verify_package_tarball(item, npm_env) {
  const pack_directory = mkdtempSync(path.join(tmpdir(), "downcity-package-pack-"));
  try {
    execFileSync(
      "pnpm",
      ["pack", "--json", "--pack-destination", pack_directory],
      {
        cwd: path.join(workspace_root, item.path),
        env: npm_env,
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    const tarball_names = readdirSync(pack_directory)
      .filter((file_name) => file_name.endsWith(".tgz"));
    if (tarball_names.length !== 1) {
      throw new Error(
        `${item.name}@${item.version} 应生成一个 tarball，实际为 ${tarball_names.length} 个`,
      );
    }

    const tarball_path = path.join(pack_directory, tarball_names[0]);
    const manifest_output = execFileSync(
      "tar",
      ["-xOf", tarball_path, "package/package.json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    const manifest = JSON.parse(manifest_output);
    const package_spec = `${item.name}@${item.version}`;
    if (manifest.name !== item.name || manifest.version !== item.version) {
      throw new Error(
        `${package_spec} 的 tarball 标识不一致：${manifest.name}@${manifest.version}`,
      );
    }
    assert_publishable_manifest(manifest, package_spec);
  } finally {
    rmSync(pack_directory, { recursive: true, force: true });
  }
}

/** 判断 npm registry 是否已经存在指定版本。 */
function is_published(package_name, package_version, npm_env) {
  try {
    const output = execFileSync(
      "npm",
      ["view", `${package_name}@${package_version}`, "version", "--json"],
      {
        cwd: workspace_root,
        encoding: "utf8",
        env: npm_env,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return JSON.parse(output) === package_version;
  } catch {
    return false;
  }
}

/** 读取 package 当前 Registry 版本、latest 标签与依赖清单。 */
async function read_registry_state(package_name, npm_env) {
  try {
    const { stdout } = await exec_file(
      "npm",
      [
        "view",
        package_name,
        "version",
        "dist-tags",
        "dependencies",
        "optionalDependencies",
        "peerDependencies",
        "devDependencies",
        "--json",
      ],
      {
        cwd: workspace_root,
        encoding: "utf8",
        env: npm_env,
      },
    );
    const state = JSON.parse(stdout);
    return {
      latest: String(state?.["dist-tags"]?.latest ?? ""),
      version: String(state?.version ?? ""),
      manifest: state,
    };
  } catch {
    return { latest: "", version: "", manifest: {} };
  }
}

/** 等待 npm Registry 完成新版本传播，并验证 latest 一致。 */
async function verify_publish_plan(plan, npm_env, options = {}) {
  const attempts = options.attempts ?? 24;
  const interval_ms = options.interval_ms ?? 5_000;
  const read_state = options.read_state
    ?? ((package_name) => read_registry_state(package_name, npm_env));
  const wait = options.wait
    ?? ((duration_ms) => new Promise((resolve) => setTimeout(resolve, duration_ms)));
  let pending = [...plan];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const states = await Promise.all(
      pending.map(async (item) => ({
        item,
        state: await read_state(item.name),
      })),
    );
    pending = states.flatMap(({ item, state }) => {
      if (state.version !== item.version || state.latest !== item.version) return [item];
      assert_publishable_manifest(state.manifest, `${item.name}@${item.version}`);
      return [];
    });
    if (pending.length === 0) return;
    if (attempt === attempts) break;
    console.log(
      `等待 npm Registry 同步（${attempt}/${attempts}）：${pending.map((item) => item.name).join(", ")}`,
    );
    await wait(interval_ms);
  }

  throw new Error(
    `以下 package 未在等待时间内完成 Registry 校验：${pending.map((item) => `${item.name}@${item.version}`).join(", ")}`,
  );
}

/** 读取 yes/no 交互确认。 */
async function confirm_prompt(readline, question, default_value = false) {
  const suffix = default_value ? " [Y/n] " : " [y/N] ";
  const answer = (await readline.question(`${question}${suffix}`)).trim().toLowerCase();
  if (!answer) return default_value;
  return answer === "y" || answer === "yes";
}

/** 选择本次发布目标。 */
async function choose_targets(readline, graph) {
  const packages = [...flatten_layers(graph).values()].sort((left, right) => left.name.localeCompare(right.name));
  console.log("\n请选择发布目标：");
  console.log("  1) 全部 public packages（包含 downcity CLI）");
  console.log("  2) downcity CLI 及其 scoped 依赖");
  console.log("  3) 指定 package（自动补齐 scoped 依赖，可输入 downcity）");
  const choice = (await readline.question("输入选择 [1-3]（默认 1）：")).trim() || "1";

  if (choice === "1") return { targets: packages.map((item) => item.name), include_cli: true };
  if (choice === "2") {
    return { targets: [...read_downcity_dependencies("packages/cli")], include_cli: true };
  }
  if (choice !== "3") throw new Error("无效选择");

  console.log(packages.map((item) => `  ${item.name}`).join("\n"));
  const names = (await readline.question("输入 package 名称（逗号分隔）："))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error("至少选择一个 package");
  const include_cli = names.includes(cli_package.name);
  return {
    targets: names.filter((name) => name !== cli_package.name),
    include_cli,
  };
}

/** 将发布目标转换成 build-packages.sh 参数。 */
function build_flags(targets, include_cli) {
  const flags = targets.map((name) => `--${name.replace(/^@downcity\//, "")}`);
  if (include_cli) flags.push("--cli");
  return [...new Set(flags)];
}

/** 主交互流程。 */
async function main() {
  const publish_auth = create_publish_auth();
  const readline = createInterface({ input, output });
  try {
    const graph = resolve_publish_layers(workspace_root);
    const npm_user = (() => {
      try {
        return execFileSync("npm", ["whoami"], {
          encoding: "utf8",
          env: publish_auth.env,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        return "";
      }
    })();
    if (!npm_user) {
      throw new Error(".env 中的 NPM_TOKEN 无法通过 npm 身份验证");
    }
    console.log(`\n当前 npm 用户：${npm_user}`);

    const { targets, include_cli } = await choose_targets(readline, graph);
    const selected = resolve_scoped_selection(graph, targets);
    const plan = build_publish_plan(graph, selected, include_cli);
    console.log("\n本次发布顺序：");
    console.log(plan.map((item, index) => `  ${index + 1}. ${item.name}@${item.version}`).join("\n"));

    const should_build = await confirm_prompt(
      readline,
      "是否先执行 patch:build（会增加选中 package 的 patch 版本）？",
      true,
    );
    if (should_build) {
      const flags = build_flags(targets, include_cli);
      run_command("pnpm", ["patch:build", "--", ...flags]);
      for (const item of plan) {
        const manifest = item.name === cli_package.name
          ? read_package_manifest("packages/cli")
          : read_package_manifest(item.path);
        item.version = manifest.version;
      }
    }

    console.log("\n将发布以上版本到 npm registry。");
    if (!(await confirm_prompt(readline, "确认继续？"))) return;

    for (const item of plan) {
      if (is_published(item.name, item.version, publish_auth.env)) {
        console.log(`跳过已存在版本：${item.name}@${item.version}`);
        continue;
      }
      console.log(`\n发布 ${item.name}@${item.version}`);
      console.log(`审计发布 tarball：${item.name}@${item.version}`);
      verify_package_tarball(item, publish_auth.env);
      run_command("pnpm", ["publish", "--access", "public", "--no-git-checks"], {
        cwd: path.join(workspace_root, item.path),
        env: publish_auth.env,
      });
    }
    console.log("\n验证 npm Registry 版本与 latest ...");
    await verify_publish_plan(plan, publish_auth.env);
    console.log("\n本地 package 发布完成，全部 Registry 校验通过。");
  } finally {
    readline.close();
    publish_auth.dispose();
  }
}

const current_file = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current_file) {
  main().catch((error) => {
    console.error(`\n发布失败：${error.message}`);
    process.exitCode = 1;
  });
}

export {
  build_publish_plan,
  create_publish_auth,
  find_workspace_dependencies,
  read_publish_token,
  resolve_scoped_selection,
  verify_package_tarball,
  verify_publish_plan,
};
