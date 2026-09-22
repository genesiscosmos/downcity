/** Agent 活动（Reasoning / Tool / Action）身份判定、展示语义、流式输入读取与 Activity 展开策略测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAgentActionPart, SessionAgentInteraction, SessionAgentMessagePart, SessionAgentToolPart } from "@downcity/agent";
import { chat_power_names, read_streaming_input_values, resolve_agent_action_presentation, resolve_agent_tool_identity, resolve_agent_tool_presentation, resolve_chat_power_lookup, resolve_power_state_text, select_activity_summary_part, should_auto_open_agent_activity, should_auto_open_agent_tool } from "../src/renderer/features/chat/lib/message/agent_activity_presentation.ts";
import type { AgentActivityPart, AgentActivityTone } from "../src/renderer/features/chat/types/AgentMessage.ts";

function create_tool(tool_name: string, sequence: number, input: Record<string, unknown> = {}): SessionAgentToolPart {
  return { part_id: `tool-${sequence}`, sequence, type: "tool", tool_call_id: `call-${sequence}`, tool_name, state: "completed", input };
}

function create_action(action_type: string, sequence: number, state: SessionAgentActionPart["state"] = "completed"): SessionAgentActionPart {
  return { part_id: `action-${sequence}`, sequence, type: "action", action_id: `action-${sequence}`, action_type, state, title: "Forking session messages" };
}

function create_interaction(sequence: number, status: SessionAgentInteraction["status"] = "pending"): SessionAgentInteraction {
  return { interaction_id: `interaction-${sequence}`, interaction_type: "question", status, request: { interaction_id: `interaction-${sequence}`, turn_id: "turn-1", source: { type: "execution" }, created_at: 1, title: "确认", type: "question", payload: { questions: [] } } };
}

/** 与 catalog 等价的测试用事实表；city / shell 由 City 直接注册，不在 catalog 里。 */
const power_lookup = resolve_chat_power_lookup([
  { power_id: "memory", title: "Memory" },
  { power_id: "task", title: "Task" },
  { power_id: "web", title: "Web" },
]);
const power_names = chat_power_names(power_lookup);

test("Tool 身份按白名单、Power 目录与输入契约判定，不做子串猜测", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    // 内置工具是闭集：白名单命中。
    ["read", { file_path: "src/a.ts" }, "builtin"],
    ["write", { path: "src/b.ts" }, "builtin"],
    ["edit", { filename: "src/c.ts" }, "builtin"],
    ["grep", { pattern: "TODO" }, "builtin"],
    ["find", { glob: "**/*.ts" }, "builtin"],
    ["ask_question", { title: "确认" }, "builtin"],
    // Power 目录命中：首帧就能确定身份。
    ["memory", { action: "search" }, "power"],
    ["task", { action: "list" }, "power"],
    // city / shell 不在 catalog，按输入契约判定。
    ["city", { action: "env.get" }, "power"],
    ["shell", { action: "exec" }, "power"],
    // 第三方 power 同理。
    ["custom_power", { action: "do.thing" }, "power"],
    // 都不命中：不猜语义。
    ["custom_tool", {}, "unknown"],
  ];
  for (const [tool_name, input, kind] of cases) {
    assert.equal(resolve_agent_tool_identity(create_tool(tool_name, 1, input), power_names).kind, kind, tool_name);
  }
});

test("目录未加载时仍能按输入契约识别 power，不降级成未知工具", () => {
  const identity = resolve_agent_tool_identity(create_tool("memory", 1, { action: "search" }), undefined);
  assert.equal(identity.kind, "power");
  assert.deepEqual(identity, { kind: "power", power_name: "memory", action_name: "search" });
});

test("子串相似的名字不再被误判", () => {
  // 这些名字以前会被 includes("search") / includes("question") / endsWith("_write") 抢走。
  for (const tool_name of ["research", "web_search", "questionnaire", "draft_write"]) {
    assert.equal(resolve_agent_tool_identity(create_tool(tool_name, 1), power_names).kind, "unknown", tool_name);
  }
});

/**
 * Power 行是一整句动词短语，而不是「状态 + 名字 + 动作」三段。
 *
 * 这里用与 zh/chat.json 等价的模板复现 `已{{action}}` 的拼法：
 * 状态模板吸收动作，power 名不再出现在行内。
 */
