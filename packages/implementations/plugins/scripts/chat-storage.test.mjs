/**
 * @file 验证 Chat Plugin 新可靠消息 Store 的幂等、租约与人工恢复语义。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatStore } from "../bin/chat/storage/ChatStore.js";

/** 创建测试独占的 Chat 生命周期存储目录。 */
function create_storage_path() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-chat-store-"));
}

/** 创建一条完整标准化入站消息。 */
function create_inbound(external_message_id = "message-1") {
  return {
    account_id: "account-1",
    provider: "telegram",
    external_message_id,
    external_chat_id: "chat-1",
    chat_type: "private",
    sender_id: "user-1",
    sender_name: "User",
    text: "hello",
    received_at: 1,
  };
}

test("Inbox 按 Account 与平台消息 ID 幂等写入", () => {
  const storage_path = create_storage_path();
  const store = new ChatStore(storage_path);
  try {
    const first = store.insert_inbound(create_inbound());
    const second = store.insert_inbound(create_inbound());

    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(second.record.inbound_id, first.record.inbound_id);
  } finally {
    store.close();
    fs.rmSync(storage_path, { recursive: true, force: true });
  }
});

test("同一 Agent Turn 结果只创建一个稳定 Outbox", () => {
  const storage_path = create_storage_path();
  const store = new ChatStore(storage_path);
  try {
    const conversation = store.resolve_conversation({
      account_id: "account-1",
      external_chat_id: "chat-1",
      chat_type: "private",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      session_id: "session-1",
      last_message_at: 1,
    });
    const input = {
      delivery_id: "delivery:inbound:inbound-1",
      account_id: "account-1",
      conversation_id: conversation.conversation_id,
      operation: "text",
      payload: { text: "world" },
    };

    const first = store.insert_outbound(input);
    const second = store.insert_outbound(input);

    assert.equal(first.delivery_id, input.delivery_id);
    assert.equal(second.delivery_id, input.delivery_id);
    assert.equal(store.lease_next_outbound(1_000)?.delivery_id, input.delivery_id);
    assert.equal(store.lease_next_outbound(1_000), null);
  } finally {
    store.close();
    fs.rmSync(storage_path, { recursive: true, force: true });
  }
});

test("失败 Inbox 可以由 Desktop 人工恢复", () => {
  const storage_path = create_storage_path();
  const store = new ChatStore(storage_path);
  try {
    const inbound = store.insert_inbound(create_inbound()).record;
    store.fail_inbound(inbound.inbound_id, "model unavailable");

    assert.equal(store.list_failed_inbound("account-1").length, 1);
    assert.equal(store.retry_inbound(inbound.inbound_id), true);
    assert.equal(store.get_inbound(inbound.inbound_id)?.status, "retry_wait");
    assert.equal(store.get_inbound(inbound.inbound_id)?.attempt_count, 0);
  } finally {
    store.close();
    fs.rmSync(storage_path, { recursive: true, force: true });
  }
});
