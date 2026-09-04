/**
 * @file Downcity workspace package 依赖图。
 *
 * 该模块以各 package manifest 为唯一事实源，统一服务于：
 * - public package 发布拓扑；
 * - patch build 的依赖闭包与构建顺序；
 * - CLI 本地全局安装的 workspace package 同步范围。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** GitHub workflow 当前显式支持的最大发布拓扑层数。 */
export const MAX_PUBLISH_LAYERS = 5;

/** 会进入运行时安装图的 manifest 依赖字段。 */
const runtime_dependency_fields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

/** 递归发现 package 时必须跳过的依赖与构建产物目录。 */
const ignored_directory_names = new Set([
  ".git",
  "bin",
  "dist",
  "node_modules",
]);

/** 读取 manifest 中的 Downcity 运行时依赖名称。 */
export function read_downcity_runtime_dependencies(manifest) {
  const dependencies = new Set();
  for (const field_name of runtime_dependency_fields) {
    const field = manifest?.[field_name];
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    for (const dependency_name of Object.keys(field)) {
      if (dependency_name.startsWith("@downcity/")) dependencies.add(dependency_name);
    }
  }
  return [...dependencies].sort();
}

/** 从 workspace 解析 public `@downcity/*` package，并生成发布分层。 */
export function resolve_publish_layers(workspace_root) {
  const manifests = read_workspace_manifests(workspace_root, false)
    .filter((item) => item.name.startsWith("@downcity/") && !item.private);
  const layers = resolve_manifest_layers(manifests, MAX_PUBLISH_LAYERS);
  return {
    layers: layers.map((layer) => layer.map(to_public_package)),
    package_count: manifests.length,
  };
}

/**
 * 解析显式选择 package 的完整构建顺序。
 *
 * 只有显式目标会 bump；本函数只负责补齐运行时依赖并按拓扑排序。
 */
export function resolve_package_build_order(workspace_root, target_keys) {
  const manifests = read_workspace_manifests(workspace_root, true)
    .filter((item) => !item.private);
  const manifests_by_key = new Map(manifests.map((item) => [item.key, item]));
  const manifests_by_name = new Map(manifests.map((item) => [item.name, item]));
  const selected_names = new Set();

  const visit = (manifest) => {
    if (selected_names.has(manifest.name)) return;
    selected_names.add(manifest.name);
    for (const dependency_name of manifest.downcity_dependencies) {
      const dependency = manifests_by_name.get(dependency_name);
      if (dependency) visit(dependency);
    }
  };

  for (const target_key of target_keys) {
    const manifest = manifests_by_key.get(target_key);
    if (!manifest) throw new Error(`未找到可构建 package: ${target_key}`);
    visit(manifest);
  }

  return resolve_manifest_layers(manifests)
    .flat()
    .filter((item) => selected_names.has(item.name))
    .map((item) => item.key);
}

/** 根据稳定 package key 解析当前 workspace 中的真实目录。 */
export function resolve_package_path(workspace_root, target_key) {
  const manifest = read_workspace_manifests(workspace_root, true)
    .find((item) => item.key === target_key && !item.private);
  if (!manifest) throw new Error(`未找到 package: ${target_key}`);
  return manifest.path;
}

/** 生成 GitHub Actions output；空层也输出稳定的空 matrix。 */
export function create_workflow_outputs(graph) {
  const outputs = {
    has_packages: graph.package_count > 0 ? "true" : "false",
    layer_count: String(graph.layers.length),
  };

  for (let layer_index = 0; layer_index < MAX_PUBLISH_LAYERS; layer_index += 1) {
    const packages = graph.layers[layer_index] ?? [];
    outputs[`has_layer_${layer_index}`] = packages.length > 0 ? "true" : "false";
    outputs[`layer_${layer_index}_matrix`] = JSON.stringify({ include: packages });
  }

  return outputs;
}

/** 读取 workspace package manifests。 */
function read_workspace_manifests(workspace_root, include_cli) {
  const package_paths = find_package_manifests(workspace_root, "packages");
  const cli_manifest_path = "app/cli/package.json";
  if (include_cli && existsSync(path.join(workspace_root, cli_manifest_path))) {
    package_paths.push(cli_manifest_path);
  }

  return package_paths
    .map((manifest_path) => read_manifest(workspace_root, manifest_path))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 在分组目录中递归发现最外层 package manifest。 */
function find_package_manifests(workspace_root, relative_directory) {
  const absolute_directory = path.join(workspace_root, relative_directory);
  if (!existsSync(absolute_directory)) return [];

  const manifest_paths = [];
  for (const entry of readdirSync(absolute_directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored_directory_names.has(entry.name)) continue;
    const child_directory = path.join(relative_directory, entry.name);
    const manifest_path = path.join(child_directory, "package.json");
    if (existsSync(path.join(workspace_root, manifest_path))) {
      manifest_paths.push(manifest_path);
      continue;
    }
    manifest_paths.push(...find_package_manifests(workspace_root, child_directory));
  }
  return manifest_paths;
}

/** 读取并规范化单个 workspace manifest。 */
function read_manifest(workspace_root, manifest_path) {
  const manifest = JSON.parse(readFileSync(path.join(workspace_root, manifest_path), "utf8"));
  if (!manifest.name || !manifest.version) {
    throw new Error(`${manifest_path} 缺少 name 或 version，无法参与 package graph`);
  }
  return {
    name: manifest.name,
    key: resolve_package_key(manifest.name, manifest_path),
    path: path.dirname(manifest_path).replaceAll("\\", "/"),
    version: manifest.version,
    private: manifest.private === true,
    downcity_dependencies: read_downcity_runtime_dependencies(manifest),
  };
}

/** 从发布身份生成不受物理目录影响的构建 key。 */
function resolve_package_key(package_name, manifest_path) {
  if (package_name === "downcity") return "cli";
  if (package_name.startsWith("@downcity/")) return package_name.slice("@downcity/".length);
  return path.basename(path.dirname(manifest_path));
}

/** 按 manifest 运行时依赖解析稳定拓扑层。 */
function resolve_manifest_layers(manifests, maximum_layers) {
  const package_names = new Set(manifests.map((item) => item.name));
  for (const manifest of manifests) {
    for (const dependency_name of manifest.downcity_dependencies) {
      if (!package_names.has(dependency_name)) {
        throw new Error(
          `${manifest.name} references unknown public runtime dependency ${dependency_name}`,
        );
      }
    }
  }

  const unresolved = new Map(manifests.map((item) => [item.name, item]));
  const resolved = new Set();
  const layers = [];
  while (unresolved.size > 0) {
    const layer = [...unresolved.values()]
      .filter((item) => item.downcity_dependencies.every((name) => resolved.has(name)))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (layer.length === 0) {
      throw new Error(
        `Circular Downcity runtime dependencies prevent publishing: ${[...unresolved.keys()].sort().join(", ")}`,
      );
    }
    layers.push(layer);
    for (const item of layer) {
      unresolved.delete(item.name);
      resolved.add(item.name);
    }
  }

  if (maximum_layers !== undefined && layers.length > maximum_layers) {
    throw new Error(
      `Publish graph requires ${layers.length} layers, but workflow supports ${maximum_layers}`,
    );
  }
  return layers;
}

/** 投影发布器需要的最小 package 信息。 */
function to_public_package({ name, path: package_path, version }) {
  return { name, path: package_path, version };
}