test("Power 状态文案吸收动作，不再显示 power 名", () => {
  const translate = (key: string, options?: Record<string, string>) => {
    const table: Record<string, string> = {
      "activity.power.running": "正在{{action}}",
      "activity.power.completed": "已{{action}}",
      "activity.power.failed": "{{action}}失败",
      "activity.power_call.running": "正在调用 {{name}}",
      "activity.power_call.completed": "已调用 {{name}}",
      "activity.power_call.failed": "{{name}} 调用失败",
      "activity.action_label.shell.exec": "执行命令",
      "activity.action_label.shell.session_read": "读取输出",
      "activity.action_label.memory.search": "搜索记忆",
    };
    const template = table[key];
    if (template === undefined) return key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => options?.[name] ?? "");
  };

  // 核心：一句话，且不含 power 名。
  assert.equal(resolve_power_state_text("shell", "exec", "completed", power_lookup, translate), "已执行命令");
  assert.equal(resolve_power_state_text("shell", "session_read", "running", power_lookup, translate), "正在读取输出");
  assert.equal(resolve_power_state_text("memory", "search", "completed", power_lookup, translate), "已搜索记忆");
  // 失败态说清是哪一步失败，而不是笼统的“调用失败”。
  assert.equal(resolve_power_state_text("shell", "exec", "failed", power_lookup, translate), "执行命令失败");

  // 第三方 power 没有中文标签：无法拼出句子，回退到“已调用 <power 名>”。
  assert.equal(resolve_power_state_text("custom_power", "accounts.snapshot", "completed", power_lookup, translate), "已调用 custom_power");
  // 输入未收口（还不知道要做什么）：同上回退。
  assert.equal(resolve_power_state_text("shell", "", "running", power_lookup, translate), "正在调用 Shell");
});

/**
 * 内置工具、未知工具与 Action 都不带身份文案：状态词已经是动词，主文案就是目标本身。
 * 这里锁定的是「同一件事不说两遍」——它是上一版最明显的退化。
 */
test("只有 Power 带身份，内置与未知工具的主文案就是目标", () => {
  const read = resolve_agent_tool_presentation(create_tool("read", 1, { file_path: "src/a.ts" }), power_names);
  assert.deepEqual(read.tool_identity, { kind: "builtin", tool: "read" });
  assert.equal(read.summary, "src/a.ts");

  const unknown = resolve_agent_tool_presentation(create_tool("custom_tool", 2), power_names);
  assert.deepEqual(unknown.tool_identity, { kind: "unknown", tool_name: "custom_tool" });
  assert.equal(unknown.summary, "custom_tool");
});

test("ask_question 不再回退到裸露的注册名", () => {
  // 问题标题由交互卡片完整展示，活动行再说一遍就是重复。
  assert.equal(resolve_agent_tool_presentation(create_tool("ask_question", 1, { title: "确认" }), power_names).summary, "");
});

test("Power 的 action 未收口时只有标题，没有分隔符", () => {
  const presentation = resolve_agent_tool_presentation({ ...create_tool("shell", 1), state: "input-streaming", input: undefined, input_text: "{\"act" }, power_names);
  assert.deepEqual(presentation.tool_identity, { kind: "power", power_name: "shell", action_name: "" });
  assert.equal(presentation.visual_kind, "power");
});

test("Shell 是 power，不再有独立的 shell 视觉种类", () => {
  const presentation = resolve_agent_tool_presentation(create_tool("shell", 1, { action: "exec", args: { cmd: "pnpm test" } }), power_names);
  assert.equal(presentation.visual_kind, "power");
  assert.equal(presentation.state_key, "activity.power.completed");
  // 参数进入摘要位，身份由 tool_identity 表达，不再把 power 名拼进摘要。
  assert.equal(presentation.summary, "pnpm test");
});

test("Tool 生命周期映射为状态文案与行语气", () => {
  const tool = create_tool("read", 1);
  const cases: Array<[SessionAgentToolPart["state"], string, AgentActivityTone]> = [
    ["input-streaming", "activity.read.running", "running"],
    ["ready", "activity.read.running", "running"],
    ["running", "activity.read.running", "running"],
    ["waiting-user", "activity.waiting_confirmation", "complete"],
    ["completed", "activity.read.completed", "complete"],
    ["failed", "activity.read.failed", "failed"],
  ];
  for (const [state, state_key, tone] of cases) {
    const presentation = resolve_agent_tool_presentation({ ...tool, state }, power_names);
    assert.equal(presentation.state_key, state_key);
    assert.equal(presentation.tone, tone);
  }
});

test("Power 状态词收敛为三态，不按 action 细分", () => {
  const cases: Array<[SessionAgentToolPart["state"], string]> = [
    ["running", "activity.power.running"],
    ["completed", "activity.power.completed"],
    ["failed", "activity.power.failed"],
  ];
  for (const [state, state_key] of cases) {
    assert.equal(resolve_agent_tool_presentation({ ...create_tool("memory", 1, { action: "search" }), state }, power_names).state_key, state_key);
  }
});

