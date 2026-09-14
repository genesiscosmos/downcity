/**
 * @file 验证 chat 入站消息以 Session 原生 context part 承载运行时事实。
 *
 * 关键点（中文）
 * - `info` / `chat-environment` 必须是结构化 context part，而不是手写 `<info>` 字符串。
 * - part 顺序固定为 info -> chat-environment -> 正文；正文为空时不得落下空 text part。
 * - 转义交给 Session 层，本层必须提供未转义的原始值，否则会出现二次转义。
 * - Desktop 依赖 `is_chat_runtime_context_tag` 判定「系统注入」与「用户撰写」。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ENVIRONMENT_CONTEXT_TAG,
  CHAT_INFO_CONTEXT_TAG,
  is_chat_runtime_context_tag,
} from "@downcity/type";
import {
  build_chat_environment_input,
  render_chat_environment_body,
  resolve_current_chat_channel,
} from "../bin/chat/runtime/ChatEnvironment.js";
import { build_inbound_prompt_parts } from "../bin/chat/runtime/InboundPromptParts.js";

/** 构造一份最小的 Conversation 记录。 */
function create_conversation(overrides = {}) {
  return {
    session_id: "session-1",
    external_chat_id: "chat-1",
    chat_type: "private",
    thread_id: undefined,
    title: undefined,
    ...overrides,
  };
}

test("入站 parts 顺序固定为 info -> chat-environment -> 正文", () => {
  const parts = build_inbound_prompt_parts({
    info: {
      message_id: "m-1",
      user_id: "u-1",
      username: "wangenius",
      receivedAt: "2026-09-14T04:48:19.000Z",
      text: "你好",
    },
    environment: build_chat_environment_input({
      conversation: create_conversation(),
      channel: "telegram",
    }),
  });

  assert.deepEqual(
    parts.map((part) => (part.type === "text" ? "text" : part.tag)),
    [CHAT_INFO_CONTEXT_TAG, CHAT_ENVIRONMENT_CONTEXT_TAG, "text"],
  );
  assert.equal(parts[2].text, "你好");
});

test("正文为空时不写入空 text part，但运行时上下文仍然保留", () => {
  const parts = build_inbound_prompt_parts({
    info: { message_id: "m-1", text: "   " },
    environment: build_chat_environment_input({
      conversation: create_conversation(),
      channel: "feishu",
    }),
  });

  assert.ok(
    parts.every((part) => part.type !== "text"),
    "空正文不允许产生空 text part",
  );
  assert.equal(parts.length, 2);
});

test("context 正文保持未转义原文，避免与 Session 层二次转义冲突", () => {
  const parts = build_inbound_prompt_parts({
    info: {
      message_id: "m&1",
      username: "a<b>c",
      receivedAt: "2026-09-14T04:48:19.000Z",
      text: "hi",
    },
    environment: build_chat_environment_input({
      conversation: create_conversation(),
      channel: "qq",
    }),
  });

  const info_context = parts[0].context;
  assert.match(info_context, /message_id: m&1/u);
  assert.match(info_context, /username: a<b>c/u);
  assert.ok(
    !info_context.includes("&#60;") && !info_context.includes("&lt;"),
    "本层不得预转义，转义由 Session 层统一负责",
  );
});

test("元信息值折叠换行，保证一行一个字段", () => {
  const parts = build_inbound_prompt_parts({
    info: {
      message_id: "m-1",
      username: "line1\nline2",
      receivedAt: "2026-09-14T04:48:19.000Z",
      text: "hi",
    },
    environment: build_chat_environment_input({
      conversation: create_conversation(),
      channel: "telegram",
    }),
  });

  assert.match(parts[0].context, /username: line1 line2/u);
});

test("环境正文包含路由事实，并按需携带 chat_title", () => {
  const without_title = render_chat_environment_body(
    build_chat_environment_input({
      conversation: create_conversation(),
      channel: "telegram",
    }),
  );
  assert.match(without_title, /^channel: telegram$/mu);
  assert.match(without_title, /^session_id: session-1$/mu);
  assert.match(without_title, /^chat_id: chat-1$/mu);
  assert.match(without_title, /^chat_type: private$/mu);
  assert.match(without_title, /^thread_id: none$/mu);
  assert.ok(!without_title.includes("chat_title:"));

  const with_title = render_chat_environment_body(
    build_chat_environment_input({
      conversation: create_conversation({ title: "研发群", thread_id: "42" }),
      channel: "telegram",
    }),
  );
  assert.match(with_title, /^chat_title: 研发群$/mu);
  assert.match(with_title, /^thread_id: 42$/mu);
});

test("resolve_current_chat_channel 只在 chat 来源上返回 channel", () => {
  const chat_origin = {
    session_id: "session-1",
    session_origin: { type: "chat", channel: "telegram", chat_id: "chat-1" },
  };
  assert.equal(resolve_current_chat_channel(chat_origin), "telegram");

  assert.equal(
    resolve_current_chat_channel({
      session_id: "session-1",
      session_origin: { type: "desktop" },
    }),
    null,
  );
  assert.equal(
    resolve_current_chat_channel({
      session_id: "session-1",
      session_origin: { type: "chat", channel: "unknown", chat_id: "chat-1" },
    }),
    null,
  );
  assert.equal(resolve_current_chat_channel(undefined), null);
});

test("Desktop 可据此区分系统注入与用户撰写", () => {
  assert.equal(is_chat_runtime_context_tag(CHAT_INFO_CONTEXT_TAG), true);
  assert.equal(is_chat_runtime_context_tag(CHAT_ENVIRONMENT_CONTEXT_TAG), true);
  assert.equal(is_chat_runtime_context_tag("reference"), false);
  assert.equal(is_chat_runtime_context_tag(undefined), false);
});
