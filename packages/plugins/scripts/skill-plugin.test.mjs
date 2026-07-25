/**
 * SkillPlugin action 目录与动态 system prompt 回归测试。
 *
 * 关键点（中文）
 * - find/install action 只返回 shell 指引，不能执行命令或写入文件。
 * - system prompt 必须根据构造参数输出项目、用户和自定义扫描根。
 * - install action 的提示词应引导 Agent 调用 list 检查 Skill 是否进入可发现范围。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SkillPlugin } from "../bin/index.js";

test("SkillPlugin 暴露四个职责清晰的 actions", () => {
  const plugin = new SkillPlugin();

  assert.deepEqual(Object.keys(plugin.actions).sort(), [
    "find",
    "install",
    "list",
    "lookup",
  ]);
});

test("SkillPlugin 根据扫描参数生成 action 工作流提示", async () => {
  const project_root = path.resolve("fixtures/skill-prompt-project");
  const plugin = new SkillPlugin({
    use: ["project", "home"],
    paths: [".agents/shared-skills"],
    ignore: ["hidden-skill"],
  });

  const prompt = await plugin.system({ workspace_path: project_root });

  assert.match(prompt, /\[project\] \.agents\/skills ->/);
  assert.match(prompt, /\[custom\] \.agents\/shared-skills ->/);
  assert.match(prompt, /\[home\] ~\/\.agents\/skills ->/);
  assert.match(prompt, /Call `skill\.find`/);
  assert.match(prompt, /call `skill\.install`/);
  assert.match(prompt, /return prompts only/);
  assert.match(prompt, /Configured ignore rules are active/);
});

test("find 和 install actions 只返回提示词且不创建扫描目录", async () => {
  const project_root = path.resolve("fixtures/skill-instruction-actions");
  const plugin = new SkillPlugin({
    use: ["project", "home"],
    paths: [".agents/shared-skills"],
  });

  assert.equal(fs.existsSync(project_root), false);

  const find_result = await plugin.actions.find.execute({
    context: { workspace_path: project_root },
    input: { query: "web access" },
  });
  const install_result = await plugin.actions.install.execute({
    context: { workspace_path: project_root },
    input: { spec: "owner/repository@web-access" },
  });

  assert.equal(find_result.success, true);
  assert.match(find_result.data.prompt, /https:\/\/www\.skills\.sh\//);
  assert.match(
    find_result.data.prompt,
    /https:\/\/app\.lobehub\.com\/community\/skill/,
  );
  assert.match(find_result.data.prompt, /npx -y skills find 'web access'/);
  assert.match(find_result.data.prompt, /has not searched for or installed anything/);
  assert.equal(install_result.success, true);
  assert.match(
    install_result.data.prompt,
    /npx -y skills add 'owner\/repository@web-access' -y/,
  );
  assert.match(install_result.data.prompt, /action: "list"/);
  assert.match(install_result.data.prompt, /has not installed or changed any files/);
  assert.equal(fs.existsSync(project_root), false);
});

test("install action 在没有扫描根时返回配置提示", async () => {
  const project_root = path.resolve("fixtures/no-skill-root");
  const plugin = new SkillPlugin({ use: [] });
  const result = await plugin.actions.install.execute({
    context: { workspace_path: project_root },
    input: { spec: "owner/repository@skill" },
  });

  assert.equal(result.success, true);
  assert.match(result.data.prompt, /No scan roots are configured/);
  assert.equal(fs.existsSync(project_root), false);
});