test("展开详情按种类给出代码、控制台与编辑对照", () => {
  const write = resolve_agent_tool_presentation(create_tool("write", 1, { file_path: "a.ts", content: "const a = 1;" }), power_names);
  assert.deepEqual(write.detail, { type: "code", text: "const a = 1;" });

  // Shell 收敛为 power 后仍保留终端形态：命令带 `$ ` 提示。
  const shell = resolve_agent_tool_presentation({ ...create_tool("shell", 2, { action: "exec", args: { cmd: "pnpm test" } }), output: { output: "ok" } }, power_names);
  assert.deepEqual(shell.detail, { type: "console", text: "$ pnpm test\nok" });

  const edit = resolve_agent_tool_presentation({ ...create_tool("edit", 3), input: { file_path: "a.ts", edits: [{ old_text: "a", new_text: "b" }, { old_text: "c", new_text: "d" }] } }, power_names);
  assert.deepEqual(edit.detail, { type: "edit", pairs: [{ old_text: "a", new_text: "b" }, { old_text: "c", new_text: "d" }] });
});

test("失败原因与展开详情相互独立", () => {
  const failed = resolve_agent_tool_presentation({ ...create_tool("read", 1), state: "failed", error: "ENOENT" }, power_names);
  assert.equal(failed.error, "ENOENT");
  assert.equal(failed.detail, null);
  assert.equal(resolve_agent_tool_presentation(create_tool("read", 1), power_names).error, "");
});

test("流式输入按字段名读取，字段名出现在内容里不误配", () => {
  const input_text = "{\"file_path\":\"src/a.ts\",\"content\":\"const key = \\\"content\\\";\\nline2";
  assert.deepEqual(read_streaming_input_values(input_text, "file_path"), ["src/a.ts"]);
  assert.deepEqual(read_streaming_input_values(input_text, "content"), ["const key = \"content\";\nline2"]);
  assert.deepEqual(read_streaming_input_values(input_text, "edits"), []);

  const write = resolve_agent_tool_presentation({ ...create_tool("write", 1), state: "input-streaming", input: undefined, input_text }, power_names);
  assert.equal(write.input_streaming, true);
  assert.equal(write.summary, "src/a.ts");
  assert.deepEqual(write.detail, { type: "code", text: "const key = \"content\";\nline2" });
});

test("流式 Edit 按出现顺序配对旧文与新文", () => {
  const input_text = "{\"file_path\":\"a.ts\",\"edits\":[{\"old_text\":\"a\",\"new_text\":\"b\"},{\"old_text\":\"c\",\"new_text\":\"d\";";
  const edit = resolve_agent_tool_presentation({ ...create_tool("edit", 1), state: "input-streaming", input: undefined, input_text }, power_names);
  assert.equal(edit.summary, "a.ts");
  assert.deepEqual(edit.detail, { type: "edit", pairs: [{ old_text: "a", new_text: "b" }, { old_text: "c", new_text: "d" }] });
});

test("只有流式 Write 与 Edit Tool 初始自动展开", () => {
  const write = create_tool("write", 1);
  const edit = create_tool("edit", 2);
  const read = create_tool("read", 3);
  assert.equal(should_auto_open_agent_tool({ ...write, state: "input-streaming" }, power_names), true);
  assert.equal(should_auto_open_agent_tool({ ...edit, state: "input-streaming" }, power_names), true);
  assert.equal(should_auto_open_agent_tool({ ...read, state: "input-streaming" }, power_names), false);
  assert.equal(should_auto_open_agent_tool({ ...write, state: "running" }, power_names), false);
  assert.equal(should_auto_open_agent_activity([{ ...edit, state: "input-streaming" }], power_names), true);
});

test("Power 从不自动展开", () => {
  const shell = create_tool("shell", 1, { action: "exec" });
  assert.equal(should_auto_open_agent_tool({ ...shell, state: "input-streaming" }, power_names), false);
  assert.equal(should_auto_open_agent_activity([{ ...shell, state: "input-streaming" }], power_names), false);
});

test("待响应 Interaction 自动展开但不锁定 Activity", () => {
  const tool = create_tool("shell", 1, { action: "exec" });
  // Interaction 不是独立 Part，而是所属 Tool 的一部分；Activity 由 Tool、Reasoning 与 Action 组成。
  const pending: AgentActivityPart[] = [{ ...tool, interactions: [create_interaction(1, "pending")] }];
  const resolved: AgentActivityPart[] = [{ ...tool, interactions: [create_interaction(1, "resolved")] }];
  assert.equal(should_auto_open_agent_activity(pending, power_names), true);
  assert.equal(should_auto_open_agent_activity(resolved, power_names), false);
});

