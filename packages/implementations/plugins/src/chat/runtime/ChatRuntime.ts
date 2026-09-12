/** Chat Plugin 的 City 级 Bot Account、Inbox、Outbox 与 Agent Turn 运行时。 */

import path from "node:path";
import fs from "fs-extra";
import { createHash } from "node:crypto";
import type {
  PluginHostSessionTurn,
  PluginLifecycleContext,
} from "@downcity/city/plugin";
import type { BaseChatChannel, IncomingChatMessage } from "@/chat/channels/BaseChatChannel.js";
import { createTelegramBot } from "@/chat/channels/telegram/Bot.js";
import { createFeishuBot } from "@/chat/channels/feishu/Feishu.js";
import { createQQBot } from "@/chat/channels/qq/QQ.js";
import { ChatAccessService } from "@/chat/access/ChatAccessService.js";
import { buildQueuedUserMessageWithInfo } from "./QueuedUserMessage.js";
import { ChatStore } from "@/chat/storage/ChatStore.js";
import type {
  ChatAccountConfig,
  ChatAccountConnectionState,
} from "@/chat/types/ChatAccount.js";
import type { ChatConnector, ChatConnectorContext } from "@/chat/types/ChatConnector.js";
import type {
  ChatConversationRecord,
  ChatDeliveryAcceptance,
  ChatInboxRecord,
} from "@/chat/types/ChatReliability.js";

const WORKER_INTERVAL_MS = 400;
const INBOX_LEASE_MS = 10 * 60_000;
const OUTBOX_LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CONCURRENT_CONVERSATIONS = 4;
/** 连接健康检查周期。 */
const CONNECTION_HEALTH_INTERVAL_MS = 15_000;
/** 自愈重连的基础退避与上限。 */
const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000;
/** Account 未连接时 Requeue Outbox 的延后时间，不消耗重试次数。 */
const OFFLINE_REQUEUE_DELAY_MS = 30_000;

/**
 * 单个 Account 的 Connector、可观察状态与自愈重连状态。
 */
interface ChatAccountRuntime {
  /** 当前 Account 配置快照。 */
  account: ChatAccountConfig;
  /** 当前平台 Connector。 */
  connector?: BaseChatChannel & ChatConnector;
  /** 当前连接状态。 */
  state: ChatAccountConnectionState;
  /** 最近一次连接错误。 */
  last_error?: string;
  /** 已连续发起的自愈重连次数。 */
  reconnect_attempts: number;
  /** 下一次允许发起自愈重连的时间。 */
  next_reconnect_at: number;
  /** 当前是否正在执行重连，避免并发重复重连。 */
  reconnecting: boolean;
  /**
   * 当前是否允许自愈重连。
   *
   * 说明（中文）
   * - 凭据缺失、Workspace 不存在等配置问题必须由用户修正，重连不会成功。
   * - 此类失败会关闭自动重连，避免无意义地反复重试。
   */
  reconnect_allowed: boolean;
}

/** Chat Runtime 对 Desktop 暴露的 Account 状态。 */
export interface ChatRuntimeAccountState {
  /** 当前连接状态。 */
  state: ChatAccountConnectionState;
  /** 最近一次连接错误。 */
  last_error?: string;
}

/** 一个 City 中唯一的 Chat 可靠消息运行时。 */
export class ChatRuntime {
  /** 当前 Plugin 的唯一可靠状态 Store。 */
  readonly store: ChatStore;

