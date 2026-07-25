/**
 * Chat Access 公开行为测试。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatAccessService } from "../bin/index.js";
import { TelegramBot } from "../bin/chat/channels/telegram/Bot.js";

function create_project_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-chat-access-"));
}

function remove_project_root(project_root) {
  fs.rmSync(project_root, { recursive: true, force: true });
}

function telegram_identity(issuer, chat_type = "private") {
  return {
    channel: "telegram",
    issuer,
    subject_id: "8444574557",
    display_name: "Access Tester",
    chat_id: chat_type === "private" ? "8444574557" : "-100001",
    chat_type,
  };
}

test("Chat Access 按 issuer 隔离并复用 pending request", () => {
  const project_root = create_project_root();
  try {
    const service = new ChatAccessService({ project_root });
    const first = service.evaluate(telegram_identity("telegram-main"));
    const repeated = service.evaluate(telegram_identity("telegram-main"));
    const other_issuer = service.evaluate(telegram_identity("telegram-backup"));

    assert.equal(first.reason, "request_pending");
    assert.equal(repeated.request_id, first.request_id);
    assert.notEqual(other_issuer.principal_id, first.principal_id);
    assert.notEqual(other_issuer.request_id, first.request_id);
    assert.equal(service.list_requests("pending").length, 2);
  } finally {
    remove_project_root(project_root);
  }
});

test("Telegram 授权命令使用代码格式并保留完整标识符", () => {
  const project_root = create_project_root();
  try {
    const bot = new TelegramBot(
      {
        agent_id: "lucas_whitman",
        workspace_path: project_root,
        logger: {
          debug() {},
          info() {},
          warn() {},
          error() {},
        },
      },
      "test-token",
    );
    const text = bot.buildAccessBlockedText({
      result: {
        allowed: false,
        reason: "request_pending",
        request_id: "req_dFij9rOzsDnDPOVJ",
      },
    });

    assert.match(text, /Agent "`lucas_whitman`"/);
    assert.match(text, /访问请求：`req_dFij9rOzsDnDPOVJ`/);
    assert.match(
      text,
      /```bash\ndowncity chat access approve req_dFij9rOzsDnDPOVJ --agent lucas_whitman\n```/,
    );
  } finally {
    remove_project_root(project_root);
  }
});

test("approve all、revoke 和 deny 保持明确状态语义", () => {
  const project_root = create_project_root();
  try {
    const service = new ChatAccessService({ project_root });
    const pending = service.evaluate(telegram_identity("telegram-main"));
    assert.ok(pending.request_id);

    const grants = service.approve_request({
      request_id: pending.request_id,
      scope: "all",
      operator: "test",
    });
    assert.deepEqual(grants.map((grant) => grant.scope).sort(), ["direct", "group"]);
    assert.equal(service.evaluate(telegram_identity("telegram-main")).allowed, true);
    assert.equal(service.evaluate(telegram_identity("telegram-main", "supergroup")).allowed, true);

    assert.equal(service.revoke_grant({
      principal_id: pending.principal_id,
      scope: "direct",
      operator: "test",
    }), 1);
    const requested_again = service.evaluate(telegram_identity("telegram-main"));
    assert.equal(requested_again.reason, "request_pending");
    assert.ok(requested_again.request_id);

    service.deny_request({
      request_id: requested_again.request_id,
      operator: "test",
    });
    const denied = service.evaluate(telegram_identity("telegram-main"));
    assert.equal(denied.reason, "grant_denied");
    assert.equal(denied.request_id, undefined);
    assert.equal(service.list_requests("pending").length, 0);
    assert.throws(() => service.revoke_grant({
      principal_id: "principal_missing",
      scope: "all",
      operator: "test",
    }), /principal not found/);
  } finally {
    remove_project_root(project_root);
  }
});
