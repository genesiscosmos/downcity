/**
 * @file 解析 Downcity public packages 的发布拓扑。
 *
 * 每个 package 的层级由运行时 Downcity 依赖自动推导。同层 package 可以并行发布，
 * 下一层必须等待上一层完成，避免上层 Job 占满 Runner 后反向等待底层 package。
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** GitHub workflow 当前显式支持的最大拓扑层数。 */
export const MAX_PUBLISH_LAYERS = 3;

/** 会进入 npm tarball、需要参与发布排序的依赖字段。 */
const RUNTIME_DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * 从 workspace 解析 public `@downcity/*` package，并生成拓扑分层矩阵。
 *
 * @param {string} workspace_root 仓库根目录。
 * @returns {{ layers: Array<Array<{ name: string; path: string; version: string }>>, package_count: number }}
 */
export function resolve_publish_layers(workspace_root) {
  const manifests = read_publish_manifests(workspace_root);
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

    layers.push(layer.map(({ name, path, version }) => ({ name, path, version })));
    for (const item of layer) {
      unresolved.delete(item.name);
      resolved.add(item.name);
    }
  }

  if (layers.length > MAX_PUBLISH_LAYERS) {
    throw new Error(
      `Publish graph requires ${layers.length} layers, but workflow supports ${MAX_PUBLISH_LAYERS}`,
    );
  }

  return { layers, package_count: manifests.length };
}

/**
 * 生成 GitHub Actions output；空层也输出稳定的空 matrix。
 *
 * @param {{ layers: Array<Array<{ name: string; path: string; version: string }>>, package_count: number }} graph 发布图。
 * @returns {Record<string, string>}
 */
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

/** 读取 packages 目录中的 public Downcity manifests。 */
function read_publish_manifests(workspace_root) {
  const packages_directory = join(workspace_root, "packages");
  if (!existsSync(packages_directory)) return [];

  return readdirSync(packages_directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("packages", entry.name, "package.json"))
    .filter((manifest_path) => existsSync(join(workspace_root, manifest_path)))
    .map((manifest_path) => read_publish_manifest(workspace_root, manifest_path))
    .filter((manifest) => manifest !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 读取并规范化一个可发布 manifest。 */
function read_publish_manifest(workspace_root, manifest_path) {
  const manifest = JSON.parse(readFileSync(join(workspace_root, manifest_path), "utf8"));
  if (manifest.private === true || !String(manifest.name ?? "").startsWith("@downcity/")) {
    return null;
  }
  if (!manifest.name || !manifest.version) {
    throw new Error(`${manifest_path} 缺少 name 或 version，无法参与发布判断`);
  }

  const downcity_dependencies = new Set();
  for (const field_name of RUNTIME_DEPENDENCY_FIELDS) {
    const dependencies = manifest[field_name];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    for (const dependency_name of Object.keys(dependencies)) {
      if (dependency_name.startsWith("@downcity/")) downcity_dependencies.add(dependency_name);
    }
  }

  return {
    name: manifest.name,
    path: dirname(manifest_path).replaceAll("\\", "/"),
    version: manifest.version,
    downcity_dependencies: [...downcity_dependencies].sort(),
  };
}

/** 将解析结果写入 GitHub Actions output。 */
function write_workflow_outputs(output_path, outputs) {
  if (!output_path) return;
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(output_path, `${key}=${value}\n`, "utf8");
  }
}

/** CLI 入口。 */
function main() {
  const graph = resolve_publish_layers(process.cwd());
  const outputs = create_workflow_outputs(graph);
  write_workflow_outputs(process.env.GITHUB_OUTPUT, outputs);
  if (!process.env.GITHUB_OUTPUT) console.log(JSON.stringify({ graph, outputs }, null, 2));
}

const current_file = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(current_file).href) {
  main();
}