  /** Account ID 到 Connector Runtime 的唯一映射。 */
  private readonly accounts = new Map<string, ChatAccountRuntime>();
  /** 当前仍在执行的 Agent Turn。 */
  private readonly active_turns = new Set<PluginHostSessionTurn>();
  /** 当前由 Inbox 调度器持有的异步任务。 */
  private readonly active_inbox_tasks = new Set<Promise<void>>();
  /** 同一外部路由并发首条消息共享的 Conversation 创建任务。 */
  private readonly conversation_resolutions = new Map<string, Promise<ChatConversationRecord>>();
  /** Inbox Worker 周期 Timer。 */
  private inbox_timer?: ReturnType<typeof setInterval>;
  /** Outbox Worker 周期 Timer。 */
  private outbox_timer?: ReturnType<typeof setInterval>;
  /** 连接健康检查 Timer。 */
  private health_timer?: ReturnType<typeof setInterval>;
  /** 连接健康检查当前是否正在执行。 */
  private health_running = false;
  /** Inbox Worker 当前是否正在调度。 */
  private inbox_running = false;
  /** Outbox Worker 当前是否正在调度。 */
  private outbox_running = false;
  /** Runtime 是否已经停止接收新工作。 */
  private disposed = false;

  /** 创建 Runtime 并打开生命周期 Store。 */
  constructor(private readonly context: PluginLifecycleContext) {
    this.store = new ChatStore(context.storage.path);
  }

  /** 恢复可靠任务并启动全部 enabled Account。 */
  async initialize(configured_accounts: ChatAccountConfig[]): Promise<void> {
    this.store.recover_expired_leases();
    for (const account of configured_accounts) {
      await this.start_account(account);
    }
    this.start_workers();
  }

  /** 返回指定 Account 当前运行状态。 */
  get_account_state(account_id: string): ChatRuntimeAccountState | undefined {
    const runtime = this.accounts.get(String(account_id || "").trim());
    if (!runtime) return undefined;
    return {
      state: this.resolve_runtime_state(runtime),
      ...(runtime.last_error ? { last_error: runtime.last_error } : {}),
    };
  }

  /** 使用最新配置重启一个 Account，并重置自愈重连计数。 */
  async restart_account(account: ChatAccountConfig): Promise<void> {
    await this.stop_account(account.account_id);
    await this.start_account(account);
  }

  /**
   * 重启全部 enabled Account。
   *
   * 说明（中文）
   * - 供网络代理等运行环境发生变化的场景使用，立即使用新配置重建连接。
   */
  async restart_enabled_accounts(): Promise<void> {
    const accounts = [...this.accounts.values()]
      .map((runtime) => runtime.account)
      .filter((account) => account.enabled);
    for (const account of accounts) {
      await this.restart_account(account);
    }
  }

  /** 测试一个已创建 Account 的平台连通性。 */
  async test_account(account_id: string) {
    const runtime = this.accounts.get(String(account_id || "").trim());
    if (!runtime?.connector) throw new Error(`Chat Account is not running: ${account_id}`);
    return await runtime.connector.testConnection();
  }

  /** 在人工恢复失败项后立即触发 Inbox 调度。 */
  async process_pending_inbox(): Promise<void> {
    await this.kick_inbox();
  }

  /** 在人工恢复失败项后立即触发 Outbox 调度。 */
  async process_pending_outbox(): Promise<void> {
    await this.kick_outbox();
  }

  /**
   * 为 Agent Action 创建一条经过所有权校验的可靠外发消息。
   *
   * 返回（中文）
   * - 返回受理回执：消息已可靠入队，不代表已经送达平台。
   */
  send_from_agent(input: {
    /** 发起操作的 Agent ID。 */
    agent_id: string;
    /** 目标 Conversation 对应的 Session ID。 */
    session_id: string;
    /** 外发正文。 */
    text: string;
    /** 可选最早发送时间。 */
    available_at?: number;
  }): ChatDeliveryAcceptance {
    const conversation = this.store.get_conversation_by_session(input.session_id);
    if (!conversation || conversation.agent_id !== input.agent_id) {
      throw new Error("Chat conversation is not owned by the current Agent");
    }
    const delivery = this.store.insert_outbound({
      account_id: conversation.account_id,
      conversation_id: conversation.conversation_id,
      operation: "text",
      payload: {
        text: input.text,
        chat_id: conversation.external_chat_id,
        chat_type: conversation.chat_type,
        ...(conversation.thread_id ? { thread_id: conversation.thread_id } : {}),
      },
      available_at: input.available_at,
    });
    void this.kick_outbox();
    return { delivery_id: delivery.delivery_id, status: delivery.status };
  }

