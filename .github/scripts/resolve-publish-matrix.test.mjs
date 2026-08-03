/**
 * @file npm 发布拓扑解析测试。
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  create_workflow_outputs,
  resolve_publish_layers,
} from "./resolve-publish-matrix.mjs";

test("当前 workspace 被解析为三个稳定发布层", () => {
  const workspace_root = path.resolve(import.meta.dirname, "../..");
  const graph = resolve_publish_layers(workspace_root);

  assert.deepEqual(graph.layers.map((layer) => layer.map((item) => item.name)), [
    ["@downcity/shell", "@downcity/type", "@downcity/ui"],
    [
      "@downcity/agent",
      "@downcity/city",
      "@downcity/sandbox-linux",
      "@downcity/sandbox-macos",
      "@downcity/sandbox-windows-mxc",
      "@downcity/sandbox-windows-srt",
    ],
    [
      "@downcity/database-d1",
      "@downcity/database-postgresql",
      "@downcity/database-sqlite",
      "@downcity/plugins",
      "@downcity/server",
      "@downcity/services",
    ],
  ]);

  const outputs = create_workflow_outputs(graph);
  assert.equal(outputs.has_packages, "true");
  assert.equal(outputs.layer_count, "3");
  assert.equal(outputs.has_layer_2, "true");
  assert.equal(JSON.parse(outputs.layer_1_matrix).include.length, 6);
});

test("解析器拒绝循环运行时依赖", async () => {
  await with_workspace([
    package_manifest("a", { "@downcity/b": "workspace:*" }),
    package_manifest("b", { "@downcity/a": "workspace:*" }),
  ], async (workspace_root) => {
    assert.throws(
      () => resolve_publish_layers(workspace_root),
      /Circular Downcity runtime dependencies.*@downcity\/a, @downcity\/b/,
    );
  });
});

test("解析器拒绝 workspace 中不存在的 Downcity 运行时依赖", async () => {
  await with_workspace([
    package_manifest("a", { "@downcity/missing": "workspace:*" }),
  ], async (workspace_root) => {
    assert.throws(
      () => resolve_publish_layers(workspace_root),
      /@downcity\/a references unknown public runtime dependency @downcity\/missing/,
    );
  });
});

test("解析器拒绝超过 workflow 支持范围的依赖深度", async () => {
  await with_workspace([
    package_manifest("a"),
    package_manifest("b", { "@downcity/a": "workspace:*" }),
    package_manifest("c", { "@downcity/b": "workspace:*" }),
    package_manifest("d", { "@downcity/c": "workspace:*" }),
  ], async (workspace_root) => {
    assert.throws(
      () => resolve_publish_layers(workspace_root),
      /requires 4 layers, but workflow supports 3/,
    );
  });
});

/** 创建测试 package manifest。 */
function package_manifest(name, dependencies = {}) {
  return {
    name: `@downcity/${name}`,
    version: "1.0.0",
    dependencies,
  };
}

/** 在临时 workspace 中运行断言并清理文件。 */
async function with_workspace(manifests, action) {
  const workspace_root = await mkdtemp(path.join(os.tmpdir(), "downcity-publish-graph-"));
  try {
    for (const manifest of manifests) {
      const package_path = path.join(workspace_root, "packages", manifest.name.split("/")[1]);
      await mkdir(package_path, { recursive: true });
      await writeFile(
        path.join(package_path, "package.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
    }
    await action(workspace_root);
  } finally {
    await rm(workspace_root, { recursive: true, force: true });
  }
}
