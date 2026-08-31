/**
 * @file 本地 package 发布计划测试。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolve_publish_layers } from "../.github/scripts/resolve-publish-matrix.mjs";
import {
  build_publish_plan,
  resolve_scoped_selection,
} from "./publish-packages.mjs";

test("指定 package 会自动补齐 scoped 运行时依赖并保持拓扑顺序", () => {
  const graph = resolve_publish_layers(process.cwd());
  const selected = resolve_scoped_selection(graph, ["@downcity/plugins"]);
  const plan = build_publish_plan(graph, selected, false);

  assert.deepEqual(plan.map((item) => item.name), [
    "@downcity/plugin",
    "@downcity/type",
    "@downcity/workspace",
    "@downcity/federation",
    "@downcity/agent",
    "@downcity/plugins",
  ]);
});

test("CLI 发布计划包含 scoped 依赖和 CLI 本身", () => {
  const graph = resolve_publish_layers(process.cwd());
  const targets = ["@downcity/agent"];
  const selected = resolve_scoped_selection(graph, targets);
  const plan = build_publish_plan(graph, selected, true);

  assert.equal(plan.at(-1).name, "downcity");
  assert.ok(plan.some((item) => item.name === "@downcity/local"));
  assert.ok(plan.some((item) => item.name === "@downcity/plugin"));
  assert.ok(plan.some((item) => item.name === "@downcity/plugins"));
});
