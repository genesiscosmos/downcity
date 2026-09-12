/** Chat Desktop Bot Account、Conversation 与 Runtime 管理 Actions。 */

import type {
  PluginJsonObject,
  PluginJsonValue,
  PluginLifecycleContext,
} from "@downcity/city/plugin";
import {
  create_chat_account,
  delete_chat_account,
  read_chat_accounts_config,
  serialize_chat_accounts_config,
  to_chat_account_view,
  update_chat_account,
} from "@/chat/accounts/ChatAccountConfig.js";
import type { ChatRuntime } from "@/chat/runtime/ChatRuntime.js";
import type {
  ChatAccountDetailSnapshot,
  ChatDesktopSnapshot,
} from "@/chat/types/ChatDesktop.js";
import { ChatAccessService } from "@/chat/access/ChatAccessService.js";

/** 注册 Chat Plugin 的 Desktop 业务 Actions。 */
export function register_chat_account_host_actions(
  context: PluginLifecycleContext,
  resolve_runtime: () => ChatRuntime,
): void {
  context.plugin.action({
    id: "accounts.snapshot",
    run: async () => as_json(await create_snapshot(context, resolve_runtime())),
  });
  const access = new ChatAccessService({ data_path: context.storage.path });
  context.plugin.action({
    id: "access.approve",
    run: async (input) => {
      const source = read_object(input);
      const scope = read_optional_scope(source.scope);
      return as_json(access.approve_request({
        request_id: read_required_string(source, "request_id"),
        operator: "desktop",
        ...(scope ? { scope } : {}),
      }));
    },
  });
  context.plugin.action({
    id: "access.deny",
    run: async (input) => {
      const source = read_object(input);
      const scope = read_optional_scope(source.scope);
      return as_json(access.deny_request({
        request_id: read_required_string(source, "request_id"),
        operator: "desktop",
        ...(scope ? { scope } : {}),
      }));
    },
  });
  context.plugin.action({
    id: "access.set",
    run: async (input) => {
      const source = read_object(input);
      const effect = source.effect === "allow" || source.effect === "deny"
        ? source.effect
        : undefined;
      if (!effect) throw new Error("Chat Access effect must be allow or deny");
      return as_json(access.set_principal_effect({
        principal_id: read_required_string(source, "principal_id"),
        scope: read_scope(source.scope),
        effect,
        operator: "desktop",
      }));
    },
  });
  context.plugin.action({
    id: "access.revoke",
    run: async (input) => {
      const source = read_object(input);
      return as_json({
        removed_count: access.revoke_grant({
          principal_id: read_required_string(source, "principal_id"),
          scope: read_scope(source.scope),
          operator: "desktop",
        }),
      });
    },
  });
  context.plugin.action({
    id: "accounts.detail",
    run: async (input) => as_json(create_detail(
      context,
      resolve_runtime(),
      read_required_id(input, "account_id"),
    )),
  });
  context.plugin.action({
    id: "accounts.create",
    run: async (input) => {
      const current = read_chat_accounts_config(context.config.get());
      const mutation = create_chat_account(current, input);
      await context.config.set(serialize_chat_accounts_config(mutation.config));
      await resolve_runtime().restart_account(mutation.account);
      return as_json(to_chat_account_view(
        mutation.account,
        resolve_runtime().get_account_state(mutation.account.account_id),
      ));
    },
  });
  context.plugin.action({
    id: "accounts.update",
    run: async (input) => {
      const current = read_chat_accounts_config(context.config.get());
      const mutation = update_chat_account(current, input);
      await context.config.set(serialize_chat_accounts_config(mutation.config));
      await resolve_runtime().restart_account(mutation.account);
      return as_json(to_chat_account_view(
        mutation.account,
        resolve_runtime().get_account_state(mutation.account.account_id),
      ));
    },
  });
  context.plugin.action({
    id: "accounts.delete",
    run: async (input) => {
      const account_id = read_required_id(input, "account_id");
      const current = read_chat_accounts_config(context.config.get());
      const next = delete_chat_account(current, account_id);
      await resolve_runtime().stop_account(account_id);
      await context.config.set(serialize_chat_accounts_config(next));
      if (read_boolean(input, "delete_data")) {
        resolve_runtime().store.delete_account_data(account_id);
      }
      return { account_id, deleted: true };
    },
  });
  context.plugin.action({
    id: "accounts.restart",
    run: async (input) => {
      const account_id = read_required_id(input, "account_id");
      const config = read_chat_accounts_config(context.config.get());
      const account = config.accounts.find((item) => item.account_id === account_id);
      if (!account) throw new Error(`Chat Account not found: ${account_id}`);
      await resolve_runtime().restart_account(account);
      return as_json(to_chat_account_view(
        account,
        resolve_runtime().get_account_state(account_id),
      ));
    },
  });
  context.plugin.action({
    id: "accounts.test",
    run: async (input) => as_json(
      await resolve_runtime().test_account(read_required_id(input, "account_id")),
    ),
  });
  context.plugin.action({
    id: "accounts.refresh_network",
    run: async () => {
      // 关键点（中文）：网络代理变化后必须用新出口重建连接，否则旧连接会继续用旧代理。
      await resolve_runtime().restart_enabled_accounts();
      const snapshot = await create_snapshot(context, resolve_runtime());
      return as_json(snapshot.accounts);
    },
  });
  context.plugin.action({
    id: "conversations.update_route",
    run: async (input) => {
      const source = read_object(input);
      const conversation_id = read_required_string(source, "conversation_id");
      const current = resolve_runtime().store.get_conversation(conversation_id);
      if (!current) throw new Error(`Chat conversation not found: ${conversation_id}`);
      const agent_id = read_required_string(source, "agent_id");
      const workspace_id = read_required_string(source, "workspace_id");
      const route_changed = agent_id !== current.agent_id || workspace_id !== current.workspace_id;
      const account = read_chat_accounts_config(context.config.get()).accounts.find(
        (item) => item.account_id === current.account_id,
      );
      if (!account) throw new Error(`Chat Account not found: ${current.account_id}`);
      const next_session = route_changed
        ? await context.system.create_agent_session({
            agent_id,
            workspace_id,
            origin: conversation_origin(account.provider, current),
          })
        : undefined;
      return as_json(resolve_runtime().store.update_conversation({
        conversation_id,
        agent_id,
        workspace_id,
        ...(next_session ? { session_id: next_session.session_id } : {}),
      }));
    },
  });
  context.plugin.action({
    id: "conversations.reset_session",
    run: async (input) => {
      const conversation_id = read_required_id(input, "conversation_id");
      const current = resolve_runtime().store.get_conversation(conversation_id);
      if (!current) throw new Error(`Chat conversation not found: ${conversation_id}`);
      const account = read_chat_accounts_config(context.config.get()).accounts.find(
        (item) => item.account_id === current.account_id,
      );
      if (!account) throw new Error(`Chat Account not found: ${current.account_id}`);
      const session = await context.system.create_agent_session({
        agent_id: current.agent_id,
        workspace_id: current.workspace_id,
        origin: conversation_origin(account.provider, current),
      });
      return as_json(resolve_runtime().store.update_conversation({
        conversation_id,
        session_id: session.session_id,
      }));
    },
  });
  context.plugin.action({
    id: "conversations.set_status",
    run: async (input) => {
      const source = read_object(input);
      const status = source.status === "active" || source.status === "paused"
        ? source.status
        : undefined;
      if (!status) throw new Error("Chat Conversation status must be active or paused");
      return as_json(resolve_runtime().store.update_conversation({
        conversation_id: read_required_string(source, "conversation_id"),
        status,
      }));
    },
  });
  context.plugin.action({
    id: "reliability.retry",
    run: async (input) => {
      const source = read_object(input);
      const direction = source.direction === "inbox" || source.direction === "outbox"
        ? source.direction
        : undefined;
      if (!direction) throw new Error("Chat reliability direction must be inbox or outbox");
      const item_id = read_required_string(source, "item_id");
      const account_id = read_required_string(source, "account_id");
      const item_account_id = direction === "inbox"
        ? resolve_runtime().store.get_inbound(item_id)?.account_id
        : resolve_runtime().store.get_outbound(item_id)?.account_id;
      if (item_account_id !== account_id) {
        throw new Error("Chat reliability item does not belong to this Bot Account");
      }
      const retried = direction === "inbox"
        ? resolve_runtime().store.retry_inbound(item_id)
        : resolve_runtime().store.retry_outbound(item_id);
      if (retried) {
        if (direction === "inbox") void resolve_runtime().process_pending_inbox();
        else void resolve_runtime().process_pending_outbox();
      }
      return { account_id, direction, item_id, retried };
    },
  });
}

