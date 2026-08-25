/**
 * @file 本地 npm package 交互式发布入口。
 *
 * 关键点（中文）
 * - 只负责本地发布，不自动 commit 或 push。
 * - scoped package 按运行时依赖拓扑逐层发布，避免 workspace 依赖尚未存在。
 * - package 的 prepack/postpack 负责临时改写并恢复 workspace 依赖版本。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolve_publish_layers } from "../.github/scripts/resolve-publish-matrix.mjs";

const workspace_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli_package = read_package_manifest("packages/cli");

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

/** 判断 npm registry 是否已经存在指定版本。 */
function is_published(package_name, package_version) {
  try {
    execFileSync("npm", ["view", `${package_name}@${package_version}`, "version", "--json"], {
      cwd: workspace_root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
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
  console.log("  1) 全部 @downcity scoped packages");
  console.log("  2) downcity CLI");
  console.log("  3) 指定 package（自动补齐 scoped 依赖）");
  const choice = (await readline.question("输入选择 [1-3]（默认 1）：")).trim() || "1";

  if (choice === "1") return { targets: packages.map((item) => item.name), include_cli: false };
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
  return { targets: names, include_cli: false };
}

/** 将发布目标转换成 build-packages.sh 参数。 */
function build_flags(targets, include_cli) {
  const flags = targets.map((name) => `--${name.replace(/^@downcity\//, "")}`);
  if (include_cli) flags.push("--cli");
  return [...new Set(flags)];
}

/** 主交互流程。 */
async function main() {
  const readline = createInterface({ input, output });
  try {
    const graph = resolve_publish_layers(workspace_root);
    const npm_user = (() => {
      try {
        return execFileSync("npm", ["whoami"], { encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    })();
    if (!npm_user) {
      throw new Error("npm 未登录，请先执行 npm login --registry=https://registry.npmjs.org");
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
      if (is_published(item.name, item.version)) {
        console.log(`跳过已存在版本：${item.name}@${item.version}`);
        continue;
      }
      console.log(`\n发布 ${item.name}@${item.version}`);
      run_command("pnpm", ["publish", "--access", "public", "--no-git-checks"], {
        cwd: path.join(workspace_root, item.path),
      });
    }
    console.log("\n本地 package 发布完成。");
  } finally {
    readline.close();
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
  resolve_scoped_selection,
};
