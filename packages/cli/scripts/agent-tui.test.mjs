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
import { ToolActivityComponent } from "../bin/city/agent/tui/components/ToolActivity.js";
import { UserMessageComponent } from "../bin/city/agent/tui/components/UserMessage.js";
import { resolve_transcript_scroll_delta } from "../bin/city/agent/tui/controllers/TranscriptNavigation.js";
import { QueuedInputQueue } from "../bin/city/agent/tui/controllers/QueuedInputQueue.js";
import { PiTuiChatRenderer } from "../bin/city/agent/tui/PiTuiChatRenderer.js";
import { ApprovalPanelComponent } from "../bin/city/agent/tui/dialogs/ApprovalDialog.js";
import { QuestionPanelComponent } from "../bin/city/agent/tui/dialogs/QuestionDialog.js";
import { SecurityPolicyPanelComponent } from "../bin/city/agent/tui/dialogs/SecurityPolicyDialog.js";
import { SessionPickerComponent } from "../bin/city/agent/tui/dialogs/SessionPicker.js";
import { resolveSlashCommandInput } from "../bin/city/agent/tui/commands/resolve.js";

// oxlint-disable-next-line no-control-regex -- 测试需要移除 ANSI SGR 颜色序列。
const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function plain(lines) {
  return lines.map((line) => line.replace(ANSI_SGR, ""));
}

function create_assistant_message(overrides = {}) {
  return {
    message_id: "assistant-default",
    session_id: "session-default",
    turn_id: "turn-default",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "assistant",
    kind: "normal",
    status: "streaming",
    parts: [],
    ...overrides,
  };
}

function create_assistant_message_event(message, mutation_id = "assistant-message") {
  return {
    mutation_id,
    session_id: message.session_id,
    turn_id: message.turn_id,
    created_at: message.updated_at,
    variant: "message",
    type: "assistant",
    message_id: message.message_id,
    sequence: message.sequence,
    revision: message.revision,
    message,
  };
}