/** 创建 Sidebar 和 Mainview 共享的 Account 列表快照。 */
async function create_snapshot(
  context: PluginLifecycleContext,
  runtime: ChatRuntime,
): Promise<ChatDesktopSnapshot> {
  const config = read_chat_accounts_config(context.config.get());
  return {
    accounts: config.accounts.map((account) =>
      to_chat_account_view(account, runtime.get_account_state(account.account_id))),
    agents: await context.system.list_agents(),
    workspaces: await context.system.list_workspaces(),
  };
}

/** 创建一个 Account 的详情快照。 */
function create_detail(
  context: PluginLifecycleContext,
  runtime: ChatRuntime,
  account_id: string,
): ChatAccountDetailSnapshot {
  const config = read_chat_accounts_config(context.config.get());
  const account = config.accounts.find((item) => item.account_id === account_id);
  if (!account) throw new Error(`Chat Account not found: ${account_id}`);
  return {
    account: to_chat_account_view(account, runtime.get_account_state(account_id)),
    conversations: runtime.store.list_conversations(account_id),
    activity: runtime.store.list_activity(account_id),
    access: filter_access_snapshot(
      new ChatAccessService({ data_path: context.storage.path }).snapshot(),
      account_id,
    ),
    reliability_failures: [
      ...runtime.store.list_failed_inbound(account_id).map((item) => ({
        direction: "inbox" as const,
        item_id: item.inbound_id,
        ...(item.conversation_id ? { conversation_id: item.conversation_id } : {}),
        attempt_count: item.attempt_count,
        error: item.error || "Inbox processing failed",
        updated_at: item.updated_at,
      })),
      ...runtime.store.list_failed_outbound(account_id).map((item) => ({
        direction: "outbox" as const,
        item_id: item.delivery_id,
        conversation_id: item.conversation_id,
        attempt_count: item.attempt_count,
        error: item.error || "Outbox delivery failed",
        updated_at: item.updated_at,
      })),
    ].sort((left, right) => right.updated_at - left.updated_at),
  };
}

