/** Chat Bot Account 配置校验、安全投影与 mutation。 */

import { generate_id } from "@downcity/agent";
import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import type {
  ChatAccountConfig,
  ChatAccountConnectionState,
  ChatAccountDraft,
  ChatAccountsConfig,
  ChatAccountView,
  ChatProvider,
} from "@/chat/types/ChatAccount.js";

/** 把 Plugin Config 解析成经过完整校验的 Account 配置。 */
export function read_chat_accounts_config(value: PluginJsonObject): ChatAccountsConfig {
  const accounts_value = value.accounts;
  if (accounts_value === undefined) return { accounts: [] };
  if (!Array.isArray(accounts_value)) throw new Error("Chat accounts must be an array");
  const account_ids = new Set<string>();
  const accounts = accounts_value.map((item) => normalize_persisted_account(item));
  for (const account of accounts) {
    if (account_ids.has(account.account_id)) {
      throw new Error(`Chat Account ID is duplicated: ${account.account_id}`);
    }
    account_ids.add(account.account_id);
  }
  return { accounts };
}

/** 创建一个经过校验的新 Account 配置。 */
export function create_chat_account(
  config: ChatAccountsConfig,
  draft_value: PluginJsonValue | undefined,
): { config: ChatAccountsConfig; account: ChatAccountConfig } {
  const draft = read_account_draft(draft_value);
  const account_id = normalize_text(draft.account_id) || `account_${generate_id()}`;
  if (config.accounts.some((account) => account.account_id === account_id)) {
    throw new Error(`Chat Account already exists: ${account_id}`);
  }
  const account = normalize_account_draft({ ...draft, account_id });
  return { config: { accounts: [...config.accounts, account] }, account };
}

/** 更新一个 Account，空密钥沿用当前值。 */
export function update_chat_account(
  config: ChatAccountsConfig,
  draft_value: PluginJsonValue | undefined,
): { config: ChatAccountsConfig; account: ChatAccountConfig } {
  const draft = read_account_draft(draft_value);
  const account_id = normalize_required(draft.account_id, "account_id");
  const current = config.accounts.find((account) => account.account_id === account_id);
  if (!current) throw new Error(`Chat Account not found: ${account_id}`);
  if (current.provider !== draft.provider) {
    throw new Error("Chat Account provider cannot be changed");
  }
  const account = normalize_account_draft({
    ...draft,
    ...(draft.provider === "telegram" && !normalize_text(draft.bot_token)
      ? { bot_token: current.provider === "telegram" ? current.bot_token : "" }
      : {}),
    ...(draft.provider !== "telegram" && !normalize_text(draft.app_secret)
      ? { app_secret: current.provider !== "telegram" ? current.app_secret : "" }
      : {}),
  });
  return {
    config: {
      accounts: config.accounts.map((item) =>
        item.account_id === account_id ? account : item),
    },
    account,
  };
}

/** 删除一个 Account 配置。 */
export function delete_chat_account(
  config: ChatAccountsConfig,
  account_id_input: string,
): ChatAccountsConfig {
  const account_id = normalize_required(account_id_input, "account_id");
  if (!config.accounts.some((account) => account.account_id === account_id)) {
    throw new Error(`Chat Account not found: ${account_id}`);
  }
  return { accounts: config.accounts.filter((account) => account.account_id !== account_id) };
}

/** 把完整 Account 转成不会暴露密钥的 Desktop 视图。 */
export function to_chat_account_view(
  account: ChatAccountConfig,
  runtime?: { state: ChatAccountConnectionState; last_error?: string },
): ChatAccountView {
  return {
    account_id: account.account_id,
    name: account.name,
    provider: account.provider,
    enabled: account.enabled,
    ...(account.agent_id ? { agent_id: account.agent_id } : {}),
    ...(account.workspace_id ? { workspace_id: account.workspace_id } : {}),
    credential_configured: account.provider === "telegram"
      ? Boolean(account.bot_token)
      : Boolean(account.app_id && account.app_secret),
    connection_state: account.enabled ? runtime?.state ?? "disconnected" : "disabled",
    ...(runtime?.last_error ? { last_error: runtime.last_error } : {}),
    ...(account.provider !== "telegram" ? { app_id: account.app_id } : {}),
    ...(account.provider === "feishu" && account.domain ? { domain: account.domain } : {}),
  };
}

