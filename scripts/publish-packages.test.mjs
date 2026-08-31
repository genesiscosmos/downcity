/**
 * @file 本地 package 发布计划测试。
 */

import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import test from "node:test";

import { resolve_publish_layers } from "../.github/scripts/resolve-publish-matrix.mjs";
import {
  build_publish_plan,
  create_publish_auth,
  find_workspace_dependencies,
  read_publish_token,
  resolve_scoped_selection,
  verify_publish_plan,
} from "./publish-packages.mjs";

test("发布 manifest 会识别全部依赖字段中的 workspace 协议", () => {
  assert.deepEqual(
    find_workspace_dependencies({
      dependencies: { "@downcity/type": "workspace:*" },
      optionalDependencies: { "@downcity/optional": "workspace:^" },
      peerDependencies: { "@downcity/peer": "^1.0.0" },
      devDependencies: { "@downcity/dev": "workspace:~" },
    }),
    [
      "dependencies.@downcity/type=workspace:*",
      "optionalDependencies.@downcity/optional=workspace:^",
      "devDependencies.@downcity/dev=workspace:~",
    ],
  );
});

test("发布认证只读取 .env 中的 NPM_TOKEN", () => {
  const fixture_path = new URL("./fixtures/publish.env", import.meta.url);
  const previous_secret = process.env.IGNORED_SECRET;
  assert.equal(read_publish_token(fixture_path), "test_token_value");
  assert.equal(process.env.IGNORED_SECRET, previous_secret);
});

test("临时 npm 配置限制文件权限并在生命周期结束后清理", () => {
  const auth = create_publish_auth("test_token_value");
  const config_path = auth.env.NPM_CONFIG_USERCONFIG;
  try {
    assert.match(config_path, /downcity-npm-publish-/);
    assert.equal(statSync(config_path).mode & 0o777, 0o600);
  } finally {
    auth.dispose();
  }
  assert.equal(existsSync(config_path), false);
});

test("指定 package 会自动补齐 scoped 运行时依赖并保持拓扑顺序", () => {
  const graph = resolve_publish_layers(process.cwd());
  const selected = resolve_scoped_selection(graph, ["@downcity/plugins"]);
  const plan = build_publish_plan(graph, selected, false);

  assert.deepEqual(plan.map((item) => item.name), [
    "@downcity/plugin",
    "@downcity/type",
    "@downcity/federation",
    "@downcity/workspace",
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

test("全部 public packages 发布计划以 CLI 收尾", () => {
  const graph = resolve_publish_layers(process.cwd());
  const targets = graph.layers.flat().map((item) => item.name);
  const selected = resolve_scoped_selection(graph, targets);
  const plan = build_publish_plan(graph, selected, true);

  assert.equal(plan.length, graph.package_count + 1);
  assert.equal(plan.at(-1).name, "downcity");
});

test("Registry 校验会等待目标版本和 latest 同时可见", async () => {
  const plan = [{ name: "@downcity/example", version: "1.2.3" }];
  let reads = 0;

  await verify_publish_plan(plan, {}, {
    attempts: 2,
    interval_ms: 0,
    read_state: async () => {
      reads += 1;
      if (reads === 1) return { latest: "", version: "" };
      return { latest: "1.2.3", version: "1.2.3" };
    },
    wait: async () => {},
  });

  assert.equal(reads, 2);
});

test("Registry 校验拒绝 latest 与目标版本不一致", async () => {
  const plan = [{ name: "@downcity/example", version: "1.2.3" }];

  await assert.rejects(
    verify_publish_plan(plan, {}, {
      attempts: 1,
      interval_ms: 0,
      read_state: async () => ({ latest: "1.2.2", version: "1.2.3" }),
      wait: async () => {},
    }),
    /未在等待时间内完成 Registry 校验/,
  );
});

test("Registry 校验拒绝已发布 manifest 中的 workspace 协议", async () => {
  const plan = [{ name: "@downcity/example", version: "1.2.3" }];

  await assert.rejects(
    verify_publish_plan(plan, {}, {
      attempts: 1,
      interval_ms: 0,
      read_state: async () => ({
        latest: "1.2.3",
        version: "1.2.3",
        manifest: {
          dependencies: { "@downcity/type": "workspace:*" },
        },
      }),
      wait: async () => {},
    }),
    /发布内容仍包含 workspace 依赖/,
  );
});
