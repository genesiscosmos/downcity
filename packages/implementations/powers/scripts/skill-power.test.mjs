/**
 * SkillPower action 目录、作用域与 system prompt 回归测试。
 *
 * 关键点（中文）
 * - 模型侧只暴露 list / lookup，且默认只看 Agent 技能目录。
 * - list 的 project / home / all 必须返回对应来源。
 * - lookup 必须通过标准 messages 协议注入 skill 正文，而不是自定义 payload。
 * - system prompt 只列出当前 Agent 的可用 skill，并给出自装命令。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SkillPower } from "@downcity/powers/skill";

/** 在指定根目录下创建一个最小可发现 Skill。 */
function write_skill(root, id, name, description) {
  const directory = path.join(root, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
  return directory;
}

/**
 * 创建一个包含 Agent 技能目录与 Workspace 的临时环境。
 *
 * 目录形状与真实布局一致：生命周期存储根是 `<downcity_root>/powers/skill`，
 * 因此 `base` 即 Downcity 根，Agent 技能目录是 `<base>/agents/<agent-id>/skills`。
 */
function create_fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-skill-"));
  const lifecycle_path = path.join(base, "powers", "skill");
  const agent_skill_dir = path.join(base, "agents", "agent-a", "skills");
  const workspace_path = path.join(base, "workspace");
  const home_path = path.join(base, "home");

  write_skill(agent_skill_dir, "own", "Own Skill", "agent only");
  write_skill(path.join(workspace_path, ".agents", "skills"), "proj", "Project Skill", "project only");
  write_skill(path.join(home_path, ".agents", "skills"), "home-skill", "Home Skill", "home only");

  return { base, lifecycle_path, agent_skill_dir, workspace_path, home_path };
}

/** 创建 Skill 测试所需的公开 PowerContext。 */
function create_skill_context(workspace_path, agent_id = "agent-a") {
  return {
    city: { powers: {} },
    agent: { id: agent_id, name: agent_id, description: "", instructions: [], sessions: {} },
    workspace: { id: "test-workspace", path: workspace_path, files: {}, env: {} },
    storage: { path: workspace_path, files: {} },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    abort_signal: new AbortController().signal,
  };
}

/** 启动一个已初始化 Agent 技能目录的 SkillPower。 */
async function start_power(lifecycle_storage_path) {
  const power = new SkillPower();
  await power.initialize({
    power: { id: "skill", action() {}, config_action() {} },
    config: { get: () => ({}), set: async () => {} },
    storage: { path: lifecycle_storage_path, files: {} },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {} },
    system: {
      async list_agents() { return []; },
      async list_workspaces() { return []; },
    },
  });
  return power;
}

test("SkillPower 只暴露 list 与 lookup", () => {
  assert.deepEqual(Object.keys(new SkillPower().actions).sort(), ["list", "lookup"]);
});

test("list 默认只返回当前 Agent 私有目录的 skill", async () => {
  const fixture = create_fixture();
  const power = await start_power(fixture.lifecycle_path);

  const result = await power.actions.list.execute({
    context: create_skill_context(fixture.workspace_path),
    input: {},
  });

  assert.equal(result.success, true);
  assert.equal(result.data.scope, "agent");
  assert.deepEqual(result.data.skills.map((skill) => skill.id), ["own"]);
  assert.equal(result.data.skills[0].source, "agent");
});

test("list 的 project / home / all 返回对应来源", async () => {
  const fixture = create_fixture();
  const power = await start_power(fixture.lifecycle_path);
  const context = create_skill_context(fixture.workspace_path);
  const previous_home = process.env.HOME;
  process.env.HOME = fixture.home_path;
  try {
    const project = await power.actions.list.execute({ context, input: { scope: "project" } });
    assert.deepEqual(project.data.skills.map((skill) => skill.id), ["proj"]);

    const home = await power.actions.list.execute({ context, input: { scope: "home" } });
    assert.deepEqual(home.data.skills.map((skill) => skill.id), ["home-skill"]);

    const all = await power.actions.list.execute({ context, input: { scope: "all" } });
    assert.deepEqual(
      all.data.skills.map((skill) => skill.id).sort(),
      ["home-skill", "own", "proj"],
    );
  } finally {
    if (previous_home === undefined) delete process.env.HOME;
    else process.env.HOME = previous_home;
  }
});

