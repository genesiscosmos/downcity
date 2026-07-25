/**
 * Feishu 平台查询与入站附件辅助函数。
 *
 * 关键点（中文）
 * - 发送者姓名、群标题、reply 上下文、附件下载都属于“读取型平台能力”。
 * - `FeishuPlatformClient` 只保留运行时状态与 token 管理，这里负责具体 OpenAPI 查询细节。
 */

import fs from "fs-extra";
import path from "path";
import type { JsonObject } from "@downcity/agent";
import type {
  FeishuDownloadedAttachment,
} from "@/chat/channels/feishu/types/FeishuChannel.js";
import type { FeishuIncomingAttachmentDescriptor } from "@/chat/types/FeishuInboundAttachment.js";
import type { InboundReplyContext } from "@/chat/types/ReplyContext.js";
import { buildFeishuInboundCacheFileName } from "./InboundAttachment.js";
import { buildFeishuReplyContext } from "./ReplyContext.js";
import type { FeishuSdkClient } from "./types/FeishuSdk.js";

/**
 * Feishu 查询类依赖。
 */
export interface FeishuLookupDeps {
  /**
   * 项目根目录。
   */
  rootPath: string;
  /**
   * 日志器。
   */
  logger: {
    /**
     * 记录 warn 日志。
     */
    warn(message: string, data?: JsonObject): void;
    /**
     * 记录 debug 日志。
     */
    debug(message: string, data?: JsonObject): void;
  };
  /**
   * Feishu SDK client。
   */
  client: FeishuSdkClient | null;
  /**
   * 获取 tenant_access_token 的回调。
   */
  getAppAccessToken: () => Promise<string | undefined>;
  /**
   * 归一化 domain 的回调。
   */
  getNormalizedDomain: () => string;
  /**
   * 发送者姓名缓存。
   */
  senderNameBySenderKey: Map<string, string>;
  /**
   * 群标题缓存。
   */
  chatTitleByChatId: Map<string, string>;
  /**
   * once warning 去重集合。
   */
  lookupWarnings: Set<string>;
}

function warnLookupOnce(
  deps: FeishuLookupDeps,
  warningKey: string,
  message: string,
  details: JsonObject,
): void {
  const normalizedKey = String(warningKey || "").trim();
  if (normalizedKey) {
    if (deps.lookupWarnings.has(normalizedKey)) return;
    deps.lookupWarnings.add(normalizedKey);
  }
  deps.logger.warn(message, details);
}

async function resolveSenderNameFromChatMembers(
  deps: FeishuLookupDeps,
  params: {
    /**
     * chatId。
     */
    chatId?: string;
    /**
     * 发送者 ID。
     */
    senderId: string;
    /**
     * 发送者 ID 类型。
     */
    idType: "open_id" | "user_id" | "union_id";
  },
): Promise<string | undefined> {
  const chatId = String(params.chatId || "").trim();
  if (!chatId) return undefined;

  const token = await deps.getAppAccessToken();
  if (!token) return undefined;

  const domain = deps.getNormalizedDomain();
  try {
    const response = await fetch(
      `${domain}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?member_id_type=${encodeURIComponent(params.idType)}&page_size=100`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          code?: number;
          msg?: string;
          data?: {
            items?: Array<{
              member_id_type?: string;
              member_id?: string;
              name?: string;
              tenant_key?: string;
            }>;
          };
        }
      | null;
    if (!response.ok) {
      warnLookupOnce(
        deps,
        `feishu-member-http:${chatId}:${params.idType}:${response.status}:${String(payload?.code ?? "")}`,
        "Feishu 群成员查询失败",
        {
          chatId,
          senderId: params.senderId,
          idType: params.idType,
          httpStatus: response.status,
          code: payload?.code ?? null,
          msg: payload?.msg ?? null,
        },
      );
      return undefined;
    }
    if (payload?.code !== 0) {
      warnLookupOnce(
        deps,
        `feishu-member-code:${chatId}:${params.idType}:${String(payload?.code ?? "")}`,
        "Feishu 群成员查询返回错误",
        {
          chatId,
          senderId: params.senderId,
          idType: params.idType,
          httpStatus: response.status,
          code: payload?.code ?? null,
          msg: payload?.msg ?? null,
        },
      );
      return undefined;
    }

    const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
    const matched = items.find(
      (item) => String(item?.member_id || "").trim() === params.senderId,
    );
    const name = String(matched?.name || "").trim();
    return name || undefined;
  } catch (error) {
    warnLookupOnce(
      deps,
      `feishu-member-exception:${chatId}:${params.idType}:${error instanceof Error ? error.name : "unknown"}`,
      "Feishu 群成员查询异常",
      {
        chatId,
        senderId: params.senderId,
        idType: params.idType,
        error: String(error),
      },
    );
    return undefined;
  }
}

