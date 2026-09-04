/**
 * Feishu 平台发送与附件上传辅助函数。
 *
 * 关键点（中文）
 * - 发送消息、上传图片/文件、解析本地附件路径属于“写入型平台能力”。
 * - `FeishuPlatformClient` 只保留统一入口和状态，不再直接承载全部细节。
 */

import fs from "fs-extra";
import path from "path";
import type {
  FeishuMessagePayloadType,
} from "@/chat/channels/feishu/types/FeishuChannel.js";
import type { ParsedFeishuAttachmentCommand } from "@/chat/types/FeishuAttachment.js";
import type { FeishuSdkClient } from "./types/FeishuSdk.js";

/**
 * Feishu 发送类依赖。
 */
export interface FeishuMessagingDeps {
  /**
   * 项目根目录。
   */
  rootPath: string;
  /**
   * 日志器。
   */
  logger: {
    /**
     * 记录 error 日志。
     */
    error(message: string, data?: Record<string, unknown>): void;
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
}

async function resolveAttachmentLocalPath(
  deps: FeishuMessagingDeps,
  pathOrUrl: string,
): Promise<string> {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) {
    throw new Error("Attachment path is empty");
  }
  if (/^https?:\/\//i.test(raw)) {
    throw new Error("Feishu attachment currently only supports local file path");
  }

  const absPath = path.isAbsolute(raw) ? raw : path.resolve(deps.rootPath, raw);
  const exists = await fs.pathExists(absPath);
  if (!exists) {
    throw new Error(`Attachment file not found: ${raw}`);
  }
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) {
    throw new Error(`Attachment path is not a file: ${raw}`);
  }
  return absPath;
}

async function uploadFileToFeishu(
  deps: FeishuMessagingDeps,
  localPath: string,
): Promise<string> {
  const token = await deps.getAppAccessToken();
  if (!token) {
    throw new Error("Failed to get Feishu tenant_access_token");
  }

  const domain = deps.getNormalizedDomain();
  const fileName = path.basename(localPath) || "attachment.bin";
  const fileBuffer = await fs.readFile(localPath);
  const form = new FormData();
  form.set("file_type", "stream");
  form.set("file_name", fileName);
  form.set("file", new Blob([fileBuffer]), fileName);

  const response = await fetch(`${domain}/open-apis/im/v1/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        code?: number;
        msg?: string;
        data?: {
          file_key?: string;
        };
      }
    | null;
  const fileKey = String(payload?.data?.file_key || "").trim();
  if (!response.ok || payload?.code !== 0 || !fileKey) {
    throw new Error(
      `Feishu file upload failed: HTTP ${response.status}, code=${String(payload?.code ?? "")}, msg=${String(payload?.msg ?? "")}`,
    );
  }

  return fileKey;
}

async function uploadImageToFeishu(
  deps: FeishuMessagingDeps,
  localPath: string,
): Promise<string> {
  if (!deps.client) {
    throw new Error("Feishu client is not initialized");
  }

  const fileBuffer = await fs.readFile(localPath);
  const payload = await deps.client.im.v1.image.create({
    data: {
      image_type: "message",
      image: fileBuffer,
    },
  });
  const imageKey = String(payload?.image_key || "").trim();
  if (!imageKey) {
    throw new Error(`Feishu image upload failed: ${localPath}`);
  }
  return imageKey;
}

/**
 * 发送平台消息。
 */
export async function sendFeishuPlatformMessage(
  deps: FeishuMessagingDeps,
  chatId: string,
  chatType: string,
  message_id: string | undefined,
  msgType: FeishuMessagePayloadType,
  content: Record<string, unknown> | string,
): Promise<void> {
  if (!deps.client) {
    throw new Error("Feishu client is not initialized");
  }
  const serializedContent =
    typeof content === "string" ? content : JSON.stringify(content);
  try {
    if (chatType !== "p2p" && message_id) {
      await deps.client.im.v1.message.reply({
        path: {
          message_id: message_id,
        },
        data: {
          content: serializedContent,
          msg_type: msgType,
        },
      });
      return;
    }

    await deps.client.im.v1.message.create({
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        content: serializedContent,
        msg_type: msgType,
      },
    });
  } catch (error) {
    deps.logger.error("Failed to send Feishu message", {
      error: String(error),
      msgType,
      chatType,
    });
    throw error instanceof Error
      ? error
      : new Error(`Failed to send Feishu message: ${String(error)}`);
  }
}

/**
 * 发送附件，并在需要时补发 caption 文本。
 */
export async function sendFeishuAttachment(
  deps: FeishuMessagingDeps,
  chatId: string,
  chatType: string,
  message_id: string | undefined,
  attachment: ParsedFeishuAttachmentCommand,
): Promise<void> {
  const localPath = await resolveAttachmentLocalPath(deps, attachment.pathOrUrl);
  if (attachment.type === "photo") {
    const imageKey = await uploadImageToFeishu(deps, localPath);
    await sendFeishuPlatformMessage(deps, chatId, chatType, message_id, "image", {
      image_key: imageKey,
    });
  } else {
    const fileKey = await uploadFileToFeishu(deps, localPath);
    await sendFeishuPlatformMessage(deps, chatId, chatType, message_id, "file", {
      file_key: fileKey,
    });
  }

  const caption = String(attachment.caption || "").trim();
  if (caption) {
    await sendFeishuPlatformMessage(deps, chatId, chatType, message_id, "text", {
      text: caption,
    });
  }
}