  /**
   * 为当前 Agent 拥有的 Telegram Conversation 创建可靠 Reaction 操作。
   *
   * 返回（中文）
   * - 返回受理回执：Reaction 已可靠入队，不代表已经送达平台。
   */
  react_from_agent(input: {
    /** 发起操作的 Agent ID。 */
    agent_id: string;
    /** 目标 Conversation 对应的 Session ID。 */
    session_id: string;
    /** 平台目标消息 ID。 */
    message_id: string;
    /** Telegram 支持的 Emoji。 */
    emoji: string;
    /** 是否使用平台的大号 Reaction 展示。 */
    is_big?: boolean;
  }): ChatDeliveryAcceptance {
    const conversation = this.store.get_conversation_by_session(input.session_id);
    if (!conversation || conversation.agent_id !== input.agent_id) {
      throw new Error("Chat conversation is not owned by the current Agent");
    }
    const runtime = this.accounts.get(conversation.account_id);
    if (runtime?.account.provider !== "telegram") {
      throw new Error("Chat reaction is currently supported only for Telegram Accounts");
    }
    const delivery = this.store.insert_outbound({
      account_id: conversation.account_id,
      conversation_id: conversation.conversation_id,
      operation: "reaction",
      payload: {
        chat_id: conversation.external_chat_id,
        chat_type: conversation.chat_type,
        message_id: input.message_id,
        emoji: input.emoji,
        is_big: input.is_big === true,
        ...(conversation.thread_id ? { thread_id: conversation.thread_id } : {}),
      },
    });
    void this.kick_outbox();
    return { delivery_id: delivery.delivery_id, status: delivery.status };
  }

  /** 停止一个 Account，不影响其他 Bot。 */
  async stop_account(account_id_input: string): Promise<void> {
    const account_id = String(account_id_input || "").trim();
    if (!account_id) return;
    const runtime = this.accounts.get(account_id);
    if (!runtime) return;
    this.accounts.delete(account_id);
    if (runtime.connector) await runtime.connector.stop();
    this.store.append_activity({ account_id, type: "account_stopped" });
  }

  /** 关闭可靠 Worker、在途 Turn、Connector 与 Store。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.inbox_timer) clearInterval(this.inbox_timer);
    if (this.outbox_timer) clearInterval(this.outbox_timer);
    if (this.health_timer) clearInterval(this.health_timer);
    this.inbox_timer = undefined;
    this.outbox_timer = undefined;
    this.health_timer = undefined;

    const turns = [...this.active_turns];
    await Promise.allSettled(turns.map(async (turn) => await turn.stop()));
    await Promise.allSettled(turns.map(async (turn) => await turn.finished));
    await Promise.allSettled([...this.active_inbox_tasks]);
    await Promise.allSettled(
      [...this.accounts.keys()].map(async (account_id) => await this.stop_account(account_id)),
    );
    this.store.close();
  }

  /** 创建并启动一个 Account Connector。 */
  private async start_account(account: ChatAccountConfig): Promise<void> {
    const runtime: ChatAccountRuntime = {
      account,
      state: account.enabled ? "connecting" : "disabled",
      reconnect_attempts: 0,
      next_reconnect_at: 0,
      reconnecting: false,
      reconnect_allowed: true,
    };
    this.accounts.set(account.account_id, runtime);
    if (!account.enabled) return;

    let connector: (BaseChatChannel & ChatConnector) | null;
    try {
      connector = await this.create_connector(account);
    } catch (error) {
      // 关键点（中文）：凭据或 Workspace 等配置错误无法通过重连恢复，直接等待用户修正。
      runtime.state = "error";
      runtime.last_error = normalize_error(error);
      runtime.reconnect_allowed = false;
      this.record_account_failure(runtime, runtime.last_error);
      return;
    }
    if (!connector) {
      runtime.state = "error";
      runtime.last_error = "Chat Account credentials are incomplete";
      runtime.reconnect_allowed = false;
      this.record_account_failure(runtime, runtime.last_error);
      return;
    }

    try {
      runtime.connector = connector;
      await connector.start();
      this.sync_runtime_status(runtime);
      this.store.append_activity({ account_id: account.account_id, type: "account_started" });
    } catch (error) {
      runtime.state = "error";
      runtime.last_error = normalize_error(error);
      this.record_account_failure(runtime, runtime.last_error);
    }
  }