/**
 * Interaction 现在渲染在 Tool 行的折叠内容内部，因此“单个 Tool 行”也必须能因待响应而展开。
 * `should_auto_open_agent_tool` 本身只管流式输入，不看 Interaction（只有成组的
 * `should_auto_open_agent_activity` 看），组件里补了 `|| pending`。
 * 这条用例锁住那个区别，防止以后有人以为前者已经盖住了。
 */
test("单个 Tool 行的自动展开不看 Interaction，待响应由组件层补上", () => {
  const tool = create_tool("shell", 1, { action: "exec" });
  const pending = { ...tool, interactions: [create_interaction(1, "pending")] };
  // 纯函数不负责这件事……
  assert.equal(should_auto_open_agent_tool(pending, power_names), false);
  // ……但成组路径会因为它而展开，说明这个信息在纯映射层是可读的。
  assert.equal(should_auto_open_agent_activity([pending], power_names), true);
});

test("未知 Tool 输出仍给出可展开正文", () => {
  const tool: SessionAgentMessagePart = { ...create_tool("custom_tool", 1), output: { nested: { value: "x" }, count: 2 } };
  const presentation = resolve_agent_tool_presentation(tool as SessionAgentToolPart, power_names);
  assert.deepEqual(presentation.detail, { type: "code", text: "nested: value: x\ncount: 2" });
});

test("只有内置 write / edit 带改动行数，且只在成功终态给出", () => {
  // write 的 `lines_written` 就是新增行数；它不删行。
  const write = resolve_agent_tool_presentation({ ...create_tool("write", 1, { file_path: "a.ts" }), output: { success: true, lines_written: 12 } }, power_names);
  assert.deepEqual(write.diff_stat, { additions: 12, deletions: 0 });

  // edit 逐项按 old_text / new_text 的行数相加，只算真正应用的项。
  const edit = resolve_agent_tool_presentation({
    ...create_tool("edit", 2, { file_path: "a.ts", edits: [
      { old_text: "a\nb", new_text: "c" },
      { old_text: "d", new_text: "e\nf\ng" },
      { old_text: "未应用", new_text: "未应用" },
    ] }),
    output: { success: true, applied: 2, details: [
      { index: 0, status: "applied", match_count: 1 },
      { index: 1, status: "applied", match_count: 1 },
      { index: 2, status: "not_found", match_count: 0 },
    ] },
  }, power_names);
  assert.deepEqual(edit.diff_stat, { additions: 4, deletions: 3 });
});

test("只读工具、失败、未收口与非内置工具都不给改动行数", () => {
  // 只读工具不改文件。
  for (const [name, input] of [["read", { file_path: "a.ts" }], ["grep", { pattern: "x" }], ["find", { glob: "*" }], ["ask_question", { title: "t" }]] as const) {
    assert.equal(resolve_agent_tool_presentation({ ...create_tool(name, 3, input), output: { lines_written: 5 } }, power_names).diff_stat, null, name);
  }

  // 失败没有产生任何改动。
  assert.equal(resolve_agent_tool_presentation({ ...create_tool("write", 4, { file_path: "a.ts" }), state: "failed", error: "EACCES", output: { lines_written: 5 } }, power_names).diff_stat, null);

  // 输入未收口时还不知道会写多少。
  assert.equal(resolve_agent_tool_presentation({ ...create_tool("write", 5), state: "input-streaming", input: undefined, input_text: "{\"file_path\":\"a.ts\"" }, power_names).diff_stat, null);

  // Power 的写盘与否无法从名称判定，不猜。
  assert.equal(resolve_agent_tool_presentation({ ...create_tool("shell", 6, { action: "exec" }), output: { lines_written: 5 } }, power_names).diff_stat, null);

  // 输出缺失或字段不可用时不给标签，而不是显示 +0 -0。
  assert.equal(resolve_agent_tool_presentation(create_tool("write", 7, { file_path: "a.ts" }), power_names).diff_stat, null);
  assert.equal(resolve_agent_tool_presentation({ ...create_tool("edit", 8, { file_path: "a.ts" }), output: { success: true, applied: 0, details: [] } }, power_names).diff_stat, null);

  // Action 不是文件写入。
  assert.equal(resolve_agent_action_presentation(create_action("command", 9)).diff_stat, null);
});

