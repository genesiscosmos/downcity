/**
 * ImagePlugin 的公开输入解析与 City 图片任务输入转换。
 *
 * 关键点（中文）
 * - Agent 只提交公开的 prompt/content 协议，本模块负责转换为 City 图片服务输入。
 * - 本地图片以当前 Workspace 为根读取，并在进入 City 服务前转换成 data URL。
 * - 默认模型解析只补齐缺失值，不覆盖调用方显式指定的模型。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PluginContext, PluginJsonValue } from "@downcity/city/plugin";
import type {
  ImagePluginContent,
  ImagePluginDefaultModel,
  ImagePluginInput,
  ImagePluginResolvedContent,
  ImagePluginResolvedInput,
} from "@/image/types/ImagePlugin.js";

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
  payload: PluginJsonValue | undefined,
): ImagePluginInput {
  const record = to_record(payload ?? {});
  if (!record) {
    throw new TypeError("ImagePlugin image payload must be an object");
  }
  return { ...record } as ImagePluginInput;
}

/** 归一化默认图片模型配置值。 */
export function normalize_default_image_model_value(
  value: string | null | undefined,
): string | undefined {
  const model = String(value ?? "").trim();
  return model ? model : undefined;
}

/** 归一化默认图片模型配置入口。 */
export function normalize_default_image_model(
  value: ImagePluginDefaultModel | undefined,
): ImagePluginDefaultModel | undefined {
  if (typeof value === "function") return value;
  return normalize_default_image_model_value(value);
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
  if (!raw_url) throw new TypeError("ImagePlugin image content url is required");
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
  context: PluginContext,
  part: ImagePluginContent,
): Promise<ImagePluginResolvedContent> {
  if (part.type === "text") return part;
  const url = String(part.url || "").trim();
  if (!url) throw new TypeError("ImagePlugin image content url is required");
  if (url.startsWith("data:")) {
    throw new TypeError(
      "ImagePlugin content image url does not accept data URLs; pass an online URL or a local file path",
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
    root_path: context.workspace.path,
    image_url: url,
    media_type: part.media_type,
  });
  return {
    type: "image",
    data_url: local_image.data_url,
    media_type: local_image.media_type,
  };
}

/** 拒绝旧版或内部协议字段，避免 Agent 依赖 City 服务输入。 */
function assert_public_image_create_input(input: ImagePluginInput): void {
  const record = input as Record<string, unknown>;
  if ("messages" in record) {
    throw new TypeError("ImagePlugin image_create uses prompt or content; messages is not supported");
  }
  const content = record.content;
  if (!Array.isArray(content)) return;
  for (const part of content) {
    const part_record = to_record(part);
    if (part_record && "data_url" in part_record) {
      throw new TypeError(
        "ImagePlugin content image uses url only; data_url is not supported",
      );
    }
  }
}

/** 复制公开输入中的通用字段，并剥离公开 content 与旧版 messages。 */
function copy_resolved_image_input(input: ImagePluginInput): ImagePluginResolvedInput {
  const { content: _content, messages: _messages, ...rest } = input as ImagePluginInput & {
    /** 旧版字段，仅用于在协议边界显式丢弃。 */
    messages?: unknown;
  };
  return rest as ImagePluginResolvedInput;
}

/** 把 Agent 友好的公开输入转成 City 图片任务使用的输入。 */
export async function normalize_image_create_input(
  context: PluginContext,
  input: ImagePluginInput,
): Promise<ImagePluginResolvedInput> {
  assert_public_image_create_input(input);
  if (!Array.isArray(input.content)) return copy_resolved_image_input(input);
  const content = await Promise.all(
    input.content.map((part) => normalize_image_content_part(context, part)),
  );
  const { prompt: _prompt, ...rest } = copy_resolved_image_input(input);
  return {
    ...rest,
    messages: [{ role: "user", content }],
  };
}

/** 为图片创建输入补齐插件级默认模型。 */
export async function apply_default_image_model(
  context: PluginContext,
  input: ImagePluginResolvedInput,
  default_model: ImagePluginDefaultModel | undefined,
): Promise<ImagePluginResolvedInput> {
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (model) return { ...input, model };
  if (!default_model) return input;
  const resolved_model = typeof default_model === "function"
    ? normalize_default_image_model_value(await default_model({ context, input }))
    : normalize_default_image_model_value(default_model);
  return resolved_model ? { ...input, model: resolved_model } : input;
}
