/** Messenger Power 的 City 级 Bot Account、Inbox、Outbox 与 Agent Turn 运行时。 */

import path from "node:path";
import { SESSION_KIND_CHANNEL, SESSION_TYPE_CHAT, type SessionTurnCommittedHookValue } from "@downcity/type";
import { commit_messenger_completion } from "./MessengerCompletion.js";
import { MessengerTyping } from "./MessengerTyping.js";
import { MessengerAccounts } from "./MessengerAccounts.js";
import type { SessionExecutionStateHookValue } from "@downcity/type";
import fs from "fs-extra";
import { createHash } from "node:crypto";
import type {
  PowerHostSessionTurn,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type { BaseMessengerChannel, IncomingMessengerMessage } from "@/messenger/channels/BaseMessengerChannel.js";
import { createTelegramBot } from "@/messenger/channels/telegram/Bot.js";
import { createFeishuBot } from "@/messenger/channels/feishu/Feishu.js";
import { MessengerAccessService } from "@/messenger/access/MessengerAccessService.js";
import { build_inbound_prompt_parts } from "./InboundPromptParts.js";
import { build_messenger_environment_input } from "./MessengerEnvironment.js";
import { MessengerStore } from "@/messenger/storage/MessengerStore.js";
import { read_messenger_accounts_config } from "@/messenger/accounts/MessengerAccountConfig.js";
import type {
  MessengerAccountConfig,
  MessengerAccountConnectionState,
} from "@/messenger/types/MessengerAccount.js";
import type { MessengerConnector, MessengerConnectorContext } from "@/messenger/types/MessengerConnector.js";
import type {
  MessengerConversationRecord,
  MessengerDeliveryAcceptance,
  MessengerInboxRecord,
} from "@/messenger/types/MessengerReliability.js";

const WORKER_INTERVAL_MS = 400;
const INBOX_LEASE_MS = 10 * 60_000;
const OUTBOX_LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CONCURRENT_CONVERSATIONS = 4;
/** 连接健康检查周期。 */
const CONNECTION_HEALTH_INTERVAL_MS = 15_000;
/** Account 未连接时 Requeue Outbox 的延后时间，不消耗重试次数。 */
const OFFLINE_REQUEUE_DELAY_MS = 30_000;

/** Messenger Runtime 对 Desktop 暴露的 Account 状态。 */
export interface MessengerRuntimeAccountState {
  /** 当前连接状态。 */
  state: MessengerAccountConnectionState;
  /** 最近一次连接错误。 */
  last_error?: string;
}

/** 一个 City 中唯一的 Messenger 可靠消息运行时。 */
export class MessengerRuntime {
  /** 当前 Power 的唯一可靠状态 Store。 */
  readonly store: MessengerStore;
  /** 实际执行期间的临时 typing 租约；不持久化到 Outbox。 */
  private readonly typing: MessengerTyping;

  /** 账号连接队列与后台连接任务归本 Runtime 所有。 */
  private readonly account_lifecycle: MessengerAccounts;
  /** 可靠 Worker 始终读取账号管理器持有的当前连接实例。 */
  private get accounts() { return this.account_lifecycle.accounts; }
  /** 卸载前必须收口的 Inbox/Outbox Worker 调度任务。 */
  private readonly worker_tasks = new Set<Promise<unknown>>();
  /** 并发卸载调用共享同一个收尾过程。 */
  private dispose_promise?: Promise<void>;
  /** 当前仍在执行的 Agent Turn。 */
  private readonly active_turns = new Set<PowerHostSessionTurn>();
  /** 当前由 Inbox 调度器持有的异步任务。 */
  private readonly active_inbox_tasks = new Set<Promise<void>>();
  /** 同一外部路由并发首条消息共享的 Conversation 创建任务。 */
  private readonly conversation_resolutions = new Map<string, Promise<MessengerConversationRecord>>();
  /** Inbox Worker 周期 Timer。 */
  private inbox_timer?: ReturnType<typeof setInterval>;
  /** Outbox Worker 周期 Timer。 */
  private outbox_timer?: ReturnType<typeof setInterval>;
  /** 连接健康检查 Timer。 */
  private health_timer?: ReturnType<typeof setInterval>;
  /** Inbox Worker 当前是否正在调度。 */
  private inbox_running = false;
  /** Outbox Worker 当前是否正在调度。 */
  private outbox_running = false;
  /** Runtime 是否已经停止接收新工作。 */
  private disposed = false;

  /** 创建 Runtime 并打开生命周期 Store。 */
  constructor(private readonly context: PowerLifecycleContext) {
    this.store = new MessengerStore(context.storage.path);
    this.typing = new MessengerTyping(async (route) => {
      const connector = this.accounts.get(route.account_id)?.connector;
      if (!connector) return { success: false };
      return await connector.sendToolAction({
        chatId: route.chat_id,
        messageThreadId: route.thread_id,
        action: "typing",
      });
    }, () => { this.context.logger.warn("Telegram typing heartbeat failed; reply execution continues"); });
    this.account_lifecycle = new MessengerAccounts({
      logger: context.logger,
      store: this.store,
      create_connector: (account) => this.create_connector(account),
      stop_typing: (account_id) => this.typing.stop_account(account_id),
    });
  }

  /** 统一响应直接入站和后台续轮的实际执行状态，空档立即释放租约。 */
  sync_execution(agent_id: string, event: SessionExecutionStateHookValue, abort_signal: AbortSignal): void {
    const source_key = JSON.stringify([agent_id, event.session_id, event.turn_id]);
    if (event.state === "idle") { this.typing.stop(source_key); return; }
    if (this.disposed) return;
    const conversation = this.store.get_conversation_by_session(event.session_id);
    if (!conversation || conversation.agent_id !== agent_id || conversation.status !== "active" || conversation.chat_type === "channel") return;
    const runtime = this.accounts.get(conversation.account_id);
    if (runtime?.account.provider !== "telegram" || !runtime.connector) return;
    const thread_id = Number(conversation.thread_id);
    this.typing.start(source_key, {
      account_id: conversation.account_id,
      chat_id: conversation.external_chat_id,
      ...(Number.isSafeInteger(thread_id) && thread_id > 0 ? { thread_id } : {}),
    }, abort_signal);
  }

  /** 恢复本地可靠状态与路由后返回；账号连接在受管理的后台任务中并行执行。 */
  async initialize(configured_accounts: MessengerAccountConfig[]): Promise<void> {
    const started_at = performance.now();
    this.store.recover_expired_leases();
    // 关键点（中文）：旧 Work 历史仍归原 Agent 所有，外部聊天从新 Channel Session 继续。
    // 每条路由独立提交，启动中断后仅重试尚未完成的升级。
    for (const conversation of this.store.list_pending_channel_conversations()) {
      this.context.abort_signal.throwIfAborted();
      const session = await this.context.system.create_agent_session({
        agent_id: conversation.agent_id,
        type: SESSION_TYPE_CHAT, kind: SESSION_KIND_CHANNEL,
      });
      this.context.abort_signal.throwIfAborted();
      this.store.complete_channel_session_upgrade(conversation.conversation_id, session.session_id);
    }
    this.context.abort_signal.throwIfAborted();
    if (this.disposed) return;
    this.account_lifecycle.initialize(configured_accounts);
    this.start_workers();
    this.context.logger.info("Messenger local runtime ready", { elapsed_ms: Math.round(performance.now() - started_at), account_count: configured_accounts.length });
  }

  /** 所有 Channel 轮次共用的回复出口，包括委派结果触发的后续执行。 */
  commit_completion(agent_id: string, event: SessionTurnCommittedHookValue): void {
    if (this.disposed) throw new Error("Messenger is shutting down; completion retained for retry");
    commit_messenger_completion(this.store, agent_id, event);
    void this.kick_outbox();
  }

  /** 返回指定 Account 当前运行状态。 */
  get_account_state(account_id: string): MessengerRuntimeAccountState | undefined {
    return this.account_lifecycle.get_account_state(String(account_id || ""));
  }

  /** 平台提示词使用当前会话的 Conversation 和 Account 配置。 */
  session_provider(agent_id: string, session_id: string): MessengerAccountConfig["provider"] | undefined {
    const conversation = this.store.get_conversation_by_session(session_id);
    if (conversation?.agent_id !== agent_id) return undefined;
    return read_messenger_accounts_config(this.context.config.get()).accounts.find(
      (account) => account.account_id === conversation.account_id,
    )?.provider;
  }

  /** 使用最新配置重启一个 Account，并重置自愈重连计数。 */
  async restart_account(account: MessengerAccountConfig): Promise<void> {
    await this.account_lifecycle.restart_account(account);
  }

  /**
   * 重启全部 enabled Account。
   *
   * 说明（中文）
   * - 供网络代理等运行环境发生变化的场景使用，立即使用新配置重建连接。
   */
  async restart_enabled_accounts(): Promise<void> {
    await this.account_lifecycle.restart_enabled_accounts();
  }

  /** 测试一个已创建 Account 的平台连通性。 */
  async test_account(account_id: string) {
    const runtime = this.accounts.get(String(account_id || "").trim());
    if (!runtime?.connector) throw new Error(`Messenger Account is not running: ${account_id}`);
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
  }): MessengerDeliveryAcceptance {
    if (this.disposed) throw new Error("Messenger is shutting down");
    const conversation = this.store.get_conversation_by_session(input.session_id);
    if (!conversation || conversation.agent_id !== input.agent_id) {
      throw new Error("Messenger conversation is not owned by the current Agent");
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
  }): MessengerDeliveryAcceptance {
    if (this.disposed) throw new Error("Messenger is shutting down");
    const conversation = this.store.get_conversation_by_session(input.session_id);
    if (!conversation || conversation.agent_id !== input.agent_id) {
      throw new Error("Messenger conversation is not owned by the current Agent");
    }
    const runtime = this.accounts.get(conversation.account_id);
    if (runtime?.account.provider !== "telegram") {
      throw new Error("Messenger reaction is currently supported only for Telegram Accounts");
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
    if (this.disposed) { await this.dispose_promise; return; }
    await this.account_lifecycle.stop_account(String(account_id_input || ""));
  }

  /** 关闭可靠 Worker、在途 Turn、Connector 与 Store。 */
  dispose(): Promise<void> {
    if (!this.dispose_promise) {
      const operation = this.run_dispose();
      this.dispose_promise = operation;
      void operation.catch(() => { if (this.dispose_promise === operation) this.dispose_promise = undefined; });
    }
    return this.dispose_promise;
  }

  /** 先禁止新增工作并停止连接，再等待所有回调和投递落盘后关闭 Store。 */
  private async run_dispose(): Promise<void> {
    this.disposed = true;
    this.typing.dispose();
    if (this.inbox_timer) clearInterval(this.inbox_timer);
    if (this.outbox_timer) clearInterval(this.outbox_timer);
    if (this.health_timer) clearInterval(this.health_timer);
    this.inbox_timer = undefined;
    this.outbox_timer = undefined;
    this.health_timer = undefined;

    const account_shutdown = Promise.allSettled([this.account_lifecycle.dispose()]);
    const turns = [...this.active_turns];
    await Promise.allSettled(turns.map(async (turn) => await turn.stop()));
    await Promise.allSettled(turns.map(async (turn) => await turn.finished));
    await Promise.allSettled([...this.active_inbox_tasks]);
    await Promise.allSettled([...this.worker_tasks]);
    const results = await account_shutdown;
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Messenger shutdown failed");
    this.store.close();
  }

  /** 根据 Account Provider 创建平台 Connector。 */
  private async create_connector(
    account: MessengerAccountConfig,
  ): Promise<(BaseMessengerChannel & MessengerConnector) | null> {
    const storage_path = path.join(this.context.storage.path, "accounts", account.account_id);
    await fs.ensureDir(storage_path);
    // 关键点（中文）：Account 只描述传输身份，缺少默认 Workspace 不应阻止 Bot 连接。
    // 附件根目录无法确定时退化为 Messenger 自有目录，既有配置行为保持不变。
    const connector_context = this.create_connector_context(
      account,
      storage_path,
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
    // 平台类型已在上方穷尽；新增平台时这里会先产生编译错误，避免静默走错分支。
    const exhaustive_account: never = account;
    throw new Error(`Unsupported Messenger provider: ${JSON.stringify(exhaustive_account)}`);
  }

  /** 为单个 Connector 创建不包含 Agent 对象的稳定回调集合。 */
  private create_connector_context(
    account: MessengerAccountConfig,
    workspace_path: string,
    storage_path: string,
  ): MessengerConnectorContext {
    const access = new MessengerAccessService({ data_path: this.context.storage.path });
    return {
      account_id: account.account_id,
      agent_id: normalize_text(account.agent_id),
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
      receive_message: async (input) => await this.track_task(this.receive_message(account, input)),
      record_audit: async (input) => {
        if (this.disposed) return;
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
        if (this.disposed) return;
        await this.track_task((async () => {
          const current = this.store.find_conversation({
            account_id: account.account_id,
            external_chat_id: input.chat_id,
            chat_type: input.chat_type || "unknown",
            thread_id: input.thread_id,
          });
          if (!current) return;
          const session = await this.context.system.create_agent_session({
            agent_id: current.agent_id,
            type: SESSION_TYPE_CHAT, kind: SESSION_KIND_CHANNEL,
          });
          this.store.update_conversation({
            conversation_id: current.conversation_id,
            session_id: session.session_id,
          });
        })());
      },
    };
  }

  /** 可靠写入一条 Connector 消息并建立 Conversation 路由。 */
  private async receive_message(
    account: MessengerAccountConfig,
    input: IncomingMessengerMessage,
  ): Promise<{ chat_key: string; position: number }> {
    if (this.disposed) throw new Error("Messenger Runtime is disposed");
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
    account: MessengerAccountConfig,
    input: IncomingMessengerMessage,
    received_at: number,
  ): Promise<MessengerConversationRecord> {
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
        session_id: existing.session_id,
        last_message_at: received_at,
      });
    }
    const pending = this.conversation_resolutions.get(route_key);
    if (pending) return await pending;
    const resolution = (async () => {
      const target = await this.resolve_account_target(account);
      const session = await this.context.system.create_agent_session({
        agent_id: target,
        type: SESSION_TYPE_CHAT, kind: SESSION_KIND_CHANNEL,
      });
      return this.store.resolve_conversation({
        account_id: account.account_id,
        external_chat_id: input.chatId,
        chat_type,
        thread_id,
        title: input.chatTitle,
        agent_id: target,
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

  /**
   * 解析一次出站投递允许的本地附件根目录。
   *
   * 关键点（中文）
   * - 项目目录取自 Channel Session 的当前执行上下文，Conversation 不复制目录绑定。
   * - 同时允许 Channel 自有存储目录，使收到的附件可以原样回传。
   * - 顺序即优先级：首个根目录同时作为相对路径的解析基准。
   */
  private async resolve_outbound_attachment_roots(
    conversation: MessengerConversationRecord,
  ): Promise<string[]> {
    const roots: string[] = [];
    const workspace = await this.context.system.get_agent_session_workspace({
      agent_id: conversation.agent_id,
      session_id: conversation.session_id,
      type: SESSION_TYPE_CHAT,
    });
    if (workspace) roots.push(workspace.workspace_path);
    roots.push(path.join(this.context.storage.path, "accounts", conversation.account_id));
    return roots;
  }

  /**
   * 解析一条 Account 在新 Conversation 上的实际执行目标。
   *
   * 说明（中文）
   * - Account 的 agent_id 仅作为新外部聊天的初始绑定，不绑定 Workspace。
   * - 缺失时按 City 现状兜底，且只在候选唯一时自动选用，避免静默路由到错误对象。
   * - 已有 Conversation 不会走到这里，它始终沿用自身记录的绑定。
   */
  private async resolve_account_target(account: MessengerAccountConfig): Promise<string> {
    const agents = await this.context.system.list_agents();
    const agent_id = normalize_text(account.agent_id) || pick_unique_target(
      agents.map((item) => item.agent_id),
      `Messenger Account "${account.account_id}" has no agent_id`,
    );
    if (!agents.some((agent) => agent.agent_id === agent_id)) {
      throw new Error(`Messenger Account references an unknown Agent: ${agent_id}`);
    }
    return agent_id;
  }

  /** 启动可靠 Worker 与连接健康检查的周期触发器。 */
  private start_workers(): void {
    this.inbox_timer = setInterval(() => void this.kick_inbox(), WORKER_INTERVAL_MS);
    this.outbox_timer = setInterval(() => void this.kick_outbox(), WORKER_INTERVAL_MS);
    this.health_timer = setInterval(
      () => void this.account_lifecycle.check_health().catch((error) => {
        this.context.logger.warn("Messenger connection health check failed", { error: String(error) });
      }),
      CONNECTION_HEALTH_INTERVAL_MS,
    );
    this.inbox_timer.unref?.();
    this.outbox_timer.unref?.();
    this.health_timer.unref?.();
    void this.kick_inbox();
    void this.kick_outbox();
  }

  /** 跟踪所有可能异步写 Store 的 Worker 与 Connector 回调，释放时统一等待。 */
  private track_task<T>(task: Promise<T>): Promise<T> {
    this.worker_tasks.add(task);
    void task.then(() => this.worker_tasks.delete(task), () => this.worker_tasks.delete(task));
    return task;
  }

  /** 周期调度失败保留可靠状态，后续周期继续尝试。 */
  private kick_inbox(): Promise<void> {
    return this.track_task(this.drain_inbox()).catch((error) => {
      this.context.logger.error("Messenger Inbox worker failed", { error: String(error) });
    });
  }

  /** 领取并执行下一条 Inbox。 */
  private async drain_inbox(): Promise<void> {
    if (this.disposed || this.inbox_running) return;
    this.inbox_running = true;
    try {
      while (
        !this.disposed &&
        this.active_inbox_tasks.size < MAX_CONCURRENT_CONVERSATIONS
      ) {
        const inbound = this.store.lease_next_inbound(INBOX_LEASE_MS);
        if (!inbound) return;
        const task = this.process_inbound(inbound).catch((error) => {
          this.context.logger.error("Messenger Inbox task failed", { error: String(error) });
        }).finally(() => {
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
  private async process_inbound(inbound: MessengerInboxRecord): Promise<void> {
    const conversation = inbound.conversation_id
      ? this.store.get_conversation(inbound.conversation_id)
      : null;
    if (!conversation || conversation.status !== "active") {
      this.store.fail_inbound(inbound.inbound_id, "Messenger conversation is unavailable");
      return;
    }
    try {
      const query = build_inbound_prompt_parts({
        info: {
          message_id: inbound.message.external_message_id,
          user_id: inbound.message.sender_id,
          username: inbound.message.sender_name,
          receivedAt: new Date(inbound.message.received_at).toISOString(),
          text: inbound.message.text,
        },
        environment: build_messenger_environment_input({
          conversation,
          channel: inbound.message.provider,
        }),
      });
      const turn = await this.context.system.prompt_agent_session({
        // 平台 sender 与账号共同标识输入对象，群路由不作为用户身份。
        actor: { kind: "user", user_id: JSON.stringify([conversation.account_id, inbound.message.provider, inbound.message.sender_id]) },
        agent_id: conversation.agent_id,
        session_id: conversation.session_id,
        type: SESSION_TYPE_CHAT,
        request_id: inbound.inbound_id,
        query: [
          { type: "context", tag: "messenger_request", context: JSON.stringify({ inbound_id: inbound.inbound_id }) },
          ...query,
        ],
      });
      this.active_turns.add(turn);
      if (this.disposed) {
        await turn.stop();
        await turn.finished.finally(() => { this.active_turns.delete(turn); });
        throw new Error("Messenger is shutting down; inbound retained for retry");
      }
      this.store.append_activity({
        account_id: conversation.account_id,
        conversation_id: conversation.conversation_id,
        type: "turn_started",
        detail: { turn_id: turn.turn_id },
      });
      const result = await turn.finished.finally(() => { this.active_turns.delete(turn); });
      if (this.disposed) throw new Error("Messenger is shutting down; inbound retained for retry");
      // 最终回复统一由完成 Hook 入 Outbox。执行失败不重复提交同一幂等输入。
      if (!result.success) {
        this.store.fail_inbound(inbound.inbound_id, result.error || "Agent Turn failed");
        return;
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

  /** 观察后台外发错误，同时为卸载持有在途投递任务。 */
  private kick_outbox(): Promise<void> {
    return this.track_task(this.drain_outbox()).catch((error) => {
      this.context.logger.error("Messenger Outbox worker failed", { error: String(error) });
    });
  }

  /** 领取并发送下一条 Outbox。 */
  private async drain_outbox(): Promise<void> {
    if (this.disposed || this.outbox_running) return;
    this.outbox_running = true;
    try {
      while (!this.disposed) {
        const delivery = this.store.lease_next_outbound(OUTBOX_LEASE_MS);
        if (!delivery) return;
        const runtime = this.accounts.get(delivery.account_id);
        const conversation = this.store.get_conversation(delivery.conversation_id);
        if (!conversation) {
          this.store.fail_outbound(delivery.delivery_id, "Messenger conversation is unavailable");
          continue;
        }
        if (!runtime?.connector || this.get_account_state(delivery.account_id)?.state !== "connected") {
          // 连接中与离线只推迟投递，不消耗有限重试次数；其他账号仍可继续外发。
          this.store.requeue_outbound(delivery.delivery_id, OFFLINE_REQUEUE_DELAY_MS);
          continue;
        }
        try {
          if (delivery.operation === "attachment") {
            throw new Error(`Unsupported Messenger delivery operation: ${delivery.operation}`);
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
                attachment_roots: await this.resolve_outbound_attachment_roots(conversation),
              });
          if (!result.success) throw new Error(result.error || "Messenger delivery failed");
          this.store.complete_outbound(delivery.delivery_id);
          this.store.append_activity({
            account_id: delivery.account_id,
            conversation_id: delivery.conversation_id,
            type: "delivery_completed",
          });
        } catch (error) {
          if (this.disposed || this.accounts.get(delivery.account_id) !== runtime
            || this.get_account_state(delivery.account_id)?.state !== "connected") {
            this.store.requeue_outbound(delivery.delivery_id, OFFLINE_REQUEUE_DELAY_MS);
            continue;
          }
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

/**
 * 在候选唯一时返回该候选，否则抛出可执行的配置错误。
 *
 * 关键点（中文）
 * - 0 个候选说明 City 中不存在可兜底对象。
 * - 多个候选无法安全猜测，必须显式配置，避免消息被静默路由到错误 Agent。
 */
function pick_unique_target(candidates: string[], message: string): string {
  const only = candidates.length === 1 ? candidates[0] : undefined;
  if (typeof only === "string") return only;
  if (candidates.length === 0) {
    throw new Error(`${message}, and City has no candidate to fall back to`);
  }
  throw new Error(`${message}, and City has ${candidates.length} candidates; configure it explicitly`);
}

/** 归一化可选的配置文本。 */
function normalize_text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 解析平台时间，非法值使用当前时间。 */
function parse_received_at(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** 为缺少平台 ID 的消息生成内容稳定回退键。 */
function fallback_message_id(
  account_id: string,
  input: IncomingMessengerMessage,
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

/** 把未知错误规范化为日志与持久化文本。 */
function normalize_error(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
