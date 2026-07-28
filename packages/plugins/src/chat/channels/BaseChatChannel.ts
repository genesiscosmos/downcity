/**
 * Chat channel 基类。
 *
 * 关键点（中文）
 * - 通过 context 显式注入 runtime 依赖。
 * - 统一注册 dispatcher，暴露 sendText/sendAction 能力。
 * - 基类只保留 Chat Access、工具发送与入站编排；存储/队列细节已下沉到辅助模块。
 */

import { registerChatSender } from "@/chat/runtime/ChatSendRegistry.js";
import type {
  ChatDispatchAction,
  ChatDispatchChannel,
  ChatDispatchSendActionParams,
  ChatDispatcher,
} from "@/chat/types/ChatDispatcher.js";
import type { Logger } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import { resolveChatQueueStore } from "@/chat/runtime/ChatQueue.js";
import { deleteChatSessionById } from "@/chat/runtime/ChatSessionDelete.js";
import {
  create_chat_access_service,
  resolve_chat_access_issuer,
} from "@/chat/access/ChatAccessRuntime.js";
import type { ChatAccessDecision } from "@/chat/types/ChatAccess.js";
import {
  appendToolOutboundChannelHistory,
  resolveChannelSessionId,
  type ChannelUserMessageMeta,
} from "./BaseChatChannelSupport.js";
import {
  enqueueAuditChannelMessage,
  enqueueExecChannelMessage,
} from "./BaseChatChannelQueue.js";

/**
 * Channel chat_key 计算入参。
 *
 * 说明（中文）
 * - chatId 必填；其余字段用于区分 topic/thread/消息上下文。
 * - 不同平台可按需消费这些字段。
 */
export type ChannelChatKeyParams = {
  chatId: string;
  messageThreadId?: number;
  chatType?: string;
  message_id?: string;
};

export type ChannelSendTextParams = ChannelChatKeyParams & {
  text: string;
  reply_to_message?: boolean;
};

export type ChannelSendActionParams = ChannelChatKeyParams & {
  action: ChatDispatchAction;
  reactionEmoji?: string;
  reactionIsBig?: boolean;
};

/**
 * 入站消息统一结构（跨平台最小公共字段）。
 *
 * 说明（中文）
 * - chatId 是平台原始会话标识（非 session_id）。
 * - messageThreadId 用于支持 topic / thread 细粒度并发。
 * - 该结构只描述“接收侧”，不包含平台发送参数。
 */
export type IncomingChatMessage = {
  chatId: string;
  text: string;
  chatType?: string;
  message_id?: string;
  messageThreadId?: number;
  user_id?: string;
  username?: string;
  /**
   * 当前消息接收时间。
   *
   * 说明（中文）
   * - 推荐传入 ISO8601 字符串。
   * - 渠道能拿到平台消息时间时优先使用平台时间，否则使用收到/入队时刻。
   */
  receivedAt?: string;
  /**
   * 用户时区。
   *
   * 说明（中文）
   * - 仅在上游显式提供时传入。
   * - 第三方 IM 平台 bot 通常不会直接提供该字段。
   */
  userTimezone?: string;
  /**
   * 会话展示名（群名/频道名/私聊对象名）。
   *
   * 说明（中文）
   * - 由各平台适配器 best-effort 提供。
   * - 用于 Context 列表展示，不参与路由。
   */
  chatTitle?: string;
  /**
   * 入站附加元信息。
   *
   * 说明（中文）
   * - 用于透传 reply 上下文等平台特有信息。
   * - 会进入 history / context metadata，但不改变基础路由语义。
   */
  extra?: ChannelUserMessageMeta;
};

/**
 * 入站 Chat Access 判定输入。
 */
export type IncomingChatAccessParams = {
  chatId: string;
  chatType?: string;
  user_id?: string;
  username?: string;
  chatTitle?: string;
};

/**
 * 入站 Chat Access 判定结果。
 */
export type IncomingChatAccessResult = ChatAccessDecision;

/**
 * Chat channel 基类。
 */
export abstract class BaseChatChannel {
  readonly channel: ChatDispatchChannel;
  protected readonly context: PluginContext;
  protected readonly rootPath: string;
  protected readonly logger: Logger;
  private readonly access_notice_sent_at = new Map<string, number>();

  protected constructor(params: {
    channel: ChatDispatchChannel;
    context: PluginContext;
  }) {
    this.channel = params.channel;
    this.context = params.context;
    this.rootPath = params.context.workspace_path;
    this.logger = params.context.logger;

    const dispatcher: ChatDispatcher = {
      sendText: async (p) => this.sendToolText(p),
    };
    if (typeof this.sendActionToPlatform === "function") {
      dispatcher.sendAction = async (p) => this.sendToolAction(p);
    }
    registerChatSender(this.channel, dispatcher);
  }

  protected abstract getChatKey(params: ChannelChatKeyParams): string;