/** 把 Account 配置转成 Plugin Config JSON。 */
export function serialize_chat_accounts_config(config: ChatAccountsConfig): PluginJsonObject {
  return structuredClone(config) as unknown as PluginJsonObject;
}

/** 校验一条已经持久化的 Account。 */
function normalize_persisted_account(value: PluginJsonValue): ChatAccountConfig {
  const source = as_object(value, "Chat Account");
  return normalize_account_draft({
    account_id: read_string(source, "account_id"),
    name: read_string(source, "name"),
    provider: read_provider(source.provider),
    enabled: source.enabled === true,
    agent_id: read_string(source, "agent_id"),
    workspace_id: read_string(source, "workspace_id"),
    bot_token: read_string(source, "bot_token"),
    app_id: read_string(source, "app_id"),
    app_secret: read_string(source, "app_secret"),
    domain: read_string(source, "domain"),
  });
}

/** 读取 Desktop Account 草稿。 */
function read_account_draft(value: PluginJsonValue | undefined): ChatAccountDraft {
  const source = as_object(value, "Chat Account draft");
  return {
    ...(read_string(source, "account_id") ? { account_id: read_string(source, "account_id") } : {}),
    name: read_string(source, "name"),
    provider: read_provider(source.provider),
    enabled: source.enabled === true,
    agent_id: read_string(source, "agent_id"),
    workspace_id: read_string(source, "workspace_id"),
    ...(read_string(source, "bot_token") ? { bot_token: read_string(source, "bot_token") } : {}),
    ...(read_string(source, "app_id") ? { app_id: read_string(source, "app_id") } : {}),
    ...(read_string(source, "app_secret") ? { app_secret: read_string(source, "app_secret") } : {}),
    ...(read_string(source, "domain") ? { domain: read_string(source, "domain") } : {}),
  };
}

/** 把草稿规范化为平台判别联合类型。 */
function normalize_account_draft(draft: ChatAccountDraft & { account_id?: string }): ChatAccountConfig {
  const common = {
    account_id: normalize_required(draft.account_id, "account_id"),
    name: normalize_required(draft.name, "name"),
    enabled: draft.enabled === true,
    ...(normalize_text(draft.agent_id) ? { agent_id: normalize_text(draft.agent_id) } : {}),
    ...(normalize_text(draft.workspace_id) ? { workspace_id: normalize_text(draft.workspace_id) } : {}),
  };
  if (draft.provider === "telegram") {
    return {
      ...common,
      provider: "telegram",
      bot_token: normalize_required(draft.bot_token, "bot_token"),
    };
  }
  if (draft.provider === "feishu") {
    const domain = normalize_text(draft.domain);
    return {
      ...common,
      provider: "feishu",
      app_id: normalize_required(draft.app_id, "app_id"),
      app_secret: normalize_required(draft.app_secret, "app_secret"),
      ...(domain ? { domain } : {}),
    };
  }
  // 平台类型已在上面穷尽；保留显式失败，避免未来新增平台时静默走错分支。
  const unsupported_provider: never = draft.provider;
  throw new Error(`Unsupported Chat provider: ${String(unsupported_provider)}`);
}

/** 要求 JSON 值是普通对象。 */
function as_object(value: PluginJsonValue | undefined, label: string): PluginJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

/** 读取支持的平台类型。 */
function read_provider(value: PluginJsonValue | undefined): ChatProvider {
  const provider = normalize_text(value).toLowerCase();
  if (provider === "telegram" || provider === "feishu") return provider;
  throw new Error(`Unsupported Chat provider: ${provider || "empty"}`);
}

/** 读取一个 JSON 字符串字段。 */
function read_string(source: PluginJsonObject, key: string): string {
  return typeof source[key] === "string" ? String(source[key]).trim() : "";
}

/** 读取非空字符串。 */
function normalize_required(value: unknown, field: string): string {
  const normalized = normalize_text(value);
  if (!normalized) throw new Error(`Chat Account field is required: ${field}`);
  return normalized;
}

/** 读取可选字符串。 */
function normalize_text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