test("Action 类别映射为稳定视觉语义", () => {
  const cases: Array<[string, string]> = [
    ["history-fork", "fork"],
    ["context-compaction", "compaction"],
    ["command", "command"],
    ["deploy", "generic"],
  ];
  for (const [action_type, visual_kind] of cases) {
    assert.equal(resolve_agent_action_presentation(create_action(action_type, 1)).visual_kind, visual_kind);
  }
});

test("Action 没有工具身份，主文案就是标题", () => {
  const presentation = resolve_agent_action_presentation(create_action("command", 1));
  // Action 不是工具调用，因此不进入 PowerIcon 与身份文案分支。
  assert.equal(presentation.tool_identity, undefined);
});

test("Action 生命周期映射为状态文案与行语气", () => {
  const cases: Array<[SessionAgentActionPart["state"], string, AgentActivityTone]> = [
    ["running", "activity.action.running", "running"],
    ["completed", "activity.action.completed", "complete"],
    ["failed", "activity.action.failed", "failed"],
  ];
  for (const [state, state_key, tone] of cases) {
    const presentation = resolve_agent_action_presentation(create_action("command", 1, state));
    assert.equal(presentation.state_key, state_key);
    assert.equal(presentation.tone, tone);
  }
});

test("Action 摘要取标题，描述与结构化信息进入展开详情", () => {
  const presentation = resolve_agent_action_presentation({ ...create_action("context-compaction", 1), title: "Context compacted", description: "Removed 12 messages.", data: { removed: 12 } });
  assert.equal(presentation.summary, "Context compacted");
  assert.deepEqual(presentation.detail, { type: "code", text: "Removed 12 messages.\nremoved: 12" });
  assert.equal(presentation.error, "");
  assert.equal(presentation.input_streaming, false);
});

test("Action 没有描述与结构化信息时不可展开", () => {
  assert.equal(resolve_agent_action_presentation(create_action("command", 1)).detail, null);
});

test("失败的 Action 把描述当作错误原因，不重复进入详情", () => {
  const presentation = resolve_agent_action_presentation({ ...create_action("history-fork", 1, "failed"), description: "disk full", data: { target: "fork-1" } });
  assert.equal(presentation.error, "disk full");
  assert.deepEqual(presentation.detail, { type: "code", text: "target: fork-1" });
});

test("标题为空时 Action 回退为 action_type", () => {
  assert.equal(resolve_agent_action_presentation({ ...create_action("deploy", 1), title: "  " }).summary, "deploy");
});

test("Action 不触发活动组自动展开", () => {
  assert.equal(should_auto_open_agent_activity([create_action("command", 1, "running")], power_names), false);
});

test("组摘要取最后一个非 Reasoning 项，Tool 与 Action 一视同仁", () => {
  const read = create_tool("read", 1);
  const grep = create_tool("grep", 2);
  const action = create_action("history-fork", 3);
  const reasoning = { part_id: "reasoning-4", sequence: 4, type: "reasoning" as const, text: "想一下", state: "done" as const };

  assert.equal(select_activity_summary_part([read, grep]), grep);
  // Action 与 Tool 同级：它发生在后，摘要就该是它，而不是更早的 Tool。
  assert.equal(select_activity_summary_part([read, action]), action);
  assert.equal(select_activity_summary_part([action, read]), read);
  assert.equal(select_activity_summary_part([read, reasoning]), read);
});

test("组内全部为 Reasoning 或为空时，组摘要选择不抛错", () => {
  const first = { part_id: "reasoning-1", sequence: 1, type: "reasoning" as const, text: "第一步", state: "done" as const };
  const last = { part_id: "reasoning-2", sequence: 2, type: "reasoning" as const, text: "第二步", state: "done" as const };

  assert.equal(select_activity_summary_part([first, last]), last);
  assert.equal(select_activity_summary_part([]), undefined);
});

test("Action 展示信息可直接驱动活动行，不需要组件按 action_type 分支", () => {
  const presentation = resolve_agent_action_presentation(create_action("context-compaction", 1, "running"));
  assert.equal(presentation.visual_kind, "compaction");
  assert.equal(presentation.tone, "running");
  assert.equal(presentation.state_key, "activity.action.running");
});

test("Power 事实表合并 catalog 与 City 直接注册的 power", () => {
  const lookup = resolve_chat_power_lookup([{ power_id: "memory", title: "Memory", icon_url: "https://example.com/m.png" }]);
  assert.deepEqual(lookup.get("memory"), { title: "Memory", icon_url: "https://example.com/m.png" });
  // city / shell 不在 catalog，但活动行必须能给出标题与语义图标。
  assert.deepEqual(lookup.get("city"), { title: "City" });
  assert.deepEqual(lookup.get("shell"), { title: "Shell" });
});