  protected abstract sendTextToPlatform(
    params: ChannelSendTextParams,
  ): Promise<void>;

  /**
   * SDK 未绑定 City Chat Account 时的平台稳定 issuer 回退值。
   */
  protected getAccessIssuerFallback(): string {
    return "";
  }

  /**
   * 格式化 Chat Access 中需要原样展示的值。
   *
   * 说明（中文）
   * - 默认返回纯文本，避免通用层绑定具体平台的富文本语法。
   * - 支持富文本的平台可覆写此方法，确保标识符和命令可被准确展示、复制。
   */
  protected format_access_code(value: string): string {
    return value;
  }

  /**
   * 格式化 Chat Access 管理命令。
   *
   * 说明（中文）
   * - 默认复用平台的原样值格式，避免通用层引入具体富文本语法。
   * - 平台可单独覆写为块级代码，改善长命令的阅读和复制体验。
   */
  protected format_access_command(command: string): string {
    return this.format_access_code(command);
  }

  protected sendActionToPlatform?(
    params: ChannelSendActionParams,
  ): Promise<void>;

  /**
   * 发送 Chat Access 提示文本。
   *
   * 关键点（中文）
   * - 一律按普通消息发送，不挂 reply，避免把“权限提示”误挂到某条消息下面。
   */
  protected async sendAccessText(params: {
    chatId: string;
    text: string;
    chatType?: string;
    messageThreadId?: number;
  }): Promise<void> {
    const notice_key = `${params.chatId}:${params.text}`;
    const current_time = Date.now();
    const last_sent_at = this.access_notice_sent_at.get(notice_key) || 0;
    if (current_time - last_sent_at < 60_000) return;
    if (this.access_notice_sent_at.size >= 1_000) this.access_notice_sent_at.clear();
    this.access_notice_sent_at.set(notice_key, current_time);
    await this.sendTextToPlatform({
      chatId: params.chatId,
      text: params.text,
      ...(typeof params.chatType === "string" ? { chatType: params.chatType } : {}),
      ...(typeof params.messageThreadId === "number"
        ? { messageThreadId: params.messageThreadId }
        : {}),
    });
  }

  /**
   * 执行入站 Chat Access 判定。
   */
  protected async evaluateIncomingAccess(
    params: IncomingChatAccessParams,
  ): Promise<IncomingChatAccessResult> {
    const issuer =
      resolve_chat_access_issuer(this.context, this.channel) ||
      String(this.getAccessIssuerFallback() || "").trim();
    return create_chat_access_service(this.context).evaluate({
      channel: this.channel,
      issuer,
      subject_id: String(params.user_id || "").trim(),
      display_name: String(params.username || "").trim() || undefined,
      chat_id: String(params.chatId || "").trim(),
      chat_type: String(params.chatType || "").trim() || undefined,
      chat_title: String(params.chatTitle || "").trim() || undefined,
    });
  }

  /**
   * 生成 Chat Access 拒绝提示文案。
   */
  protected buildAccessBlockedText(params: {
    result: IncomingChatAccessResult;
  }): string {
    const agent_id = String(this.context.agent_id || "agent").trim() || "agent";
    const displayed_agent_id = this.format_access_code(agent_id);
    if (params.result.reason === "identity_missing") {
      return "当前平台身份无法识别，请联系管理员检查 Chat 账号配置。";
    }
    if (params.result.reason === "grant_denied") {
      return `当前账号未获准访问 Agent "${displayed_agent_id}"。`;
    }
    const request_id = String(params.result.request_id || "").trim();
    if (!request_id) {
      return `当前账号尚未获准访问 Agent "${displayed_agent_id}"。`;
    }
    const displayed_request_id = this.format_access_code(request_id);
    const approval_command = this.format_access_command(
      `city plugin action chat access-approve ${agent_id} --input '{"request_id":"${request_id}"}' --token <token>`,
    );
    return [
      `当前账号尚未获准访问 Agent "${displayed_agent_id}"。`,
      "",
      `访问请求：${displayed_request_id}`,
      "",
      "请将下面命令发送给管理员：",
      approval_command,
    ].join("\n");
  }

  /**
   * 是否在 `sendToolText` 成功后自动写入 outbound chat history。
   *
   * 关键点（中文）
   * - 默认开启，覆盖 QQ / Feishu 等未自行写 outbound history 的渠道。
   * - 已有独立 outbound 落盘逻辑的渠道（如 Telegram）应覆写为 false，避免重复记录。
   */
  protected shouldAppendOutboundHistoryOnSend(): boolean {
    return true;
  }

