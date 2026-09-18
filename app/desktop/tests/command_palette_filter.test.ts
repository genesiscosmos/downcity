/** Desktop 命令面板检索与排序测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { command_result_limit, filter_and_rank, normalize_query } from "../src/renderer/features/command-palette/filter.ts";
import type { CommandContext, CommandDefinition, CommandGroupId } from "../src/renderer/features/command-palette/types.ts";

/** 一个「什么都有」的上下文，避免测试被 when 条件干扰。 */
const open_context: CommandContext = {
  sidebar_mode: "chat",
  active_workspace_id: "workspace-1",
  selection_kind: "session",
  active_session: null,
  visible_power_count: 3,
};

/** 构造一条命令，只覆盖测试关心的字段。 */
function command(id: string, title: string, group: CommandGroupId, extra: Partial<CommandDefinition> = {}): CommandDefinition {
  return { id, title, group, run: () => undefined, ...extra };
}

const sample_commands: readonly CommandDefinition[] = [
  command("nav.open-settings", "打开设置", "navigation", { order: 5, keywords: ["settings", "preferences", "设置"] }),
  command("goto.session", "切换会话…", "chat", { keywords: ["session", "chat", "会话"] }),
  command("goto.workspace", "切换 Workspace…", "goto", { keywords: ["workspace", "空间"] }),
];

test("空查询下按分组顺序排列", () => {
  // 分组顺序为 navigation → goto → chat；同分时不再回退到注册顺序。
  const result = filter_and_rank(sample_commands, "", open_context);
  assert.deepEqual(result.map((item) => item.id), ["nav.open-settings", "goto.workspace", "goto.session"]);
});

test("when 为 false 的命令被移除，enabled 为 false 的命令保留并标注", () => {
  // 显式 order 避免测试依赖中文标题的 collation 结果。
  const commands = [
    command("nav.hidden", "隐藏命令", "navigation", { when: () => false }),
    command("nav.disabled", "禁用命令", "navigation", { enabled: () => false, order: 1 }),
    command("nav.shown", "普通命令", "navigation", { order: 2 }),
  ];

  const result = filter_and_rank(commands, "", open_context);
  assert.deepEqual(result.map((item) => item.id), ["nav.disabled", "nav.shown"]);
  assert.equal(result[0].is_enabled, false);
  assert.equal(result[1].is_enabled, true);
});

test("中文子串命中标题", () => {
  const result = filter_and_rank(sample_commands, "会话", open_context);
  assert.deepEqual(result.map((item) => item.id), ["goto.session"]);
});

test("英文关键词命中非标题文本", () => {
  const result = filter_and_rank(sample_commands, "session", open_context);
  assert.deepEqual(result.map((item) => item.id), ["goto.session"]);
});

test("多 token 取 AND 语义", () => {
  assert.deepEqual(
    filter_and_rank(sample_commands, "打开 设置", open_context).map((item) => item.id),
    ["nav.open-settings"],
  );
  assert.deepEqual(filter_and_rank(sample_commands, "打开 主题", open_context), []);
});

test("标题命中的档位优先于关键词命中", () => {
  const commands = [
    command("nav.keyword-only", "刷新模型目录", "navigation", { keywords: ["设置"] }),
    command("nav.title-hit", "设置", "navigation"),
  ];

  const result = filter_and_rank(commands, "设置", open_context);
  assert.deepEqual(result.map((item) => item.id), ["nav.title-hit", "nav.keyword-only"]);
});

test("分组标签参与检索", () => {
  const commands = [command("nav.plain", "刷新模型目录", "account")];
  assert.deepEqual(filter_and_rank(commands, "账户", open_context).map((item) => item.id), []);
  assert.deepEqual(
    filter_and_rank(commands, "账户", open_context, { account: "账户与模型" }).map((item) => item.id),
    ["nav.plain"],
  );
});

test("同分时按分组顺序、order、标题稳定排序", () => {
  const commands = [
    command("account.b", "B", "account", { order: 1 }),
    command("navigation.b", "B", "navigation", { order: 1 }),
    command("navigation.a", "A", "navigation", { order: 1 }),
    command("navigation.c", "C", "navigation", { order: 0 }),
  ];

  const result = filter_and_rank(commands, "", open_context);
  assert.deepEqual(result.map((item) => item.id), ["navigation.c", "navigation.a", "navigation.b", "account.b"]);
});

test("相同输入返回相同输出", () => {
  const first = filter_and_rank(sample_commands, "切", open_context);
  const second = filter_and_rank(sample_commands, "切", open_context);
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
});

test("结果超过上限时截断", () => {
  const commands = Array.from({ length: command_result_limit + 25 }, (_, index) =>
    command(`navigation.bulk-${index}`, `批量命令 ${index}`, "navigation"),
  );

  assert.equal(filter_and_rank(commands, "", open_context).length, command_result_limit);
});

test("空注册表返回空数组且不抛错", () => {
  assert.deepEqual(filter_and_rank([], "任意查询", open_context), []);
});

test("子序列匹配支持跳字符，且不匹配单字符查询", () => {
  const commands = [command("nav.settings", "打开设置", "navigation")];
  assert.deepEqual(filter_and_rank(commands, "打置", open_context).map((item) => item.id), ["nav.settings"]);
  assert.deepEqual(filter_and_rank(commands, "置打", open_context), []);
});

test("查询规范化：大小写不敏感、忽略首尾与重复空白", () => {
  assert.deepEqual(normalize_query("  Open   Settings  "), ["open", "settings"]);
  const commands = [command("nav.settings", "打开设置", "navigation", { keywords: ["Open Settings"] })];
  assert.deepEqual(filter_and_rank(commands, "  OPEN settings ", open_context).map((item) => item.id), ["nav.settings"]);
});
