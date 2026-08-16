/**
 * QQ 渠道辅助逻辑。
 *
 * 关键点（中文）
 * - 把 READY 身份解析、命令映射、入站增强组装等从 `QQ.ts` 抽离。
 * - 这些逻辑尽量保持纯函数或最小依赖，便于单测与复用。
 */

import { buildChatInboundText, augmentChatInboundInput } from "@/chat/runtime/InboundAugment.js";
import type { PluginContext } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type { QQMessageData, QQReadyUser } from "@/chat/channels/qq/types/QqChannel.js";
import type { QqIncomingAttachment } from "@/chat/types/QqVoice.js";
import { resolveQqAttachmentLocalPath } from "./VoiceInput.js";

/**
 * QQ READY 身份快照。
 */
export interface QqReadyIdentity {
  /**
   * 当前 ws context id。
   */
  wsContextId: string;
  /**
   * 机器人展示名。
   */
  botDisplayName: string;
  /**
   * 机器人用户主键。
   */
  botUserId: string;
}

/**
 * QQ 命令动作定义。
 */
export interface QqCommandAction {
  /**
   * 动作类型。
   */
  action: "reply_only" | "clear_chat";
  /**
   * 回复文本。
   */
  responseText: string;
}

/**
 * QQ 入站增强组装参数。
 */
export interface BuildQqInboundInstructionsParams {
  /**
   * 当前执行上下文。
   */
  context: PluginContext;
  /**
   * 项目根目录。
   */
  rootPath: string;
  /**
   * 当前 AgentWorkspace 的私有数据目录。
   */
  dataPath: string;
  /**
   * 平台 chatId。
   */
  chatId: string;
  /**
   * chat queue key。
   */
  chat_key: string;
  /**
   * 当前消息 id。
   */
  message_id: string;
  /**
   * 用户文本。
   */
  userMessage: string;
  /**
   * 附件列表。
   */
  attachments: QqIncomingAttachment[];
  /**
   * 获取 gateway 鉴权头的回调。
   */
  getAuthToken: () => Promise<string>;
}

/**
 * 解析 READY 事件中的机器人身份信息。
 */
export function extractQqReadyIdentity(data: JsonObject): QqReadyIdentity {
  const readyUser =
    data.user && typeof data.user === "object" && !Array.isArray(data.user)
      ? (data.user as QQReadyUser)
      : undefined;
  return {
    wsContextId: typeof data.context_id === "string" ? data.context_id : "",
    botDisplayName:
      [
        readyUser?.username,
        readyUser?.nickname,
        readyUser?.name,
        readyUser?.bot_name,
        readyUser?.user?.username,
        readyUser?.user?.nickname,
        readyUser?.user?.name,
      ]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find(Boolean) || "",
    botUserId:
      typeof readyUser?.id === "string"
        ? readyUser.id.trim()
        : typeof readyUser?.user_id === "string"
          ? readyUser.user_id.trim()
          : typeof readyUser?.user_openid === "string"
            ? readyUser.user_openid.trim()
            : typeof readyUser?.openid === "string"
              ? readyUser.openid.trim()
              : "",
  };
}

/**
 * 解析 QQ 命令动作。
 */
export function resolveQqCommandAction(command: string): QqCommandAction {
  const normalized = String(command || "").toLowerCase().trim();
  const head = normalized.split(" ")[0] || "";
  switch (head) {
    case "/help":
    case "/帮助":
      return {
        action: "reply_only",
        responseText: `🤖 Downcity Bot

可用命令:
- /help 或 /帮助 - 查看帮助信息
- /status 或 /状态 - 查看 Agent 状态
- /tasks 或 /任务 - 查看任务列表
- /clear 或 /清除 - 彻底删除当前对话
- <任意消息> - 执行指令`,
      };
    case "/status":
    case "/状态":
      return {
        action: "reply_only",
        responseText: "📊 Agent 状态: 运行中\n任务数: 0\n待审批: 0",
      };
    case "/tasks":
    case "/任务":
      return {
        action: "reply_only",
        responseText: "📋 任务列表\n暂无任务",
      };
    case "/clear":
    case "/清除":
      return {
        action: "clear_chat",
        responseText: "✅ 对话已彻底删除",
      };
    default:
      return {
        action: "reply_only",
        responseText: `未知命令: ${command}\n输入 /help 查看可用命令`,
      };
  }
}

/**
 * 解析 QQ 群消息的 chatId。
 */
export function resolveQqGroupChatId(data: QQMessageData): string {
  return [
    data.group_openid,
    data.group_id,
    data.group_code,
    data.group_uin,
    data.channel_id,
    data.guild_id,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean) || "";
}

/**
 * 解析 QQ C2C 消息的 chatId。
 */
export function resolveQqC2cChatId(params: {
  data: QQMessageData;
  actor_user_id?: string;
}): string {
  const { data, actor_user_id } = params;
  return [
    actor_user_id,
    data.user_openid,
    data.openid,
    data.author_id,
    data.author?.user_openid,
    data.author?.member_openid,
    data.author?.openid,
    data.author?.id,
    data.author?.user_id,
    data.author?.user?.user_openid,
    data.author?.user?.openid,
    data.author?.user?.id,
    data.author?.user?.user_id,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean) || "";
}

/**
 * 构造 QQ 入站执行指令（文本 + 语音转写增强）。
 */
export async function buildQqInboundInstructions(
  params: BuildQqInboundInstructionsParams,
): Promise<string> {
  const text = String(params.userMessage || "").trim();
  const authToken = await params.getAuthToken();
  const resolvedAttachments = await Promise.all(
    params.attachments.map(async (attachment) => {
      const base = {
        channel: "qq" as const,
        kind: attachment.kind,
        ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
        ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
        ...(attachment.attachmentId ? { attachmentId: attachment.attachmentId } : {}),
      };
      if (attachment.kind !== "voice" && attachment.kind !== "audio") {
        return {
          ...base,
          ...(attachment.localPath ? { path: attachment.localPath } : {}),
        };
      }
      try {
        const localPath = await resolveQqAttachmentLocalPath({
          rootPath: params.rootPath,
          dataPath: params.dataPath,
          attachment,
          authToken,
        });
        return {
          ...base,
          ...(localPath ? { path: localPath } : {}),
        };
      } catch {
        return base;
      }
    }),
  );

  return buildChatInboundText(
    await augmentChatInboundInput({
      context: params.context,
      input: {
        channel: "qq",
        chatId: params.chatId,
        chat_key: params.chat_key,
        message_id: params.message_id,
        rootPath: params.rootPath,
        body_text: text || undefined,
        attachments: resolvedAttachments,
      },
    }),
  );
}
