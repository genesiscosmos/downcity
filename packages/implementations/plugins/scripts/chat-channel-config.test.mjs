/**
 * @file 验证 Bot Account Config 的唯一事实源、密钥保留与安全投影。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  create_chat_account,
  read_chat_accounts_config,
  serialize_chat_accounts_config,
  to_chat_account_view,
  update_chat_account,
} from "../bin/chat/accounts/ChatAccountConfig.js";

test("同一平台可以配置多个独立 Bot Account", () => {
  const first = create_chat_account({ accounts: [] }, {
    account_id: "telegram-main",
    name: "Main",
    provider: "telegram",
    enabled: true,
    agent_id: "agent-main",
    workspace_id: "workspace-main",
    bot_token: "token-main",
  });
  const second = create_chat_account(first.config, {
    account_id: "telegram-backup",
    name: "Backup",
    provider: "telegram",
    enabled: false,
    agent_id: "agent-backup",
    workspace_id: "workspace-backup",
    bot_token: "token-backup",
  });

  assert.deepEqual(second.config.accounts.map((account) => account.account_id), [
    "telegram-main",
    "telegram-backup",
  ]);
});

test("更新时空密钥保留原值且安全投影不回显", () => {
  const created = create_chat_account({ accounts: [] }, {
    account_id: "feishu-main",
    name: "Main",
    provider: "feishu",
    enabled: true,
    agent_id: "agent-main",
    workspace_id: "workspace-main",
    app_id: "app-id",
    app_secret: "secret-value",
  });
  const updated = update_chat_account(created.config, {
    account_id: "feishu-main",
    name: "Renamed",
    provider: "feishu",
    enabled: true,
    agent_id: "agent-main",
    workspace_id: "workspace-main",
    app_id: "app-id",
    app_secret: "",
  });
  const account = updated.account;
  const view = to_chat_account_view(account);

  assert.equal(account.provider === "feishu" ? account.app_secret : "", "secret-value");
  assert.equal(view.name, "Renamed");
  assert.equal(view.credential_configured, true);
  assert.equal("app_secret" in view, false);
});

test("序列化配置可以由 City Config 原样恢复", () => {
  const created = create_chat_account({ accounts: [] }, {
    account_id: "qq-main",
    name: "QQ",
    provider: "qq",
    enabled: true,
    agent_id: "agent-main",
    workspace_id: "workspace-main",
    app_id: "qq-app",
    app_secret: "qq-secret",
    sandbox: true,
  });

  const restored = read_chat_accounts_config(serialize_chat_accounts_config(created.config));
  assert.deepEqual(restored, created.config);
});
