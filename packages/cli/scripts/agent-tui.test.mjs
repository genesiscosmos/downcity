/**
 * Agent Chat TUI 视觉组件与 transcript 导航回归测试。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { AgentHeaderComponent } from "../bin/city/agent/tui/components/AgentHeader.js";
import { AssistantMessageComponent } from "../bin/city/agent/tui/components/AssistantMessage.js";
import { ChatFooterComponent } from "../bin/city/agent/tui/components/ChatFooter.js";
import { CommandHelpPanelComponent } from "../bin/city/agent/tui/components/CommandHelpPanel.js";
import { InlinePanelSlotComponent } from "../bin/city/agent/tui/components/InlinePanelSlot.js";
import { MessageListComponent } from "../bin/city/agent/tui/components/MessageList.js";
import { QueuedMessagesComponent } from "../bin/city/agent/tui/components/QueuedMessages.js";
import { ToolCallBlockComponent } from "../bin/city/agent/tui/components/ToolCallBlock.js";
import { UserMessageComponent } from "../bin/city/agent/tui/components/UserMessage.js";
import { resolve_transcript_scroll_delta } from "../bin/city/agent/tui/controllers/TranscriptNavigation.js";
import { QueuedInputQueue } from "../bin/city/agent/tui/controllers/QueuedInputQueue.js";
import { PiTuiChatRenderer } from "../bin/city/agent/tui/PiTuiChatRenderer.js";
import { ApprovalPanelComponent } from "../bin/city/agent/tui/dialogs/ApprovalDialog.js";
import { SessionPickerComponent } from "../bin/city/agent/tui/dialogs/SessionPicker.js";
import { resolveSlashCommandInput } from "../bin/city/agent/tui/commands/resolve.js";

// oxlint-disable-next-line no-control-regex -- 测试需要移除 ANSI SGR 颜色序列。
const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function plain(lines) {
  return lines.map((line) => line.replace(ANSI_SGR, ""));
}

test("transcript 导航同时识别分页键和鼠标滚轮", () => {
  assert.equal(resolve_transcript_scroll_delta("\u001B[5~", 12), 12);
  assert.equal(resolve_transcript_scroll_delta("\u001B[6~", 12), -12);
  assert.equal(resolve_transcript_scroll_delta("\u001B[<64;20;8M", 12), 3);
  assert.equal(resolve_transcript_scroll_delta("\u001B[<65;20;8M", 12), -3);
  assert.equal(resolve_transcript_scroll_delta("a", 12), null);
});

test("执行中输入队列按 FIFO 消费，并允许用 ↑ 召回最新消息", () => {
  const input_queue = new QueuedInputQueue();
  input_queue.enqueue("first queued message");
  input_queue.enqueue("second queued message");
  input_queue.enqueue("third queued message");

  assert.equal(input_queue.count, 3);
  assert.equal(input_queue.recall_latest()?.text, "third queued message");
  assert.equal(input_queue.take_next()?.text, "first queued message");
  assert.equal(input_queue.take_next()?.text, "second queued message");
  assert.equal(input_queue.count, 0);
});

test("排队消息组件显示数量、最新预览与召回提示", () => {
  const input_queue = new QueuedInputQueue();
  for (let index = 1; index <= 4; index += 1) {
    input_queue.enqueue(`queued message ${index}`);
  }
  const queued_messages = new QueuedMessagesComponent();
  queued_messages.set_queued_inputs(input_queue.items);

  const rendered = plain(queued_messages.render(40)).join("\n");
  assert.match(rendered, /Queued · 4/);
  assert.match(rendered, /… 1 earlier message/);
  assert.doesNotMatch(rendered, /> queued message 1/);
  assert.match(rendered, /> queued message 4/);
  assert.match(rendered, /↑ edit latest queued message/);
  assert.ok(queued_messages.render(24).every((line) => visibleWidth(line) <= 24));
});

test("MessageList 可以离开底部查看历史并重新返回最新消息", () => {
  const scroll_offsets = [];
  const message_list = new MessageListComponent({
    get_viewport_height: () => 4,
    on_scroll_change: (scroll_offset) => scroll_offsets.push(scroll_offset),
  });
  for (let index = 1; index <= 8; index += 1) {
    message_list.add_entry({
      id: `status-${index}`,
      kind: "status",
      text: `status ${index}`,
      created_at: index,
    });
  }

  const latest = plain(message_list.render(48)).join("\n");
  assert.match(latest, /status 8/);
  assert.doesNotMatch(latest, /status 1/);

  message_list.scroll_by(4);
  const history = plain(message_list.render(48)).join("\n");
  assert.match(history, /status 1/);
  assert.doesNotMatch(history, /status 8/);
  assert.ok(message_list.current_scroll_offset > 0);

  message_list.scroll_to_bottom();
  assert.match(plain(message_list.render(48)).join("\n"), /status 8/);
  assert.equal(message_list.current_scroll_offset, 0);
  assert.ok(scroll_offsets.some((offset) => offset > 0));
});

test("角色消息和工具执行块保持稳定层级且不超过可用宽度", () => {
  const user = plain(new UserMessageComponent("Inspect this project").render(48));
  assert.equal(user[1], "You");
  assert.match(user[2], /^  Inspect this project/);

  const assistant_component = new AssistantMessageComponent(true, true);
  assistant_component.update_content("I am checking the build.", true);
  const assistant = plain(assistant_component.render(48));
  assert.match(assistant.join("\n"), /Assistant · .* working/);

  const tool = new ToolCallBlockComponent({
    id: "tool-1",
    kind: "tool-call",
    tool_call_id: "call-1",
    tool_name: "shell_exec",
    args: { cmd: "pnpm typecheck" },
    status: "pending",
    created_at: 1,
  });
  const tool_lines = tool.render(48);
  assert.match(plain(tool_lines).join("\n"), /Tool · shell_exec/);
  assert.ok(plain(tool_lines).some((line) => line.startsWith("┌")));
  assert.ok(plain(tool_lines).some((line) => line.startsWith("└")));
  assert.ok(plain(tool_lines).find((line) => line.startsWith("┌"))?.endsWith("┐"));
  assert.ok(tool_lines.every((line) => visibleWidth(line) <= 48));

  const narrow_tool_lines = plain(tool.render(24));
  assert.ok(narrow_tool_lines.find((line) => line.startsWith("┌"))?.endsWith("┐"));
});

test("Turn 启动后立即在消息流显示 Assistant working，并在结束后移除", () => {
  const message_list = new MessageListComponent({
    get_viewport_height: () => 30,
  });
  const renderer = new PiTuiChatRenderer(message_list, () => {});

  renderer.start_turn();
  assert.match(plain(message_list.render(80)).join("\n"), /Assistant · .* working/);

  renderer.finish_turn();
  assert.doesNotMatch(plain(message_list.render(80)).join("\n"), /working/);
});

test("tool 输入从流式占位更新为完整参数且不重复创建卡片", () => {
  const message_list = new MessageListComponent({
    get_viewport_height: () => 30,
  });
  const renderer = new PiTuiChatRenderer(message_list, () => {});
  renderer.start_turn();
  renderer.attach_turn_id("turn-streaming-input");

  const base_event = {
    message_id: "assistant-streaming-input",
    session_id: "session-1",
    turn_id: "turn-streaming-input",
    created_at: 1,
    variant: "part",
    type: "tool",
    part_id: "tool:call-streaming-input",
  };
  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-input-start",
    revision: 1,
    part: {
      part_id: "tool:call-streaming-input",
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "input-streaming",
      input_text: "",
    },
  });

  const preparing = plain(message_list.render(80)).join("\n");
  assert.match(preparing, /preparing arguments\.\.\./);
  assert.doesNotMatch(preparing, /no arguments/);

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-input-ready",
    revision: 2,
    part: {
      part_id: "tool:call-streaming-input",
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "ready",
      input: {
        cmd: "ls -la ~/Desktop",
        sandbox: "unrestricted",
        reason: "Inspect the requested desktop files",
      },
    },
  });

  const ready = plain(message_list.render(80)).join("\n");
  assert.equal((ready.match(/Tool · shell_exec/g) || []).length, 1);
  assert.match(ready, /cmd: ls -la ~\/Desktop/);
  assert.match(ready, /sandbox: unrestricted/);
  assert.match(ready, /reason: Inspect the requested desktop files/);
  assert.doesNotMatch(ready, /preparing arguments/);

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-approval-required",
    revision: 3,
    part: {
      part_id: "tool:call-streaming-input",
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "approval-required",
      approval: {
        approval_id: "approval-streaming-input",
        session_id: "session-1",
        turn_id: "turn-streaming-input",
        tool_call_id: "call-streaming-input",
        tool_name: "shell_exec",
        command: "ls -la ~/Desktop",
        cwd: "/workspace",
        reason: "Inspect the requested desktop files",
        operation: "exec",
        created_at: 1,
        expires_at: 60_001,
      },
      input: {
        cmd: "ls -la ~/Desktop",
        sandbox: "unrestricted",
        reason: "Inspect the requested desktop files",
      },
    },
  });

  const approval_required = plain(message_list.render(80)).join("\n");
  assert.equal((approval_required.match(/Tool · shell_exec/g) || []).length, 1);
  assert.match(approval_required, /approval required · approval-streaming-input/);
  assert.match(approval_required, /cmd: ls -la ~\/Desktop/);
});

test("Header 与 Footer 在宽屏和窄屏下保持上下文与操作层级", () => {
  const app_state = {
    agent_id: "demo",
    session_id: "session-123456789",
    session_title: "Build diagnostics",
    is_executing: false,
    queued_message_count: 0,
    transcript_scroll_offset: 0,
  };
  const header = new AgentHeaderComponent(app_state);
  const footer = new ChatFooterComponent(app_state);

  for (const width of [96, 48, 24]) {
    const header_lines = header.render(width);
    const footer_lines = footer.render(width);
    assert.ok([...header_lines, ...footer_lines].every((line) => visibleWidth(line) <= width));
    assert.match(plain(header_lines).join("\n"), /DOWNCITY AGENT/);
  }

  app_state.transcript_scroll_offset = 9;
  footer.set_state(app_state);
  assert.match(plain(footer.render(48)).join("\n"), /HISTORY · 9 lines/);

  app_state.transcript_scroll_offset = 0;
  app_state.is_executing = true;
  app_state.queued_message_count = 2;
  footer.set_state(app_state);
  assert.match(plain(footer.render(96)).join("\n"), /Enter queue · 2 queued/);
});

test("审批 part 展示请求详情且 Esc 按安全语义拒绝", () => {
  const message_list = new MessageListComponent({
    get_viewport_height: () => 20,
  });
  let approval_request;
  const renderer = new PiTuiChatRenderer(
    message_list,
    () => {},
    (request) => {
      approval_request = request;
    },
  );
  renderer.start_turn();
  renderer.attach_turn_id("turn-1");
  renderer.render_event({
    mutation_id: "mutation-1",
    message_id: "assistant-1",
    revision: 2,
    session_id: "session-1",
    turn_id: "turn-1",
    created_at: 1,
    variant: "part",
    type: "tool",
    part_id: "tool:call-1",
    part: {
      part_id: "tool:call-1",
      type: "tool",
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      state: "approval-required",
      approval: {
        approval_id: "approval-1",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_call_id: "call-1",
        tool_name: "shell_exec",
        command: "rm -rf build",
        cwd: "/workspace",
        reason: "Clean generated output",
        operation: "exec",
        created_at: 1,
        expires_at: 60_001,
      },
      input: {
        cmd: "rm -rf build",
        workdir: "/workspace",
        reason: "Clean generated output",
      },
    },
  });

  assert.deepEqual(approval_request, {
    approval_id: "approval-1",
    tool_name: "shell_exec",
    cmd: "rm -rf build",
    cwd: "/workspace",
    reason: "Clean generated output",
  });
  assert.match(
    plain(message_list.render(64)).join("\n"),
    /approval required · approval-1/,
  );

  let decision;
  const dialog = new ApprovalPanelComponent({
    ...approval_request,
    on_decide: (next_decision) => {
      decision = next_decision;
    },
  });
  dialog.handleInput("\u001B");
  assert.equal(decision, "deny");
});

test("执行期间保留审批命令提交能力并阻止破坏性 Slash 命令", () => {
  assert.equal(
    resolveSlashCommandInput({ input: "/approve ap_1", is_streaming: true }).kind,
    "builtin",
  );
  assert.equal(
    resolveSlashCommandInput({ input: "/deny ap_1", is_streaming: true }).kind,
    "builtin",
  );
  assert.equal(
    resolveSlashCommandInput({ input: "/clear", is_streaming: true }).kind,
    "blocked",
  );
  assert.equal(
    resolveSlashCommandInput({ input: "/model", is_streaming: true }).kind,
    "message",
  );
});

test("内联槽位空闲时不占高度并把输入转交给下方面板", () => {
  const slot = new InlinePanelSlotComponent();
  assert.deepEqual(slot.render(64), []);

  let closed = false;
  slot.show(new CommandHelpPanelComponent(() => {
    closed = true;
    slot.clear();
  }));
  assert.match(plain(slot.render(64)).join("\n"), /Slash commands/);
  slot.handleInput("\u001B");
  assert.equal(closed, true);
  assert.deepEqual(slot.render(64), []);
});

test("Session Picker 在输入框下方保持搜索和选择能力", () => {
  const slot = new InlinePanelSlotComponent();
  let selected_session;
  slot.show(new SessionPickerComponent({
    sessions: [{
      session_id: "session-2",
      title: "Second session",
      message_count: 2,
      executing: false,
    }],
    current_session_id: "default",
    on_select: (result) => {
      selected_session = result;
    },
    on_cancel: () => {},
  }));
  for (const character of "second") slot.handleInput(character);
  assert.match(plain(slot.render(64)).join("\n"), /Search: second/);
  slot.handleInput("\r");
  assert.deepEqual(selected_session, { kind: "session", session_id: "session-2" });
});