  /** 记录一次 Account 级失败，并保留可展示原因。 */
  private record_account_failure(runtime: ChatAccountRuntime, error: string): void {
    this.store.append_activity({
      account_id: runtime.account.account_id,
      type: "account_error",
      detail: { error },
    });
    this.context.logger.error("Chat Account startup failed", {
      account_id: runtime.account.account_id,
      provider: runtime.account.provider,
      error,
    });
  }

  /**
   * 把 Connector 权威状态同步到 Account Runtime。
   *
   * 关键点（中文）
   * - 连接状态只以 Connector 的 `linkState` 为准，不再根据进程内标志推测。
   * - 失败原因必须写入 `last_error`，使 Desktop 能直接展示可操作信息。
   */
  private sync_runtime_status(runtime: ChatAccountRuntime): void {
    if (!runtime.account.enabled) {
      runtime.state = "disabled";
      runtime.last_error = undefined;
      return;
    }
    const status = runtime.connector?.getExecutorStatus();
    if (!status) {
      runtime.state = "disconnected";
      return;
    }
    runtime.state = status.linkState;
    runtime.last_error = status.linkState === "error"
      ? status.link_error || "Chat Account connection failed"
      : undefined;
  }

  /** 解析一个 Account 对外暴露的连接状态。 */
  private resolve_runtime_state(runtime: ChatAccountRuntime): ChatAccountConnectionState {
    this.sync_runtime_status(runtime);
    return runtime.state;
  }

  /** 根据 Account Provider 创建平台 Connector。 */
  private async create_connector(
    account: ChatAccountConfig,
  ): Promise<(BaseChatChannel & ChatConnector) | null> {
    const workspaces = await this.context.system.list_workspaces();
    const workspace = workspaces.find((item) => item.workspace_id === account.workspace_id);
    if (!workspace) throw new Error(`Workspace not found in City: ${account.workspace_id}`);
    const storage_path = path.join(this.context.storage.path, "accounts", account.account_id);
    await fs.ensureDir(storage_path);
    const connector_context = this.create_connector_context(
      account,
      workspace.workspace_path,
      storage_path,
    );
    if (account.provider === "telegram") {
      return createTelegramBot(
        { enabled: true, botToken: account.bot_token },
        connector_context,
      );
    }
    if (account.provider === "feishu") {
      return await createFeishuBot(
        {
          enabled: true,
          appId: account.app_id,
          appSecret: account.app_secret,
          domain: account.domain,
        },
        connector_context,
      );
    }
    return await createQQBot(
      {
        enabled: true,
        appId: account.app_id,
        appSecret: account.app_secret,
        sandbox: account.sandbox,
      },
      connector_context,
    );
  }

