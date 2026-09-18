/**
 * Image capability 的公开输入解析与图片服务输入转换。
 *
 * 关键点（中文）
 * - 模型只提交公开的 prompt/content 协议，本模块负责转换为 City 图片服务输入。
 * - 本地图片以当前 Workspace 为根读取，并在进入图片服务前转换成 data URL。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PowerJsonValue } from "@/power/index.js";
import type {
  ImageContent,
  ImageCreateInput,
  ImageResolvedContent,
  ImageResolvedCreateInput,
} from "@/city/power/builtin/groups/image/types/Image.js";

const HTTP_URL_RE = /^https?:\/\//i;
const DEFAULT_IMAGE_MEDIA_TYPE = "image/png";

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** 判断值是否为普通对象。 */
function to_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 归一化模型传入的图片生成 payload。 */
export function normalize_image_payload(
  payload: PowerJsonValue | undefined,
): ImageCreateInput {
  const record = to_record(payload ?? {});
  if (!record) {
    throw new TypeError("image_create input must be an object");
  }
  return { ...record } as ImageCreateInput;
}

/** 根据文件扩展名推断图片 MIME 类型。 */
function infer_image_media_type(file_path: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim();
  const extension = path.extname(file_path).toLowerCase();
  return IMAGE_MEDIA_TYPES[extension] ?? DEFAULT_IMAGE_MEDIA_TYPE;
}

/** 解析图片本地路径。 */
function resolve_image_file_path(root_path: string, image_url: string): string {
  const raw_url = image_url.trim();
  if (!raw_url) throw new TypeError("image content url is required");
  return path.isAbsolute(raw_url) ? raw_url : path.resolve(root_path, raw_url);
}

/** 把本地图片读取为 data URL。 */
async function local_image_to_data_url(input: {
  /** 当前 Workspace 的绝对根目录。 */
  root_path: string;
  /** 本地图片的绝对路径或相对 Workspace 的路径。 */
  image_url: string;
  /** 调用方显式提供的可选 MIME 类型。 */
  media_type?: string;
}): Promise<{ data_url: string; media_type: string }> {
  const file_path = resolve_image_file_path(input.root_path, input.image_url);
  const media_type = infer_image_media_type(file_path, input.media_type);
  const bytes = await fs.readFile(file_path);
  return {
    data_url: `${media_type.includes("/") ? `data:${media_type};base64,` : "data:image/png;base64,"}${bytes.toString("base64")}`,
    media_type,
  };
}

/** 归一化单个图片内容片段。 */
async function normalize_image_content_part(
  workspace_path: string,
  part: ImageContent,
): Promise<ImageResolvedContent> {
  if (part.type === "text") return part;
  const url = String(part.url || "").trim();
  if (!url) throw new TypeError("image content url is required");
  if (url.startsWith("data:")) {
    throw new TypeError(
      "image content url does not accept data URLs; pass an online URL or a local file path",
    );
  }
  if (HTTP_URL_RE.test(url)) {
    return {
      type: "image",
      url,
      ...(part.media_type ? { media_type: part.media_type } : {}),
    };
  }
  const local_image = await local_image_to_data_url({
    root_path: workspace_path,
    image_url: url,
    media_type: part.media_type,
  });
  return {
    type: "image",
    data_url: local_image.data_url,
    media_type: local_image.media_type,
  };
}

/** 拒绝旧版或内部协议字段，避免模型依赖服务侧输入。 */
function assert_public_create_input(input: ImageCreateInput): void {
  const record = input as Record<string, unknown>;
  if ("messages" in record) {
    throw new TypeError("image_create uses prompt or content; messages is not supported");
  }
  const content = record.content;
  if (!Array.isArray(content)) return;
  for (const part of content) {
    const part_record = to_record(part);
    if (part_record && "data_url" in part_record) {
      throw new TypeError("image content image uses url only; data_url is not supported");
    }
  }
}

/** 复制公开输入中的通用字段，并剥离公开 content 与旧版 messages。 */
function copy_resolved_input(input: ImageCreateInput): ImageResolvedCreateInput {
  const { content: _content, messages: _messages, ...rest } = input as ImageCreateInput & {
    /** 旧版字段，仅用于在协议边界显式丢弃。 */
    messages?: unknown;
  };
  return rest as ImageResolvedCreateInput;
}

/**
 * 把模型友好的公开输入转成图片服务使用的输入。
 *
 * 关键点（中文）
 * - `content` 存在时 `prompt` 不再生效，两者语义互斥。
 * - 本地图片在这一步读取为 data URL，服务侧不需要访问 Workspace。
 */
export async function normalize_image_create_input(input: {
  /** 当前 Workspace 的绝对根目录。 */
  workspace_path: string;
  /** 模型提交的公开输入。 */
  payload: ImageCreateInput;
}): Promise<ImageResolvedCreateInput> {
  assert_public_create_input(input.payload);
  if (!Array.isArray(input.payload.content)) return copy_resolved_input(input.payload);
  const content = await Promise.all(
    input.payload.content.map((part) =>
      normalize_image_content_part(input.workspace_path, part)),
  );
  const { prompt: _prompt, ...rest } = copy_resolved_input(input.payload);
  return {
    ...rest,
    messages: [{ role: "user", content }],
  };
}