test("lookup 通过标准 messages 注入 skill 正文", async () => {
  const fixture = create_fixture();
  const power = await start_power(fixture.lifecycle_path);

  const result = await power.actions.lookup.execute({
    context: create_skill_context(fixture.workspace_path),
    input: { name: "own" },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.skill.id, "own");
  assert.equal(result.data.__ship, undefined);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[0].parts[0].type, "context");
  assert.equal(result.messages[0].parts[0].tag, "skill");
  assert.match(result.messages[0].parts[0].context, /# Own Skill/);
});

test("lookup 找不到 skill 时返回失败", async () => {
  const fixture = create_fixture();
  const power = await start_power(fixture.lifecycle_path);

  const result = await power.actions.lookup.execute({
    context: create_skill_context(fixture.workspace_path),
    input: { name: "missing" },
  });

  assert.equal(result.success, false);
  assert.match(result.error, /Skill not found/);
});

test("system prompt 只列出当前 Agent 的 skill 与来源", async () => {
  const fixture = create_fixture();
  const power = await start_power(fixture.lifecycle_path);

  const prompt = await power.system(create_skill_context(fixture.workspace_path));

  assert.match(prompt, /Discovered 1 skill\(s\) available to this agent/);
  assert.match(prompt, /\*\*Own Skill\*\* - agent only/);
  assert.doesNotMatch(prompt, /Project Skill/);
  assert.match(prompt, /## Agent Skill Directory/);
  assert.match(prompt, /## Extra Readable Sources/);
  assert.match(prompt, /\[project\]/);
  assert.match(prompt, /\[home\]/);
});

test("system prompt 说明安装位置与自装命令", async () => {
  const fixture = create_fixture();
  const power = await start_power(fixture.lifecycle_path);

  const prompt = await power.system(create_skill_context(fixture.workspace_path));

  // 模型必须知道技能装在哪，以及它允许自己装。
  assert.match(prompt, /\/agents\/agent-a\/skills/);
  assert.match(prompt, /Skills are installed or linked into this directory/);
  assert.match(prompt, /You may install skills here yourself/);
  // 两步安装：临时目录 + 拷进技能目录，且 npm 缓存必须重定向。
  assert.match(prompt, /npm_config_cache=/);
  assert.match(prompt, /npx -y skills add <spec> -y/);
  assert.match(prompt, /cp -R \.agents\/skills\/<skill-id> ~\/\.downcity\/agents\/<agent-id>\/skills\//);
  // 只读来源不等于可用，必须显式说明。
  assert.match(prompt, /Reading them does not make their skills available to you/);
});

test("system prompt 不再宣称 40 条上限", async () => {
  const fixture = create_fixture();
  const power = await start_power(fixture.lifecycle_path);

  const prompt = await power.system(create_skill_context(fixture.workspace_path));

  assert.doesNotMatch(prompt, /40/);
});

test("软链接的 skill 会被发现并标记来源", async () => {
  const fixture = create_fixture();
  const external = path.join(fixture.base, "external", "linked");
  write_skill(path.join(fixture.base, "external"), "linked", "Linked Skill", "external");
  fs.symlinkSync(external, path.join(fixture.agent_skill_dir, "linked"), "junction");

  const power = await start_power(fixture.lifecycle_path);
  const result = await power.actions.list.execute({
    context: create_skill_context(fixture.workspace_path),
    input: {},
  });

  const linked = result.data.skills.find((skill) => skill.id === "linked");
  assert.ok(linked, "软链接 skill 未被发现");
  assert.equal(linked.is_link, true);
  assert.equal(linked.link_target, fs.realpathSync(external));
});

test("ignore 规则同时过滤 id 与 name", async () => {
  const fixture = create_fixture();
  const power = new SkillPower({ ignore: ["own"] });
  await power.initialize({
    power: { id: "skill", action() {}, config_action() {} },
    config: { get: () => ({}), set: async () => {} },
    storage: { path: fixture.lifecycle_path, files: {} },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {} },
    system: {
      async list_agents() { return []; },
      async list_workspaces() { return []; },
    },
  });

  const result = await power.actions.list.execute({
    context: create_skill_context(fixture.workspace_path),
    input: {},
  });

  assert.deepEqual(result.data.skills, []);
});