test("transcript 导航使用键盘且不消费终端鼠标事件", () => {
  assert.equal(resolve_transcript_scroll_delta("\u001B[5~", 12), 12);
  assert.equal(resolve_transcript_scroll_delta("\u001B[6~", 12), -12);
  assert.equal(resolve_transcript_scroll_delta("\u001B[<64;20;8M", 12), null);
  assert.equal(resolve_transcript_scroll_delta("\u001B[<65;20;8M", 12), null);
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
    message_list.add_notice({
      id: `status-${index}`,
      kind: "local-status",
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

test("角色消息和 Assistant 内 Tool Call 保持稳定层级且不超过可用宽度", () => {
  const user = plain(new UserMessageComponent("Inspect this project").render(48));
  assert.equal(user[1], "You");
  assert.match(user[2], /^  Inspect this project/);

  const assistant_component = new AssistantMessageComponent({
    message_id: "assistant-component",
    session_id: "session-component",
    turn_id: "turn-component",
    sequence: 1,
    status: "streaming",
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "assistant",
    kind: "normal",
    parts: [{
      part_id: "text-1",
      sequence: 1,
      type: "text",
      text: "I am checking the build.",
      state: "streaming",
    }],
  });
  const assistant = plain(assistant_component.render(48));
  assert.match(assistant.join("\n"), /Assistant · .* working/);

  const tool = new ToolActivityComponent({
    part_id: "tool:call-1",
    sequence: 1,
    type: "tool",
    tool_call_id: "call-1",
    tool_name: "shell_exec",
    state: "running",
    input: { cmd: "pnpm typecheck", cwd: "/workspace" },
  });
  const tool_lines = tool.render(48);
  const rendered_tool = plain(tool_lines).join("\n");
  assert.match(rendered_tool, /Tool · shell_exec · Running/);
  assert.match(rendered_tool, /command\s+pnpm typecheck/);
  assert.match(rendered_tool, /cwd\s+\/workspace/);
  assert.doesNotMatch(plain(tool_lines).join("\n"), /[┌└│]/);
  assert.ok(tool_lines.every((line) => visibleWidth(line) <= 48));

  const narrow_tool_lines = plain(tool.render(24));
  assert.ok(narrow_tool_lines.every((line) => visibleWidth(line) <= 24));
});

test("canonical Assistant Message 的完整快照直接驱动 working 与终态", () => {
  const message_list = new MessageListComponent({
    get_viewport_height: () => 30,
  });
  const renderer = new PiTuiChatRenderer(message_list, () => {});

  renderer.start_turn();
  assert.equal(plain(message_list.render(80)).join("\n"), "");
  renderer.render_event({
    mutation_id: "user-start",
    session_id: "session-start",
    turn_id: "turn-start",
    created_at: 1,
    variant: "message",
    type: "user",
    message_id: "user-start",
    sequence: 1,
    revision: 1,
    message: {
      message_id: "user-start",
      session_id: "session-start",
      turn_id: "turn-start",
      sequence: 1,
      revision: 1,
      visibility: "visible",
      created_at: 1,
      updated_at: 1,
      type: "user",
      input_type: "prompt",
      parts: [{
        part_id: "user-text",
        type: "text",
        text: "Inspect the project",
        state: "done",
      }],
    },
  });
  assert.match(plain(message_list.render(80)).join("\n"), /You[\s\S]*Inspect the project/);
  const streaming_message = create_assistant_message({
    message_id: "assistant-start",
    session_id: "session-start",
    turn_id: "turn-start",
    sequence: 2,
    revision: 1,
  });
  renderer.render_event(create_assistant_message_event(streaming_message));
  assert.match(plain(message_list.render(80)).join("\n"), /Assistant · .* working/);

  renderer.render_event(create_assistant_message_event({
    ...streaming_message,
    revision: 2,
    updated_at: 2,
    status: "completed",
  }, "assistant-completed"));
  renderer.finish_turn();
  assert.doesNotMatch(plain(message_list.render(80)).join("\n"), /working/);
});

test("历史 Tool Call 保留 canonical Assistant 所有权且不展示 output", () => {
  const messages = [create_assistant_message({
    message_id: "assistant-history",
    session_id: "session-history",
    turn_id: "turn-history",
    sequence: 1,
    revision: 2,
    visibility: "visible",
    created_at: 1,
    updated_at: 2,
    status: "completed",
    parts: [{
      part_id: "tool:history-read",
      sequence: 1,
      type: "tool",
      tool_call_id: "history-read",
      tool_name: "read",
      state: "completed",
      input: { file_path: "/workspace/README.md" },
      output: { content: "HISTORY OUTPUT MUST STAY HIDDEN" },
    }],
  })];

  const message_list = new MessageListComponent({
    get_viewport_height: () => 20,
  });
  message_list.set_messages(messages);
  const rendered = plain(message_list.render(80)).join("\n");
  assert.match(rendered, /Assistant/);
  assert.match(rendered, /Tool · read · Completed/);
  assert.match(rendered, /path\s+\/workspace\/README\.md/);
  assert.doesNotMatch(rendered, /HISTORY OUTPUT MUST STAY HIDDEN/);
});

test("Text → Tool → Text 保持一个 Assistant 容器和 canonical Part 顺序", () => {
  const messages = [{
    message_id: "user-order",
    session_id: "session-order",
    turn_id: "turn-order",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "user",
    input_type: "prompt",
    parts: [{
      part_id: "user-text",
      type: "text",
      text: "Inspect the build",
      state: "done",
    }],
  }, create_assistant_message({
    message_id: "assistant-order",
    session_id: "session-order",
    turn_id: "turn-order",
    sequence: 2,
    revision: 4,
    visibility: "visible",
    created_at: 2,
    updated_at: 4,
    status: "completed",
    parts: [{
      part_id: "text-before",
      sequence: 1,
      type: "text",
      text: "I will inspect it.",
      state: "done",
    }, {
      part_id: "tool:order",
      sequence: 2,
      type: "tool",
      tool_call_id: "order",
      tool_name: "shell_exec",
      state: "completed",
      input: { cmd: "pnpm typecheck", cwd: "/workspace" },
      output: { stdout: "HIDDEN ORDER OUTPUT" },
    }, {
      part_id: "text-after",
      sequence: 3,
      type: "text",
      text: "The build is clean.",
      state: "done",
    }],
  })];
  assert.equal(messages.length, 2);

  const message_list = new MessageListComponent({
    get_viewport_height: () => 30,
  });
  message_list.set_messages(messages);
  const rendered = plain(message_list.render(96)).join("\n");
  const user_index = rendered.indexOf("You");
  const assistant_index = rendered.indexOf("Assistant");
  const first_text_index = rendered.indexOf("I will inspect it.");
  const tool_index = rendered.indexOf("Tool · shell_exec · Completed");
  const second_text_index = rendered.indexOf("The build is clean.");

  assert.ok(user_index >= 0 && user_index < assistant_index);
  assert.ok(assistant_index < first_text_index);
  assert.ok(first_text_index < tool_index);
  assert.ok(tool_index < second_text_index);
  assert.equal((rendered.match(/Assistant/g) || []).length, 1);
  assert.doesNotMatch(rendered, /HIDDEN ORDER OUTPUT/);
});

test("Assistant 内 Tool Call 跟随 canonical 六态更新且不展示 JSON 与 output", () => {
  const message_list = new MessageListComponent({
    get_viewport_height: () => 30,
  });
  const renderer = new PiTuiChatRenderer(message_list, () => {});
  renderer.start_turn();
  renderer.attach_turn_id("turn-streaming-input");
  renderer.render_event(create_assistant_message_event(create_assistant_message({
    message_id: "assistant-streaming-input",
    session_id: "session-1",
    turn_id: "turn-streaming-input",
  }), "mutation-assistant-create"));

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
    revision: 2,
    part: {
      part_id: "tool:call-streaming-input",
      sequence: 1,
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "input-streaming",
      input_text: "",
    },
  });

  const preparing = plain(message_list.render(80)).join("\n");
  assert.match(preparing, /Assistant · .* working/);
  assert.match(preparing, /Tool · shell_exec · Preparing input/);

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-input-ready",
    revision: 3,
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
  assert.equal((ready.match(/ls -la ~\/Desktop/g) || []).length, 1);
  assert.match(ready, /Tool · shell_exec · Ready/);
  assert.match(ready, /command\s+ls -la ~\/Desktop/);
  assert.doesNotMatch(ready, /sandbox/);
  assert.doesNotMatch(ready, /Inspect the requested desktop files/);

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-waiting-user",
    revision: 4,
    part: {
      part_id: "tool:call-streaming-input",
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "waiting-user",
      input: {
        cmd: "ls -la ~/Desktop",
        sandbox: "unrestricted",
        reason: "Inspect the requested desktop files",
      },
    },
  });
  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-interaction",
    revision: 5,
    type: "interaction",
    part_id: "interaction:approval-streaming-input",
    part: {
      part_id: "interaction:approval-streaming-input",
      sequence: 2,
      type: "interaction",
      interaction_id: "approval-streaming-input",
      interaction_type: "approval",
      status: "pending",
      request: {
        interaction_id: "approval-streaming-input",
        turn_id: "turn-streaming-input",
        kind: "approval",
        source: {
          type: "tool",
          tool_call_id: "call-streaming-input",
          tool_name: "shell_exec",
        },
        title: "Approve shell_exec",
        command: "ls -la ~/Desktop",
        cwd: "/workspace",
        reason: "Inspect the requested desktop files",
        operation: "exec",
        created_at: 1,
        expires_at: 60_001,
      },
    },
  });

  const approval_required = plain(message_list.render(80)).join("\n");
  assert.equal((approval_required.match(/ls -la ~\/Desktop/g) || []).length, 1);
  assert.match(approval_required, /Assistant · waiting for you/);
  assert.match(approval_required, /Tool · shell_exec · Waiting for approval/);
  assert.match(approval_required, /command\s+ls -la ~\/Desktop/);
  assert.doesNotMatch(approval_required, /approval-streaming-input/);

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-running",
    revision: 6,
    part: {
      part_id: "tool:call-streaming-input",
      sequence: 1,
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "running",
      input: { cmd: "ls -la ~/Desktop" },
    },
  });
  assert.match(
    plain(message_list.render(80)).join("\n"),
    /Tool · shell_exec · Running[\s\S]*command\s+ls -la ~\/Desktop/,
  );

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-completed",
    revision: 7,
    part: {
      part_id: "tool:call-streaming-input",
      sequence: 1,
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "completed",
      input: { cmd: "ls -la ~/Desktop" },
      output: { stdout: "THIS OUTPUT MUST STAY HIDDEN" },
    },
  });

  const completed = plain(message_list.render(80)).join("\n");
  assert.match(completed, /Tool · shell_exec · Completed/);
  assert.match(completed, /command\s+ls -la ~\/Desktop/);
  assert.doesNotMatch(completed, /THIS OUTPUT MUST STAY HIDDEN/);

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-stale-running",
    revision: 6,
    part: {
      part_id: "tool:call-streaming-input",
      sequence: 1,
      type: "tool",
      tool_call_id: "call-streaming-input",
      tool_name: "shell_exec",
      state: "running",
      input: { cmd: "stale command" },
    },
  });
  const after_stale_mutation = plain(message_list.render(80)).join("\n");
  assert.match(after_stale_mutation, /Tool · shell_exec · Completed/);
  assert.doesNotMatch(after_stale_mutation, /stale command/);

  renderer.render_event({
    ...base_event,
    mutation_id: "mutation-failed",
    revision: 8,
    part_id: "tool:call-failed",
    part: {
      part_id: "tool:call-failed",
      sequence: 2,
      type: "tool",
      tool_call_id: "call-failed",
      tool_name: "read",
      state: "failed",
      input: { file_path: "/workspace/package.json" },
      error: "PRIVATE FAILURE DETAILS",
    },
  });
  const failed = plain(message_list.render(80)).join("\n");
  assert.match(failed, /Tool · read · Failed/);
  assert.match(failed, /path\s+\/workspace\/package.json/);
  assert.doesNotMatch(failed, /PRIVATE FAILURE DETAILS/);
});

