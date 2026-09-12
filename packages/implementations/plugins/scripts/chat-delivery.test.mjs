/**
 * @file 验证 Chat 可靠投递的失败语义与受理回执。
 *
 * 关键点（中文）
 * - 附件投递失败必须上抛，不能降级成一条 "❌ ..." 文本后正常返回，
 *   否则 Outbox 会误记为已投递，发起方永远无法感知文件未送达。
 * - `chat.send` / `chat.react` 返回的是受理回执（已入队），不是送达回执。
 * - 全部用例只桩掉网络层，保留真实的路径解析、FormData 组装与错误传播逻辑。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TelegramApiClient } from "../bin/chat/channels/telegram/ApiClient.js";
import { create_chat_agent_actions } from "../bin/chat/runtime/ChatAgentActions.js";
import { FeishuBot } from "../bin/chat/channels/feishu/Feishu.js";

/** 记录日志调用的最小 PluginLogger 桩。 */
function create_logger(records) {
  const push = (level) => (message) => {
    records.push({ level, message: String(message) });
  };
  return {
    log: async (level, message) => push(level)(message),
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
}

/** 创建一个带单个待发送附件的临时项目目录。 */
function create_project_root() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-chat-"));
  fs.writeFileSync(path.join(root, "report.md"), "# report\n", "utf8");
  return root;
}

test("Telegram 附件投递失败必须上抛，且不得被改写成聊天文本", async () => {
  const project_root = create_project_root();
  const log_records = [];
  const sent_texts = [];
  const client = new TelegramApiClient({
    botToken: "test-token",
    project_root,
    data_path: project_root,
    logger: create_logger(log_records),
  });

  // 只桩网络层：multipart 上传返回 Telegram 在文件缺失时的真实 400。
  client.requestForm = async () => {
    throw new Error(
      "Telegram API HTTP 400: Bad Request: there is no document in the request",
    );
  };
  client.requestSendJson = async (_method, data) => {
    sent_texts.push(String(data?.text ?? ""));
    return {};
  };

  await assert.rejects(
    () => client.sendMessage("123", '<file type="document">report.md</file>'),
    (error) => {
      // 关键点（中文）：上抛的必须是附件本身的失败原因，而不是网络错误。
      assert.match(String(error.message), /there is no document in the request/u);
      return true;
    },
  );

  // 关键点（中文）：修复前这里会有一条 "❌ Failed to send document: ..." 文本，
  // 并让 sendMessage 正常返回，Outbox 因此误判投递成功。
  assert.deepEqual(
    sent_texts,
    [],
    "附件失败时不允许向用户补发错误文本后正常返回",
  );
  assert.ok(
    log_records.some(
      (record) =>
        record.level === "error" && record.message.includes("Failed to send document"),
    ),
    "附件失败必须留下可定位的错误日志",
  );
  fs.rmSync(project_root, { recursive: true, force: true });
});

test("Telegram 附件路径不存在时给出可读错误而非网络错误", async () => {
  const project_root = create_project_root();
  const sent_texts = [];
  const client = new TelegramApiClient({
    botToken: "test-token",
    project_root,
    data_path: project_root,
    logger: create_logger([]),
  });
  client.requestForm = async () => {
    throw new Error("should not reach network");
  };
  client.requestSendJson = async (_method, data) => {
    sent_texts.push(String(data?.text ?? ""));
    return {};
  };

  await assert.rejects(
    () => client.sendMessage("123", '<file type="document">missing.md</file>'),
    (error) => {
      assert.match(String(error.message), /Attachment not found/u);
      return true;
    },
  );
  assert.deepEqual(sent_texts, []);
  fs.rmSync(project_root, { recursive: true, force: true });
});

test("纯文本发送仍然正常，不受附件失败语义影响", async () => {
  const project_root = create_project_root();
  const sent_texts = [];
  const client = new TelegramApiClient({
    botToken: "test-token",
    project_root,
    data_path: project_root,
    logger: create_logger([]),
  });
  client.requestSendJson = async (_method, data) => {
    sent_texts.push(String(data?.text ?? ""));
    return {};
  };
  await client.sendMessage("123", "hello");
  assert.deepEqual(sent_texts, ["hello"]);
  fs.rmSync(project_root, { recursive: true, force: true });
});

/** 构造一个只暴露 send_from_agent / react_from_agent 的 Runtime 桩。 */
function create_runtime_stub(delivery) {
  return {
    send_from_agent: () => delivery,
    react_from_agent: () => delivery,
  };
}

/** 构造一个最小可用的 FeishuBot，不参与真实入站流程。 */
function create_feishu_bot(project_root, log_records) {
  return new FeishuBot(
    {
      account_id: "feishu-account",
      agent_id: "agent-1",
      workspace_path: project_root,
      storage_path: project_root,
      logger: create_logger(log_records),
      evaluate_access: async () => ({ allowed: true }),
      receive_message: async () => ({ chat_key: "k", position: 0 }),
      record_audit: async () => undefined,
      clear_conversation: async () => undefined,
    },
    "app-id",
    "app-secret",
    undefined,
  );
}

test("飞书附件投递失败同样必须上抛，不得降级为聊天文本", async () => {
  const project_root = create_project_root();
  const log_records = [];
  const sent_messages = [];
  const bot = create_feishu_bot(project_root, log_records);
  bot.sendAttachment = async () => {
    throw new Error("Feishu file upload failed: HTTP 500");
  };
  bot.sendPlatformMessage = async (_chatId, _chatType, _messageId, msgType, content) => {
    sent_messages.push({ msgType, content });
  };

  await assert.rejects(
    () => bot.sendChatMessage("chat-1", "p2p", '<file type="document">report.md</file>'),
    (error) => {
      assert.match(String(error.message), /Feishu file upload failed/u);
      return true;
    },
  );
  assert.deepEqual(sent_messages, [], "附件失败时不允许向用户补发错误文本");
  assert.ok(
    log_records.some(
      (record) =>
        record.level === "error" &&
        record.message.includes("Failed to send Feishu attachment"),
    ),
    "飞书附件失败必须留下可定位的错误日志",
  );
  fs.rmSync(project_root, { recursive: true, force: true });
});

test("chat.send 返回受理回执而不是送达承诺", async () => {
  const actions = create_chat_agent_actions(() =>
    create_runtime_stub({ delivery_id: "delivery_test_1", status: "pending" }),
  );
  const result = await actions.send.execute({
    context: { agent: { id: "agent-1" } },
    execution: { snapshot: { session_id: "session-1" } },
    input: { text: "hello" },
  });

  assert.equal(result.success, true);
  // 关键点（中文）：status 描述入队状态，调用方必须据此知道自己拿到的是受理回执。
  assert.deepEqual(result.data, {
    delivery_id: "delivery_test_1",
    status: "pending",
    session_id: "session-1",
  });
});

test("chat.react 同样返回受理回执", async () => {
  const actions = create_chat_agent_actions(() =>
    create_runtime_stub({ delivery_id: "delivery_test_2", status: "retry_wait" }),
  );
  const result = await actions.react.execute({
    context: { agent: { id: "agent-1" } },
    execution: { snapshot: { session_id: "session-1" } },
    input: { message_id: "9", emoji: "👍" },
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    delivery_id: "delivery_test_2",
    status: "retry_wait",
    session_id: "session-1",
  });
});