  /** 为单个 Connector 创建不包含 Agent 对象的稳定回调集合。 */
  private create_connector_context(
    account: ChatAccountConfig,
    workspace_path: string,
    storage_path: string,
  ): ChatConnectorContext {
    const access = new ChatAccessService({ data_path: this.context.storage.path });
    return {
      account_id: account.account_id,
      agent_id: account.agent_id,
      workspace_path,
      storage_path,
      logger: this.context.logger,
      evaluate_access: async (input) => access.evaluate({
        channel: account.provider,
        issuer: account.account_id,
        subject_id: String(input.user_id || "").trim(),
        display_name: String(input.username || "").trim() || undefined,
        chat_id: String(input.chatId || "").trim(),
        chat_type: String(input.chatType || "").trim() || undefined,
        chat_title: String(input.chatTitle || "").trim() || undefined,
      }),
      receive_message: async (input) => await this.receive_message(account, input),
      record_audit: async (input) => {
        this.store.append_activity({
          account_id: account.account_id,
          type: "inbound_audit",
          detail: {
            chat_id: input.chat_id,
            ...(input.message_id ? { message_id: input.message_id } : {}),
          },
        });
      },
      clear_conversation: async (input) => {
        const current = this.store.find_conversation({
          account_id: account.account_id,
          external_chat_id: input.chat_id,
          chat_type: input.chat_type || "unknown",
          thread_id: input.thread_id,
        });
        if (!current) return;
        const session = await this.context.system.create_agent_session({
          agent_id: current.agent_id,
          workspace_id: current.workspace_id,
          origin: {
            type: "chat",
            account_id: account.account_id,
            channel: account.provider,
            chat_id: current.external_chat_id,
            chat_type: current.chat_type,
            ...(current.thread_id ? { thread_id: current.thread_id } : {}),
            ...(current.title ? { chat_title: current.title } : {}),
          },
        });
        this.store.update_conversation({
          conversation_id: current.conversation_id,
          session_id: session.session_id,
        });
      },
    };
  }

  /** 可靠写入一条 Connector 消息并建立 Conversation 路由。 */
  private async receive_message(
    account: ChatAccountConfig,
    input: IncomingChatMessage,
  ): Promise<{ chat_key: string; position: number }> {
    if (this.disposed) throw new Error("Chat Runtime is disposed");
    const received_at = parse_received_at(input.receivedAt);
    const external_message_id = String(input.message_id || "").trim()
      || fallback_message_id(account.account_id, input, received_at);
    const inserted = this.store.insert_inbound({
      account_id: account.account_id,
      provider: account.provider,
      external_message_id,
      external_chat_id: String(input.chatId || "").trim(),
      chat_type: String(input.chatType || "unknown").trim() || "unknown",
      ...(typeof input.messageThreadId === "number"
        ? { thread_id: String(input.messageThreadId) }
        : {}),
      sender_id: String(input.user_id || "").trim(),
      ...(input.username ? { sender_name: input.username } : {}),
      ...(input.chatTitle ? { title: input.chatTitle } : {}),
      text: input.text,
      received_at,
    });
    if (!inserted.inserted && inserted.record.conversation_id) {
      return { chat_key: inserted.record.conversation_id, position: 0 };
    }

    const conversation = await this.resolve_conversation(account, input, received_at);
    this.store.accept_inbound(inserted.record.inbound_id, conversation.conversation_id);
    this.store.append_activity({
      account_id: account.account_id,
      conversation_id: conversation.conversation_id,
      type: "message_received",
      detail: { external_message_id },
    });
    void this.kick_inbox();
    return { chat_key: conversation.conversation_id, position: 1 };
  }