test("Header 与 Footer 在宽屏和窄屏下保持上下文与操作层级", () => {
  const app_state = {
    agent_id: "demo",
    session_id: "session-123456789",
    security: {
      approval_mode: "ask",
      effective_approval_mode: "ask",
    },
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
  assert.match(plain(header.render(96)).join("\n"), /Security: Default/);

  app_state.security = {
    approval_mode: "always-allow",
    effective_approval_mode: "ask",
  };
  header.set_state(app_state);
  assert.match(plain(header.render(96)).join("\n"), /Security: Always Allow/);
  assert.match(plain(header.render(96)).join("\n"), /queued/);

  app_state.security.effective_approval_mode = "always-allow";
  header.set_state(app_state);
  assert.doesNotMatch(plain(header.render(96)).join("\n"), /queued/);

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
  renderer.render_event(create_assistant_message_event(create_assistant_message({
    message_id: "assistant-1",
    session_id: "session-1",
    turn_id: "turn-1",
  }), "mutation-assistant-1"));
  renderer.render_event({
    mutation_id: "mutation-tool-1",
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
      sequence: 1,
      type: "tool",
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      state: "waiting-user",
      input: {
        cmd: "rm -rf build",
        workdir: "/workspace",
        reason: "Clean generated output",
      },
    },
  });
  renderer.render_event({
    mutation_id: "mutation-1",
    message_id: "assistant-1",
    revision: 3,
    session_id: "session-1",
    turn_id: "turn-1",
    created_at: 1,
    variant: "part",
    type: "interaction",
    part_id: "interaction:approval-1",
    part: {
      part_id: "interaction:approval-1",
      sequence: 2,
      type: "interaction",
      interaction_id: "approval-1",
      interaction_type: "approval",
      status: "pending",
      request: {
        interaction_id: "approval-1",
        turn_id: "turn-1",
        kind: "approval",
        source: {
          type: "tool",
          tool_call_id: "call-1",
          tool_name: "shell_exec",
        },
        title: "Approve shell_exec",
        command: "rm -rf build",
        cwd: "/workspace",
        reason: "Clean generated output",
        operation: "exec",
        created_at: 1,
        expires_at: 60_001,
      },
    },
  });

  assert.equal(approval_request.kind, "approval");
  assert.equal(approval_request.interaction_id, "approval-1");
  assert.equal(approval_request.source.tool_name, "shell_exec");
  assert.match(
    plain(message_list.render(64)).join("\n"),
    /Assistant · waiting for you[\s\S]*Tool · shell_exec · Waiting for approval[\s\S]*command\s+rm -rf build/,
  );

  let decision;
  const dialog = new ApprovalPanelComponent({
    approval_id: approval_request.interaction_id,
    tool_name: approval_request.source.tool_name,
    cmd: approval_request.command,
    cwd: approval_request.cwd,
    reason: approval_request.reason,
    on_decide: (next_decision) => {
      decision = next_decision;
    },
  });
  dialog.handleInput("\u001B");
  assert.equal(decision, "deny");
});

