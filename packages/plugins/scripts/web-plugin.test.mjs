/**
 * WebPlugin 纯提示 install action 回归测试。
 *
 * 关键点（中文）
 * - install action 只返回 Agent 操作提示，不能执行命令或写入文件。
 * - Skill 安装必须委托给 skill.install，避免 WebPlugin 重复维护扫描根规则。
 * - agent-browser CLI 提示需要根据 user / project 作用域生成。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { WebPlugin } from "../bin/index.js";

test("WebPlugin 仅暴露纯提示 install action", () => {
  const plugin = new WebPlugin();

  assert.deepEqual(Object.keys(plugin.actions), ["install"]);
  assert.equal(plugin.setup, undefined);
  assert.match(plugin.actions.install.description, /does not install anything/);
});

test("install action 默认返回 web-access 安装工作流", async () => {
  const project_root = path.resolve("fixtures/web-install-instructions");
  const plugin = new WebPlugin();

  assert.equal(fs.existsSync(project_root), false);

  const result = await plugin.actions.install.execute({
    context: { workspace_path: project_root },
    input: {},
  });

  assert.equal(result.success, true);
  assert.equal(result.data.kind, "instructions");
  assert.equal(result.data.target, "web-access");
  assert.equal(result.data.scope, "user");
  assert.match(result.data.prompt, /plugin: "skill", action: "install"/);
  assert.match(result.data.prompt, /spec: "web-access"/);
  assert.match(result.data.prompt, /has not executed commands/);
  assert.match(result.data.prompt, /action: "list"/);
  assert.equal(fs.existsSync(project_root), false);
});

test("agent-browser project 提示包含 Skill 与项目 CLI 安装步骤", async () => {
  const plugin = new WebPlugin();
  const result = await plugin.actions.install.execute({
    context: { workspace_path: path.resolve("fixtures/web-agent-browser-instructions") },
    input: { target: "agent-browser", scope: "project" },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.target, "agent-browser");
  assert.equal(result.data.scope, "project");
  assert.match(result.data.prompt, /spec: "agent-browser"/);
  assert.match(result.data.prompt, /pnpm add -D agent-browser/);
  assert.match(result.data.prompt, /npm install -D agent-browser/);
  assert.match(result.data.prompt, /yarn add -D agent-browser/);
  assert.match(result.data.prompt, /skill\.lookup/);
});

test("all 目标返回两个 Skill 和用户级 CLI 提示", async () => {
  const plugin = new WebPlugin();
  const result = await plugin.actions.install.execute({
    context: { workspace_path: path.resolve("fixtures/web-all-instructions") },
    input: { target: "all", scope: "user" },
  });

  assert.equal(result.success, true);
  assert.match(result.data.prompt, /spec: "web-access"/);
  assert.match(result.data.prompt, /spec: "agent-browser"/);
  assert.match(result.data.prompt, /npm install -g agent-browser/);
  assert.match(result.data.prompt, /no files were changed|changed files/i);
});

test("system prompt 明确 install 只返回提示", () => {
  const plugin = new WebPlugin();
  const prompt = plugin.system({ workspace_path: process.cwd() });

  assert.match(prompt, /return installation instructions/);
  assert.match(prompt, /never executes commands/);
  assert.match(prompt, /skill\.install/);
  assert.match(prompt, /skill\.list/);
});