/**
 * 解析发送者姓名。
 */
export async function resolveFeishuSenderName(
  deps: FeishuLookupDeps,
  params: {
    /**
     * 发送者 ID。
     */
    senderId?: string;
    /**
     * ID 类型。
     */
    idType?: "open_id" | "user_id" | "union_id";
    /**
     * 可选 chatId，用于成员列表兜底查询。
     */
    chatId?: string;
  },
): Promise<string | undefined> {
  const senderId = String(params.senderId || "").trim();
  const idType = params.idType;
  if (!senderId || !idType) return undefined;

  const cacheKey = `${idType}:${senderId}`;
  const cached = deps.senderNameBySenderKey.get(cacheKey);
  if (cached) return cached;

  const token = await deps.getAppAccessToken();
  if (!token) return undefined;

  const domain = deps.getNormalizedDomain();
  try {
    const response = await fetch(
      `${domain}/open-apis/contact/v3/users/${encodeURIComponent(senderId)}?user_id_type=${encodeURIComponent(idType)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          code?: number;
          msg?: string;
          data?: {
            user?: {
              name?: string;
              nickname?: string;
              en_name?: string;
              [key: string]: unknown;
            };
          };
        }
      | null;
    if (!response.ok) {
      warnLookupOnce(
        deps,
        `feishu-user-http:${idType}:${senderId}:${response.status}:${String(payload?.code ?? "")}`,
        "Feishu 用户信息查询失败",
        {
          senderId,
          idType,
          httpStatus: response.status,
          code: payload?.code ?? null,
          msg: payload?.msg ?? null,
        },
      );
    } else if (payload?.code !== 0) {
      warnLookupOnce(
        deps,
        `feishu-user-code:${idType}:${senderId}:${String(payload?.code ?? "")}`,
        "Feishu 用户信息查询返回错误",
        {
          senderId,
          idType,
          httpStatus: response.status,
          code: payload?.code ?? null,
          msg: payload?.msg ?? null,
        },
      );
    } else {
      const user = payload?.data?.user;
      const name = [user?.nickname, user?.name, user?.en_name]
        .map((value) => String(value || "").trim())
        .find(Boolean);
      if (name) {
        deps.senderNameBySenderKey.set(cacheKey, name);
        return name;
      }

      warnLookupOnce(
        deps,
        `feishu-user-empty:${idType}:${senderId}`,
        "Feishu 用户信息未返回姓名字段",
        {
          senderId,
          idType,
          returnedFields: user ? Object.keys(user) : [],
        },
      );
    }
  } catch (error) {
    warnLookupOnce(
      deps,
      `feishu-user-exception:${idType}:${senderId}:${error instanceof Error ? error.name : "unknown"}`,
      "Feishu 用户信息查询异常",
      {
        senderId,
        idType,
        error: String(error),
      },
    );
  }

  const memberName = await resolveSenderNameFromChatMembers(deps, {
    chatId: params.chatId,
    senderId,
    idType,
  });
  if (memberName) {
    deps.senderNameBySenderKey.set(cacheKey, memberName);
    return memberName;
  }
  return undefined;
}

/**
 * 解析群聊/会话标题。
 */
export async function resolveFeishuChatTitle(
  deps: FeishuLookupDeps,
  chatId: string,
): Promise<string | undefined> {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) return undefined;

  const cached = deps.chatTitleByChatId.get(normalizedChatId);
  if (cached) return cached;

  const token = await deps.getAppAccessToken();
  if (!token) return undefined;

  const domain = deps.getNormalizedDomain();
  try {
    const response = await fetch(
      `${domain}/open-apis/im/v1/chats/${encodeURIComponent(normalizedChatId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      deps.logger.debug("Feishu 群信息查询失败", {
        chatId: normalizedChatId,
        httpStatus: response.status,
      });
      return undefined;
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          code?: number;
          msg?: string;
          data?: {
            name?: string;
            chat_name?: string;
            chat?: {
              name?: string;
              chat_name?: string;
            };
          };
        }
      | null;
    if (typeof payload?.code === "number" && payload.code !== 0) {
      deps.logger.debug("Feishu 群信息查询返回错误", {
        chatId: normalizedChatId,
        code: payload.code,
        msg: payload.msg ?? null,
      });
      return undefined;
    }
    const title = [
      payload?.data?.name,
      payload?.data?.chat_name,
      payload?.data?.chat?.name,
      payload?.data?.chat?.chat_name,
    ]
      .map((value) => String(value || "").trim())
      .find(Boolean);
    if (!title) return undefined;
    deps.chatTitleByChatId.set(normalizedChatId, title);
    return title;
  } catch {
    return undefined;
  }
}

/**
 * 查询 reply 的父消息上下文。
 */
export async function resolveFeishuReplyContext(
  deps: FeishuLookupDeps,
  params: {
    /**
     * 父消息 ID。
     */
    parentMessageId?: string;
  },
): Promise<InboundReplyContext | undefined> {
  const parentMessageId = String(params.parentMessageId || "").trim();
  if (!parentMessageId) return undefined;

  const token = await deps.getAppAccessToken();
  if (!token) return undefined;

  const domain = deps.getNormalizedDomain();
  try {
    const response = await fetch(
      `${domain}/open-apis/im/v1/messages/${encodeURIComponent(parentMessageId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          code?: number;
          msg?: string;
          data?: {
            items?: Array<{
              message_id?: string;
              msg_type?: string;
              sender?: {
                id?: string;
                sender_type?: string;
              };
              body?: {
                content?: string;
              };
            }>;
          };
        }
      | null;
    if (!response.ok || payload?.code !== 0) {
      deps.logger.debug("Feishu reply 父消息查询失败", {
        parentMessageId,
        httpStatus: response.status,
        code: payload?.code ?? null,
        msg: payload?.msg ?? null,
      });
      return undefined;
    }

    const item = Array.isArray(payload?.data?.items) ? payload.data.items[0] : undefined;
    if (!item) return undefined;
    return buildFeishuReplyContext({
      message_id:
        typeof item.message_id === "string" ? item.message_id : parentMessageId,
      messageType: item.msg_type,
      ...(typeof item.body?.content === "string"
        ? { content: item.body.content }
        : {}),
    });
  } catch (error) {
    deps.logger.debug("Feishu reply 父消息查询异常", {
      parentMessageId,
      error: String(error),
    });
    return undefined;
  }
}

/**
 * 下载入站附件。
 */
export async function downloadFeishuIncomingAttachments(
  deps: FeishuLookupDeps,
  params: {
    /**
     * 当前消息 ID。
     */
    message_id: string;
    /**
     * 待下载附件列表。
     */
    attachments: FeishuIncomingAttachmentDescriptor[];
  },
): Promise<FeishuDownloadedAttachment[]> {
  if (!deps.client || params.attachments.length === 0) return [];

  const dir = path.join(deps.rootPath, ".downcity", ".cache", "feishu");
  await fs.ensureDir(dir);

  const out: FeishuDownloadedAttachment[] = [];
  for (const attachment of params.attachments) {
    try {
      const resource = await deps.client.im.v1.messageResource.get({
        path: {
          message_id: params.message_id,
          file_key: attachment.resourceKey,
        },
        params: {
          type: attachment.resource_type,
        },
      });

      const fileName = buildFeishuInboundCacheFileName({
        attachment,
        message_id: params.message_id,
        headers: resource.headers,
      });
      const outPath = path.join(dir, fileName);
      await resource.writeFile(outPath);
      out.push({
        type: attachment.type,
        path: outPath,
        ...(attachment.description ? { desc: attachment.description } : {}),
      });
    } catch (error) {
      deps.logger.warn("Failed to download incoming Feishu attachment", {
        message_id: params.message_id,
        resourceKey: attachment.resourceKey,
        resource_type: attachment.resource_type,
        error: String(error),
      });
    }
  }

  return out;
}