test("Question Interaction 逐项收集文本、单选和多选答案", () => {
  const request = {
    interaction_id: "question-1",
    turn_id: "turn-1",
    kind: "question",
    source: {
      type: "tool",
      tool_call_id: "call-question-1",
      tool_name: "ask_question",
    },
    title: "Project settings",
    questions: [
      {
        question_id: "name",
        prompt: "Project name?",
        response_type: "text",
      },
      {
        question_id: "runtime",
        prompt: "Choose runtime",
        response_type: "single_select",
        options: [
          { value: "node", label: "Node.js" },
          { value: "bun", label: "Bun" },
        ],
      },
      {
        question_id: "features",
        prompt: "Choose features",
        response_type: "multi_select",
        options: [
          { value: "lint", label: "Lint" },
          { value: "test", label: "Test" },
        ],
      },
    ],
    created_at: 1,
  };
  let answers;
  let cancelled = false;
  const panel = new QuestionPanelComponent({
    request,
    on_submit: (value) => {
      answers = value;
    },
    on_cancel: () => {
      cancelled = true;
    },
  });
  panel.focused = true;

  assert.match(plain(panel.render(64)).join("\n"), /Project settings · 1\/3/);
  panel.handleInput("Downcity");
  panel.handleInput("\r");
  panel.handleInput("\u001B[B");
  panel.handleInput("\r");
  panel.handleInput(" ");
  panel.handleInput("\u001B[B");
  panel.handleInput(" ");
  panel.handleInput("\r");

  assert.deepEqual(answers, [
    { question_id: "name", value: "Downcity" },
    { question_id: "runtime", value: "bun" },
    { question_id: "features", value: ["lint", "test"] },
  ]);
  assert.equal(cancelled, false);
  assert.ok(panel.render(32).every((line) => visibleWidth(line) <= 32));
});

