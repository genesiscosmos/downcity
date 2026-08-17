/**
 * @file 验证 Workspace 可装配的 grep / find 项目搜索工具。
 *
 * 关键点（中文）
 * - grep 覆盖字面量、正则、大小写、结果截断与项目路径边界。
 * - find 覆盖 glob、.gitignore、dotfile、符号链接与非法模式。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Workspace } from "@downcity/workspace";

const rg_available = spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;

async function create_fixture(t) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-search-tools-"));
  const outside_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-search-outside-"));
  t.after(async () => {
    await fs.rm(root_path, { recursive: true, force: true });
    await fs.rm(outside_path, { recursive: true, force: true });
  });
  return {
    root_path,
    outside_path,
    tools: new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data") }).tools,
  };
}

async function execute_tool(tools, name, input, abort_signal) {
  const execute = tools[name]?.execute;
  assert.equal(typeof execute, "function", `${name} tool must be executable`);
  const result = await execute(input, {
    toolCallId: `test-${name}`,
    messages: [],
    abortSignal: abort_signal || new AbortController().signal,
  });
  assert.deepEqual(result.messages, []);
  return result.output;
}

test("grep returns structured literal matches and respects .gitignore", { skip: !rg_available }, async (t) => {
  const fixture = await create_fixture(t);
  await fs.mkdir(path.join(fixture.root_path, "src"), { recursive: true });
  await fs.mkdir(path.join(fixture.root_path, "ignored"), { recursive: true });
  await fs.writeFile(path.join(fixture.root_path, ".gitignore"), "ignored/\n", "utf8");
  await fs.writeFile(path.join(fixture.root_path, "src", "main.ts"), "é Beta value\n", "utf8");
  await fs.writeFile(path.join(fixture.root_path, "ignored", "secret.ts"), "Beta hidden\n", "utf8");

  const result = await execute_tool(fixture.tools, "grep", {
    query: "beta",
    glob: ["*.ts"],
  });
  assert.equal(result.success, true);
  assert.equal(result.match_count, 1);
  assert.deepEqual(result.matches[0], {
    file_path: "src/main.ts",
    line_number: 1,
    column: 4,
    text: "é Beta value",
    match_text: "Beta",
    line_truncated: false,
  });
  assert.equal(result.truncated, false);
});

test("grep supports case-sensitive regex and bounded results", { skip: !rg_available }, async (t) => {
  const fixture = await create_fixture(t);
  await fs.writeFile(
    path.join(fixture.root_path, "values.txt"),
    "Item 1\nitem 2\nItem 3\nItem 4\n",
    "utf8",
  );
  const result = await execute_tool(fixture.tools, "grep", {
    query: "Item [0-9]",
    literal: false,
    case_sensitive: true,
    max_results: 2,
  });
  assert.equal(result.success, true);
  assert.equal(result.match_count, 2);
  assert.deepEqual(result.matches.map((item) => item.line_number), [1, 3]);
  assert.equal(result.truncated, true);

  const invalid = await execute_tool(fixture.tools, "grep", {
    query: "(",
    literal: false,
  });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error_code, "invalid_pattern");
});

test("grep rejects paths outside the project root", { skip: !rg_available }, async (t) => {
  const fixture = await create_fixture(t);
  const result = await execute_tool(fixture.tools, "grep", {
    query: "outside",
    path: fixture.outside_path,
  });
  assert.equal(result.success, false);
  assert.equal(result.error_code, "sandbox_denied");
});

test("find uses glob while respecting ignore rules and dotfiles", async (t) => {
  const fixture = await create_fixture(t);
  await fs.mkdir(path.join(fixture.root_path, "src", "nested"), { recursive: true });
  await fs.mkdir(path.join(fixture.root_path, "ignored"), { recursive: true });
  await fs.writeFile(path.join(fixture.root_path, ".gitignore"), "ignored/\n", "utf8");
  await fs.writeFile(path.join(fixture.root_path, ".config.ts"), "dot\n", "utf8");
  await fs.writeFile(path.join(fixture.root_path, "src", "main.ts"), "main\n", "utf8");
  await fs.writeFile(path.join(fixture.root_path, "src", "nested", "value.ts"), "value\n", "utf8");
  await fs.writeFile(path.join(fixture.root_path, "ignored", "secret.ts"), "secret\n", "utf8");

  const result = await execute_tool(fixture.tools, "find", {
    pattern: "**/*.ts",
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.files, [".config.ts", "src/main.ts", "src/nested/value.ts"]);
  assert.equal(result.match_count, 3);
  assert.equal(result.truncated, false);
});

test("find scopes patterns to path and stops at max_results", async (t) => {
  const fixture = await create_fixture(t);
  await fs.writeFile(
    path.join(fixture.root_path, ".gitignore"),
    "src/ignored.ts\n",
    "utf8",
  );
  await fs.mkdir(path.join(fixture.root_path, "src"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(fixture.root_path, "src", "a.ts"), "a\n"),
    fs.writeFile(path.join(fixture.root_path, "src", "b.ts"), "b\n"),
    fs.writeFile(path.join(fixture.root_path, "src", "ignored.ts"), "ignored\n"),
    fs.writeFile(path.join(fixture.root_path, "src", "c.js"), "c\n"),
  ]);
  const result = await execute_tool(fixture.tools, "find", {
    pattern: "*.ts",
    path: "src",
    max_results: 1,
  });
  assert.equal(result.success, true);
  assert.equal(result.match_count, 1);
  assert.equal(result.files[0].startsWith("src/"), true);
  assert.equal(result.truncated, true);

  const ignored = await execute_tool(fixture.tools, "find", {
    pattern: "ignored.ts",
    path: "src",
  });
  assert.equal(ignored.success, true);
  assert.deepEqual(ignored.files, []);
});

test("find rejects parent glob segments and does not follow symlinks", async (t) => {
  const fixture = await create_fixture(t);
  await fs.writeFile(path.join(fixture.outside_path, "outside.ts"), "outside\n", "utf8");
  await fs.symlink(fixture.outside_path, path.join(fixture.root_path, "outside-link"));

  const invalid = await execute_tool(fixture.tools, "find", {
    pattern: "../**/*.ts",
  });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error_code, "invalid_pattern");

  const result = await execute_tool(fixture.tools, "find", {
    pattern: "**/*.ts",
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.files, []);
});

test("search tools expose aborted results", async (t) => {
  const fixture = await create_fixture(t);
  const controller = new AbortController();
  controller.abort();
  const result = await execute_tool(
    fixture.tools,
    "find",
    { pattern: "**/*" },
    controller.signal,
  );
  assert.equal(result.success, false);
  assert.equal(result.error_code, "aborted");
});
