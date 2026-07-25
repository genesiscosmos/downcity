import path from "path";
import { parse_chat_message_markup } from "@downcity/agent";

/**
 * Telegram 集成配置。
 */
export interface TelegramConfig {
  botToken?: string;
  enabled: boolean;
}

/**
 * Telegram Update 结构（仅保留当前项目需要字段）。
 */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    message_thread_id?: number;
    date?: number;
    text?: string;
    caption?: string;
    quote?: {
      text?: string;
    };
    chat: {
      id: number;
      type?: "private" | "group" | "supergroup" | "channel";
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    photo?: Array<{
      file_id: string;
      width?: number;
      height?: number;
      file_size?: number;
    }>;
    voice?: {
      file_id: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
    };
    audio?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
    };
    video?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
      width?: number;
      height?: number;
    };
    reply_to_message?: {
      message_id?: number;
      text?: string;
      caption?: string;
      document?: {
        file_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
      };
      photo?: Array<{
        file_id: string;
        width?: number;
        height?: number;
        file_size?: number;
      }>;
      voice?: {
        file_id: string;
        mime_type?: string;
        file_size?: number;
        duration?: number;
      };
      audio?: {
        file_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
        duration?: number;
      };
      video?: {
        file_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
        duration?: number;
        width?: number;
        height?: number;
      };
      from?: {
        id: number;
        username?: string;
        first_name?: string;
        last_name?: string;
      };
    };
    from?: {
      id: number;
      is_bot?: boolean;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
      user?: { id: number; username?: string };
    }>;
    caption_entities?: Array<{
      type: string;
      offset: number;
      length: number;
      user?: { id: number; username?: string };
    }>;
  };
  callback_query?: {
    id: string;
    data: string;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    message: {
      message_thread_id?: number;
      chat: {
        id: number;
      };
    };
  };
}

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

/**
 * Telegram Bot API 通用响应。
 */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export type TelegramAttachmentType =
  | "photo"
  | "document"
  | "voice"
  | "audio"
  | "video";

/**
 * 清洗用户可见文本，避免直接回显冗长工具日志。
 */
export function sanitizeChatText(text: string): string {
  if (!text) return text;

  let out = text;

  // Remove/compact tool-log style dumps if present
  out = out.replace(
    /(^|\n)Tool Result:[\s\S]*?(?=\n{2,}|$)/g,
    "\n[工具输出已省略：我已在后台读取并提炼关键信息]\n",
  );

  return out;
}

export function guessMimeType(fileName: string): string | undefined {
  const ext = (path.extname(fileName) || "").toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".m4v":
      return "video/x-m4v";
    default:
      return undefined;
  }
}

/**
 * 从文本中解析 `<file ...>` 附件标签。
 *
 * 说明（中文）
 * - 返回“清理后的正文 + 附件列表 + 有序 segments”
 * - `<file>` 标签会从正文中移除，便于自然语言与附件混写
 * - `segments` 会保留正文与附件的真实顺序，供出站逐段发送
 */
export function parseTelegramAttachments(text: string): {
  text: string;
  attachments: Array<{
    type: TelegramAttachmentType;
    pathOrUrl: string;
    caption?: string;
  }>;
  segments: Array<
    | {
        kind: "text";
        text: string;
      }
    | {
        kind: "attachment";
        attachment: {
          type: TelegramAttachmentType;
          pathOrUrl: string;
          caption?: string;
        };
      }
  >;
} {
  const parsed = parse_chat_message_markup(text);
  const attachments: Array<{
    type: TelegramAttachmentType;
    pathOrUrl: string;
    caption?: string;
  }> = parsed.files.map((file) => {
    const kindRaw = String(file.type || "").toLowerCase();
    const type: TelegramAttachmentType =
      kindRaw === "image" || kindRaw === "photo"
        ? "photo"
        : kindRaw === "file" || kindRaw === "document"
          ? "document"
          : kindRaw === "video"
            ? "video"
          : kindRaw === "audio"
            ? "audio"
            : "voice";

    const pathOrUrl = String(file.path || "").trim();
    const caption =
      typeof file.caption === "string" ? String(file.caption).trim() : undefined;
    return {
      type,
      pathOrUrl,
      ...(caption ? { caption } : {}),
    };
  }).filter((item) => item.pathOrUrl);

  const segments: Array<
    | {
        kind: "text";
        text: string;
      }
    | {
        kind: "attachment";
        attachment: {
          type: TelegramAttachmentType;
          pathOrUrl: string;
          caption?: string;
        };
      }
  > = [];
  for (const segment of parsed.segments) {
    if (segment.kind === "text") {
      if (segment.text) {
        segments.push({
          kind: "text",
          text: segment.text,
        });
      }
      continue;
    }
    const kindRaw = String(segment.file.type || "").toLowerCase();
    const type: TelegramAttachmentType =
      kindRaw === "image" || kindRaw === "photo"
        ? "photo"
        : kindRaw === "file" || kindRaw === "document"
          ? "document"
          : kindRaw === "video"
            ? "video"
            : kindRaw === "audio"
              ? "audio"
              : "voice";
    const pathOrUrl = String(segment.file.path || "").trim();
    if (!pathOrUrl) continue;
    const caption =
      typeof segment.file.caption === "string"
        ? String(segment.file.caption).trim()
        : undefined;
    segments.push({
      kind: "attachment",
      attachment: {
        type,
        pathOrUrl,
        ...(caption ? { caption } : {}),
      },
    });
  }

  return { text: parsed.body_text, attachments, segments };
}

function formatActorName(name: string): string {
  return name
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim();
}

export function getActorName(from?: {
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const first = typeof from?.first_name === "string" ? from.first_name.trim() : "";
  const last = typeof from?.last_name === "string" ? from.last_name.trim() : "";
  const raw = [first, last].filter(Boolean).join(" ").trim();
  if (!raw) return undefined;
  return formatActorName(raw);
}

/**
 * 提取 Telegram 会话展示名（群名/频道名/私聊对象名）。
 *
 * 关键点（中文）
 * - 群聊/频道优先取 `chat.title`。
 * - 私聊优先 username，再回退 first/last name。
 */
export function getTelegramChatTitle(chat?: {
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const title = typeof chat?.title === "string" ? chat.title.trim() : "";
  if (title) return title;

  const username = typeof chat?.username === "string" ? chat.username.trim() : "";
  if (username) return `@${username.replace(/^@+/, "")}`;

  const first = typeof chat?.first_name === "string" ? chat.first_name.trim() : "";
  const last = typeof chat?.last_name === "string" ? chat.last_name.trim() : "";
  const full = formatActorName([first, last].filter(Boolean).join(" ").trim());
  return full || undefined;
}

/**
 * 拆分超长消息，避免触发 Telegram 4096 限制。
 */
export function splitTelegramMessage(text: string): string[] {
  const MAX = 3900; // keep headroom under Telegram's 4096 limit
  if (text.length <= MAX) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX) {
    let cut = remaining.lastIndexOf("\n", MAX);
    if (cut < MAX * 0.6) cut = MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