/** 只返回 Principal issuer 属于当前 Bot Account 的 Access 数据。 */
function filter_access_snapshot(
  snapshot: import("@/chat/types/ChatAccess.js").ChatAccessSnapshot,
  account_id: string,
): import("@/chat/types/ChatAccess.js").ChatAccessSnapshot {
  const principals = snapshot.principals.filter((item) => item.principal.issuer === account_id);
  const principal_ids = new Set(principals.map((item) => item.principal.principal_id));
  return {
    principals,
    requests: snapshot.requests.filter((item) => principal_ids.has(item.principal_id)),
  };
}

/** 把结构化 View 转为 Plugin JSON。 */
function as_json(value: unknown): PluginJsonValue {
  return value as PluginJsonValue;
}

/** 读取 JSON Object。 */
function read_object(input: PluginJsonValue | undefined): PluginJsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Chat action input must be an object");
  }
  return input;
}

/** 读取一个必填 ID。 */
function read_required_id(input: PluginJsonValue | undefined, key: string): string {
  return read_required_string(read_object(input), key);
}

/** 读取一个必填字符串。 */
function read_required_string(source: PluginJsonObject, key: string): string {
  const value = typeof source[key] === "string" ? String(source[key]).trim() : "";
  if (!value) throw new Error(`Chat action field is required: ${key}`);
  return value;
}

/** 读取布尔字段。 */
function read_boolean(input: PluginJsonValue | undefined, key: string): boolean {
  return read_object(input)[key] === true;
}

/** 读取 Chat Access Scope。 */
function read_scope(value: PluginJsonValue | undefined): "direct" | "group" | "all" {
  if (value === "direct" || value === "group" || value === "all") return value;
  throw new Error("Chat Access scope must be direct, group, or all");
}

/** 读取可选 Chat Access Scope。 */
function read_optional_scope(
  value: PluginJsonValue | undefined,
): "direct" | "group" | "all" | undefined {
  return value === undefined ? undefined : read_scope(value);
}

/** 构建新 Session 使用的 Chat 来源元数据。 */
function conversation_origin(
  provider: import("@/chat/types/ChatAccount.js").ChatProvider,
  conversation: import("@/chat/types/ChatReliability.js").ChatConversationRecord,
) {
  return {
    type: "chat",
    account_id: conversation.account_id,
    channel: provider,
    chat_id: conversation.external_chat_id,
    chat_type: conversation.chat_type,
    ...(conversation.thread_id ? { thread_id: conversation.thread_id } : {}),
    ...(conversation.title ? { chat_title: conversation.title } : {}),
  };
}