  /**
   * 供工具层调用的文本发送统一入口。
   *
   * 设计点（中文）
   * - 空 chatId 视为参数错误。
   * - 空文本视为幂等 no-op（返回 success）。
   * - 平台异常收敛为 `{ success: false, error }`，避免抛出破坏工具协议。
   */
  async sendToolText(
    params: ChannelSendTextParams,
  ): Promise<{ success: boolean; error?: string }> {
    const chatId = String(params.chatId || "").trim();
    const text = String(params.text ?? "");
    if (!chatId) return { success: false, error: "Missing chatId" };
    if (!text.trim()) return { success: true };

    try {
      const normalized: ChannelSendTextParams = { ...params, chatId, text };
      await this.sendTextToPlatform(normalized);
      if (this.shouldAppendOutboundHistoryOnSend()) {
        await appendToolOutboundChannelHistory({
          context: this.context,
          logger: this.logger,
          channel: this.channel,
          chatId: normalized.chatId,
          chatType: normalized.chatType,
          messageThreadId: normalized.messageThreadId,
          text: normalized.text,
          ...(typeof normalized.message_id === "string"
            ? { message_id: normalized.message_id }
            : {}),
        });
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * 供工具层调用的动作发送入口（如 typing）。
   *
   * 设计点（中文）
   * - action 可选，缺失时按 no-op 处理。
   * - 若平台未实现 sendActionToPlatform，返回明确 not supported。
   */
  async sendToolAction(
    params: ChatDispatchSendActionParams,
  ): Promise<{ success: boolean; error?: string }> {
    const chatId = String(params.chatId || "").trim();
    if (!chatId) return { success: false, error: "Missing chatId" };

    const action = params.action;
    if (!action) return { success: true };

    const send = this.sendActionToPlatform;
    if (typeof send !== "function") {
      return { success: false, error: "sendAction not supported" };
    }

    try {
      await send.call(this, {
        chatId,
        action,
        messageThreadId: params.messageThreadId,
        chatType: params.chatType,
        message_id: params.message_id,
        reactionEmoji: params.reactionEmoji,
        reactionIsBig: params.reactionIsBig,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * 清理某个 session_id 对应的 agent 会话状态。
   *
   * 说明（中文）
   * - 只清理 runtime / context 层状态，不直接删历史文件。
   * - 常用于用户触发“重置对话”类命令。
   */
  clearChat(session_id: string): void {
    const key = String(session_id || "").trim();
    if (!key) return;
    resolveChatQueueStore(this.context).enqueue({
      kind: "control",
      channel: this.channel,
      targetId: key,
      session_id: key,
      text: "",
      control: { type: "clear" },
    });
    this.logger.info(`Cleared chat: ${key}`);
  }

  /**
   * 按渠道目标清理会话（映射到内部 session_id）。
   */
  protected async clearChatByTarget(params: ChannelChatKeyParams): Promise<void> {
    const chatId = String(params.chatId || "").trim();
    if (!chatId) return;
    const session_id = await resolveChannelSessionId({
      context: this.context,
      channel: this.channel,
      chatId,
      chatType: params.chatType,
      messageThreadId: params.messageThreadId,
    });
    if (!session_id) {
      this.logger.info("Skip clear chat: context mapping not found", {
        channel: this.channel,
        chatId,
        chatType: params.chatType,
        messageThreadId: params.messageThreadId,
      });
      return;
    }
    const deleted = await deleteChatSessionById({
      context: this.context,
      session_id,
    });
    if (!deleted.success) {
      this.logger.warn("Failed to delete chat context by target", {
        channel: this.channel,
        chatId,
        session_id,
        error: deleted.error || "delete failed",
      });
      return;
    }
    this.logger.info("Deleted chat context by target", {
      channel: this.channel,
      chatId,
      session_id,
      removedMeta: deleted.removedMeta,
      removedChatDir: deleted.removedChatDir,
      removedSessionDir: deleted.removedSessionDir,
    });
  }

  /**
   * 入站消息写入队列（审计用途，不触发执行）。
   */
  protected async enqueueAuditMessage(params: {
    chatId: string;
    message_id?: string;
    user_id?: string;
    text: string;
    meta?: ChannelUserMessageMeta;
  }): Promise<void> {
    await enqueueAuditChannelMessage({
      context: this.context,
      channel: this.channel,
      chatId: params.chatId,
      text: params.text,
      ...(typeof params.message_id === "string" ? { message_id: params.message_id } : {}),
      ...(typeof params.user_id === "string" ? { user_id: params.user_id } : {}),
      ...(params.meta ? { meta: params.meta } : {}),
    });
  }

  /**
   * 将消息送入会话调度器队列。
   *
   * 返回值语义（中文）
   * - chat_key: lane 归属键（同 key 串行）。
   * - position: 当前 lane 中排队位置（便于日志与观测）。
   */
  protected async enqueueMessage(
    msg: IncomingChatMessage,
  ): Promise<{ chat_key: string; position: number }> {
    return await enqueueExecChannelMessage({
      context: this.context,
      channel: this.channel,
      message: msg,
    });
  }
}
