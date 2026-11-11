/**
 * Agent 私有 Storage 内 Session 附件的本地实现。
 *
 * Data URL 在这里解码为文件；fork 来源附件在同一 Agent Storage 内复制；
 * Message 层保存 Agent 私有目录中的绝对路径。
 */

import path from "node:path";
import { realpath } from "node:fs/promises";
import { generate_id } from "@/utils/Id.js";
import type { FileSystem } from "@downcity/type";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

const DATA_URL_PATTERN = /^data:([^;,]+)?((?:;[^;,]+)*),(.*)$/s;

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
};

export interface LocalSessionAttachmentStoreOptions {
  /** 当前 Agent 私有 Storage 的文件能力。 */
  files: FileSystem;
  /** 当前 Session 附件目录的绝对路径。 */
  attachments_dir_path: string;
}

/** Session 附件本地持久化实现。 */
export class LocalSessionAttachmentStore implements SessionAttachmentStore {
  private readonly files: FileSystem;
  private readonly attachments_dir_path: string;

  constructor(options: LocalSessionAttachmentStoreOptions) {
    this.files = options.files;
    this.attachments_dir_path = path.resolve(options.attachments_dir_path);
  }

  /** 供可信请求组装使用，不能从消息中猜测附件目录。 */
  get root_path(): string { return this.attachments_dir_path; }

  owns_local_file(url: string): boolean {
    const candidate = path.resolve(String(url || ""));
    const relative = path.relative(this.attachments_dir_path, candidate);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  /** 登记授权在 Session 层检查；此处只允许本附件目录的普通文件。 */
  async read_file(input: import("@downcity/type/workspace").ReadFileToolInput, abort_signal?: AbortSignal): Promise<import("@downcity/type/workspace").ReadFileToolResult> {
    abort_signal?.throwIfAborted();
    if (!this.owns_local_file(input.file_path)) return { success: false, error_code: "sandbox_denied", message: "File is not owned by this Session" };
    try {
      const [root, actual] = await Promise.all([realpath(this.attachments_dir_path), realpath(input.file_path)]);
      const relative = path.relative(root, actual);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return { success: false, error_code: "sandbox_denied", message: "Resolved attachment escapes its Session directory" };
      }
    } catch { return { success: false, error_code: "file_not_found", message: "Attachment is unavailable" }; }
    return await this.files.run_file_action({ action: "read", input }, undefined, abort_signal) as import("@downcity/type/workspace").ReadFileToolResult;
  }

  async persist_data_url(input: {
    data_url: string;
    media_type: string;
    filename?: string;
  }): Promise<string> {
    const parsed = parse_data_url(input.data_url, input.media_type);
    const extension = resolve_extension(parsed.media_type, input.filename);
    const attachment_name = `att_${generate_id()}${extension}`;
    const absolute_path = path.join(this.attachments_dir_path, attachment_name);
    await this.files.ensure_directory(this.attachments_dir_path);
    await this.files.write_file_atomically(absolute_path, parsed.bytes);
    return absolute_path;
  }

  async copy_local_file(input: {
    source_url: string;
    media_type: string;
    filename?: string;
  }): Promise<string> {
    const extension = resolve_extension(input.media_type, input.filename);
    const attachment_name = `att_${generate_id()}${extension}`;
    const absolute_path = path.join(this.attachments_dir_path, attachment_name);
    const bytes = await this.files.read_file(input.source_url);
    await this.files.ensure_directory(this.attachments_dir_path);
    await this.files.write_file_atomically(absolute_path, bytes);
    return absolute_path;
  }
}

function parse_data_url(data_url: string, fallback_media_type: string): {
  media_type: string;
  bytes: Buffer;
} {
  const match = DATA_URL_PATTERN.exec(String(data_url || "").trim());
  if (!match) throw new Error("Invalid data URL");

  const media_type = String(match[1] || fallback_media_type || "").trim();
  if (!media_type || !media_type.includes("/")) {
    throw new Error("Data URL requires a valid media type");
  }

  const metadata = String(match[2] || "");
  const payload = String(match[3] || "");
  try {
    const normalized_payload = payload.replace(/\s/g, "");
    if (
      metadata.includes(";base64") &&
      (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized_payload) ||
        normalized_payload.length % 4 === 1)
    ) {
      throw new Error("invalid base64 payload");
    }
    return {
      media_type,
      bytes: metadata.includes(";base64")
        ? Buffer.from(normalized_payload, "base64")
        : Buffer.from(decodeURIComponent(payload), "utf8"),
    };
  } catch (error) {
    throw new Error(`Invalid data URL payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolve_extension(media_type: string, filename?: string): string {
  const known = MEDIA_TYPE_EXTENSIONS[media_type.toLowerCase()];
  if (known) return known;
  const filename_extension = path.extname(String(filename || "")).toLowerCase();
  return /^[.][a-z0-9]{1,10}$/.test(filename_extension) ? filename_extension : ".bin";
}