  /** 解析已有 Conversation，首次出现时先由目标 Agent 创建真实 Session。 */
  private async resolve_conversation(
    account: ChatAccountConfig,
    input: IncomingChatMessage,
    received_at: number,
  ): Promise<ChatConversationRecord> {
    const chat_type = String(input.chatType || "unknown").trim() || "unknown";
    const thread_id = typeof input.messageThreadId === "number"
      ? String(input.messageThreadId)
      : undefined;
    const route_key = [account.account_id, input.chatId, chat_type, thread_id || ""].join("\u0000");
    const existing = this.store.find_conversation({
      account_id: account.account_id,
      external_chat_id: input.chatId,
      chat_type,
      thread_id,
    });
    if (existing) {
      return this.store.resolve_conversation({
        account_id: account.account_id,
        external_chat_id: input.chatId,
        chat_type,
        thread_id,
        title: input.chatTitle,
        agent_id: existing.agent_id,
        workspace_id: existing.workspace_id,
        session_id: existing.session_id,
        last_message_at: received_at,
      });
    }
    const pending = this.conversation_resolutions.get(route_key);
    if (pending) return await pending;
    const resolution = (async () => {
      const session = await this.context.system.create_agent_session({
        agent_id: account.agent_id,
        workspace_id: account.workspace_id,
        origin: {
          type: "chat",
          account_id: account.account_id,
          channel: account.provider,
          chat_id: input.chatId,
          chat_type,
          ...(thread_id ? { thread_id } : {}),
          ...(input.chatTitle ? { chat_title: input.chatTitle } : {}),
        },
      });
      return this.store.resolve_conversation({
        account_id: account.account_id,
        external_chat_id: input.chatId,
        chat_type,
        thread_id,
        title: input.chatTitle,
        agent_id: account.agent_id,
        workspace_id: account.workspace_id,
        session_id: session.session_id,
        last_message_at: received_at,
      });
    })();
    this.conversation_resolutions.set(route_key, resolution);
    try {
      return await resolution;
    } finally {
      if (this.conversation_resolutions.get(route_key) === resolution) {
        this.conversation_resolutions.delete(route_key);
      }
    }
  }

  /** 启动可靠 Worker 与连接健康检查的周期触发器。 */
  private start_workers(): void {
    this.inbox_timer = setInterval(() => void this.kick_inbox(), WORKER_INTERVAL_MS);
    this.outbox_timer = setInterval(() => void this.kick_outbox(), WORKER_INTERVAL_MS);
    this.health_timer = setInterval(
      () => void this.kick_connection_health(),
      CONNECTION_HEALTH_INTERVAL_MS,
    );
    this.inbox_timer.unref?.();
    this.outbox_timer.unref?.();
    this.health_timer.unref?.();
    void this.kick_inbox();
    void this.kick_outbox();
  }

  /**
   * 检查全部 enabled Account 的连接健康度，并为失败的连接安排自愈重连。
   *
   * 关键点（中文）
   * - 只有 Connector 已停止（`running === false`）才重建，避免对能自恢复的链路频繁重连。
   * - 重连采用有上限的指数退避，成功后重置计数，避免失败时持续消耗资源。
   */
  private async kick_connection_health(): Promise<void> {
    if (this.disposed || this.health_running) return;
    this.health_running = true;
    try {
      for (const runtime of [...this.accounts.values()]) {
        if (this.disposed) return;
        if (!runtime.account.enabled) continue;
        this.sync_runtime_status(runtime);
        if (runtime.state === "connected") {
          if (runtime.reconnect_attempts > 0) {
            runtime.reconnect_attempts = 0;
            this.store.append_activity({
              account_id: runtime.account.account_id,
              type: "account_recovered",
            });
          }
          continue;
        }
        const status = runtime.connector?.getExecutorStatus();
        // 说明（中文）：Connector 仍在运行（例如轮询自愈中）时不主动重建。
        if (status?.running) continue;
        if (!runtime.reconnect_allowed) continue;
        if (runtime.reconnecting || Date.now() < runtime.next_reconnect_at) continue;
        await this.reconnect_account(runtime);
      }
    } finally {
      this.health_running = false;
    }
  }

