/**
 * Workspace 内 Session 附件的本地实现。
 *
 * Data URL 在这里解码为文件；Message 层只接收相对 Workspace 根目录的文件引用。
 */

import path from "node:path";
import { generate_id } from "@/utils/Id.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
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
  /** Workspace 文件能力。 */
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
    return path.relative(this.files.root_path, absolute_path);
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