test("Question Interaction 由 Renderer 原样转交通用回调", () => {
  const message_list = new MessageListComponent({
    get_viewport_height: () => 20,
  });
  let received_request;
  const renderer = new PiTuiChatRenderer(
    message_list,
    () => {},
    (request) => {
      received_request = request;
    },
  );
  const request = {
    interaction_id: "question-2",
    turn_id: "turn-2",
    kind: "question",
    source: {
      type: "tool",
      tool_call_id: "call-question-2",
      tool_name: "ask_question",
    },
    title: "Confirm target",
    questions: [{
      question_id: "target",
      prompt: "Which target?",
      response_type: "text",
    }],
    created_at: 1,
  };

  renderer.render_event({
    mutation_id: "mutation-question-2",
    message_id: "assistant-2",
    revision: 1,
    session_id: "session-2",
    turn_id: "turn-2",
    created_at: 1,
    variant: "part",
    type: "interaction",
    part_id: "interaction:question-2",
    part: {
      part_id: "interaction:question-2",
      sequence: 1,
      type: "interaction",
      interaction_id: "question-2",
      interaction_type: "question",
      status: "pending",
      request,
    },
  });

  assert.deepEqual(received_request, request);
});

test("执行期间允许审批与安全策略命令并阻止破坏性 Slash 命令", () => {
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
    resolveSlashCommandInput({ input: "/security", is_streaming: true }).kind,
    "builtin",
  );
  assert.equal(
    resolveSlashCommandInput({ input: "/model", is_streaming: true }).kind,
    "message",
  );
});

test("Security Policy 选择器直接提交 canonical SessionApprovalMode", () => {
  let selected_mode;
  let cancelled = false;
  const picker = new SecurityPolicyPanelComponent({
    current_mode: "ask",
    on_select: (mode) => {
      selected_mode = mode;
    },
    on_cancel: () => {
      cancelled = true;
    },
  });

  const rendered = plain(picker.render(88)).join("\n");
  assert.match(rendered, /Security policy/);
  assert.match(rendered, /Default.*current/);
  assert.match(rendered, /Always Allow/);
  assert.ok(picker.render(32).every((line) => visibleWidth(line) <= 32));

  picker.handleInput("\u001B[B");
  picker.handleInput("\r");
  assert.equal(selected_mode, "always-allow");

  const cancel_picker = new SecurityPolicyPanelComponent({
    current_mode: "always-allow",
    on_select: () => {},
    on_cancel: () => {
      cancelled = true;
    },
  });
  cancel_picker.handleInput("\u001B");
  assert.equal(cancelled, true);
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