  /** 对一个已停止的 Account 执行一次带退避的自愈重连。 */
  private async reconnect_account(runtime: ChatAccountRuntime): Promise<void> {
    const account = runtime.account;
    runtime.reconnecting = true;
    runtime.reconnect_attempts += 1;
    const attempt = runtime.reconnect_attempts;
    try {
      this.store.append_activity({
        account_id: account.account_id,
        type: "account_reconnecting",
        detail: { attempt, error: runtime.last_error ?? null },
      });
      if (runtime.connector) await runtime.connector.stop().catch(() => undefined);
      runtime.connector = undefined;
      const connector = await this.create_connector(account);
      if (!connector) throw new Error("Chat Account credentials are incomplete");
      runtime.connector = connector;
      await connector.start();
      this.sync_runtime_status(runtime);
    } catch (error) {
      runtime.last_error = normalize_error(error);
      this.store.append_activity({
        account_id: account.account_id,
        type: "account_error",
        detail: { error: runtime.last_error, attempt },
      });
      this.context.logger.warn("Chat Account reconnect failed", {
        account_id: account.account_id,
        provider: account.provider,
        attempt,
        error: runtime.last_error,
      });
    } finally {
      runtime.reconnecting = false;
      runtime.next_reconnect_at = Date.now() + reconnect_backoff_ms(attempt);
    }
  }

  /** 领取并执行下一条 Inbox。 */
  private async kick_inbox(): Promise<void> {
    if (this.disposed || this.inbox_running) return;
    this.inbox_running = true;
    try {
      while (
        !this.disposed &&
        this.active_inbox_tasks.size < MAX_CONCURRENT_CONVERSATIONS
      ) {
        const inbound = this.store.lease_next_inbound(INBOX_LEASE_MS);
        if (!inbound) return;
        const task = this.process_inbound(inbound).finally(() => {
          this.active_inbox_tasks.delete(task);
          void this.kick_inbox();
        });
        this.active_inbox_tasks.add(task);
      }
    } finally {
      this.inbox_running = false;
    }
  }

  /** 把一条 Inbox 提交给唯一 Conversation Session。 */
  private async process_inbound(inbound: ChatInboxRecord): Promise<void> {
    const conversation = inbound.conversation_id
      ? this.store.get_conversation(inbound.conversation_id)
      : null;
    if (!conversation || conversation.status !== "active") {
      this.store.fail_inbound(inbound.inbound_id, "Chat conversation is unavailable");
      return;
    }
    try {
      const query = buildQueuedUserMessageWithInfo({
        message_id: inbound.message.external_message_id,
        user_id: inbound.message.sender_id,
        username: inbound.message.sender_name,
        receivedAt: new Date(inbound.message.received_at).toISOString(),
        text: inbound.message.text,
      });
      const turn = await this.context.system.prompt_agent_session({
        agent_id: conversation.agent_id,
        workspace_id: conversation.workspace_id,
        session_id: conversation.session_id,
        origin_type: "chat",
        request_id: inbound.inbound_id,
        query,
      });
      this.active_turns.add(turn);
      this.store.append_activity({
        account_id: conversation.account_id,
        conversation_id: conversation.conversation_id,
        type: "turn_started",
        detail: { turn_id: turn.turn_id },
      });
      const result = await turn.finished;
      this.active_turns.delete(turn);
      if (!result.success) throw new Error(result.error || result.text || "Agent Turn failed");
      if (result.text.trim()) {
        this.store.insert_outbound({
          delivery_id: `delivery:inbound:${inbound.inbound_id}`,
          account_id: conversation.account_id,
          conversation_id: conversation.conversation_id,
          operation: "text",
          payload: {
            text: result.text,
            chat_id: inbound.message.external_chat_id,
            chat_type: inbound.message.chat_type,
            message_id: inbound.message.external_message_id,
            ...(inbound.message.thread_id ? { thread_id: inbound.message.thread_id } : {}),
          },
        });
      }
      this.store.complete_inbound(inbound.inbound_id);
      this.store.append_activity({
        account_id: conversation.account_id,
        conversation_id: conversation.conversation_id,
        type: "turn_completed",
        detail: { turn_id: turn.turn_id },
      });
      void this.kick_outbox();
    } catch (error) {
      const retry_at = inbound.attempt_count < MAX_ATTEMPTS
        ? Date.now() + retry_delay_ms(inbound.attempt_count)
        : undefined;
      this.store.fail_inbound(inbound.inbound_id, error, retry_at);
      this.store.append_activity({
        account_id: conversation.account_id,
        conversation_id: conversation.conversation_id,
        type: "turn_failed",
        detail: { error: normalize_error(error), retry_at: retry_at ?? null },
      });
    }
  }

  /** 领取并发送下一条 Outbox。 */
  private async kick_outbox(): Promise<void> {
    if (this.disposed || this.outbox_running) return;
    this.outbox_running = true;
    try {
      while (!this.disposed) {
        const delivery = this.store.lease_next_outbound(OUTBOX_LEASE_MS);
        if (!delivery) return;
        const runtime = this.accounts.get(delivery.account_id);
        const conversation = this.store.get_conversation(delivery.conversation_id);
        if (!conversation) {
          this.store.fail_outbound(delivery.delivery_id, "Chat conversation is unavailable");
          continue;
        }
        if (!runtime?.connector) {
          // 关键点（中文）：Account 离线只是暂时不可投递，不应消耗有限重试次数。
          this.store.requeue_outbound(delivery.delivery_id, OFFLINE_REQUEUE_DELAY_MS);
          return;
        }
        try {
          if (delivery.operation === "attachment") {
            throw new Error(`Unsupported Chat delivery operation: ${delivery.operation}`);
          }
          const payload = delivery.payload;
          const thread_value = Number(payload.thread_id);
          const route = {
            chatId: String(payload.chat_id || conversation.external_chat_id),
            chatType: String(payload.chat_type || conversation.chat_type),
            message_id: String(payload.message_id || "") || undefined,
            ...(Number.isFinite(thread_value) ? { messageThreadId: thread_value } : {}),
          };
          const result = delivery.operation === "reaction"
            ? await runtime.connector.sendToolAction({
                ...route,
                action: "react",
                reactionEmoji: String(payload.emoji || ""),
                reactionIsBig: payload.is_big === true,
              })
            : await runtime.connector.sendToolText({
                ...route,
                text: String(payload.text || ""),
                reply_to_message: true,
              });
          if (!result.success) throw new Error(result.error || "Chat delivery failed");
          this.store.complete_outbound(delivery.delivery_id);
          this.store.append_activity({
            account_id: delivery.account_id,
            conversation_id: delivery.conversation_id,
            type: "delivery_completed",
          });
        } catch (error) {
          const retry_at = delivery.attempt_count < MAX_ATTEMPTS
            ? Date.now() + retry_delay_ms(delivery.attempt_count)
            : undefined;
          this.store.fail_outbound(delivery.delivery_id, error, retry_at);
          this.store.append_activity({
            account_id: delivery.account_id,
            conversation_id: delivery.conversation_id,
            type: "delivery_failed",
            detail: { error: normalize_error(error), retry_at: retry_at ?? null },
          });
        }
      }
    } finally {
      this.outbox_running = false;
    }
  }
}

/** 解析平台时间，非法值使用当前时间。 */
function parse_received_at(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** 为缺少平台 ID 的消息生成内容稳定回退键。 */
function fallback_message_id(
  account_id: string,
  input: IncomingChatMessage,
  received_at: number,
): string {
  return `fallback_${createHash("sha256").update(JSON.stringify({
    account_id,
    chat_id: input.chatId,
    user_id: input.user_id,
    text: input.text,
    received_at,
  })).digest("hex").slice(0, 24)}`;
}

/** 根据失败次数计算有上限的指数退避。 */
function retry_delay_ms(attempt_count: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, attempt_count - 1));
}

/** 根据自愈重连次数计算有上限的指数退避。 */
function reconnect_backoff_ms(attempt_count: number): number {
  const exponent = Math.max(0, Math.trunc(attempt_count) - 1);
  return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** exponent);
}

/** 把未知错误规范化为日志与持久化文本。 */
function normalize_error(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
