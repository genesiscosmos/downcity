/**
 * Control execute 输入拼装 helper。
 *
 * 关键点（中文）
 * - 负责把 API 传入的附件规范化并落盘。
 * - 最终统一转成 `<file>` 标签注入到 user message。
 */

import fs from "fs-extra";
import path from "node:path";
import { getCacheDirPath } from "@/city/config/Paths.js";
import { render_chat_message_file_tag } from "@downcity/agent";
import type {
  ControlSessionExecuteAttachmentInput,
  ControlSessionExecuteAttachmentType,
} from "@/city/agent/control/types/ControlSessionExecute.js";

const EXECUTE_ATTACHMENT_MAX_COUNT = 8;
const EXECUTE_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const EXECUTE_ATTACHMENT_CONTENT_MAX_CHARS = 1_500_000;
const EXECUTE_ATTACHMENT_FALLBACK_TEXT = "请查看以上附件并按用户要求处理。";

function normalizeExecuteAttachmentType(
  value: unknown,
): ControlSessionExecuteAttachmentType {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (
    raw === "photo" ||
    raw === "voice" ||
    raw === "audio" ||
    raw === "video"
  ) {
    return raw;
  }
  return "document";
}

function normalizeAttachmentCaption(value: unknown): string | undefined {
  const text = String(value || "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "/")
    .trim();
  if (!text) return undefined;
  return text.slice(0, 180);
}

function toProjectRelativePath(project_root: string, absPath: string): string | null {
  const relative = path.relative(project_root, absPath);
  if (!relative) return null;
  if (relative.startsWith("..")) return null;
  if (path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function normalizeAttachmentFileName(params: {
  fileName?: string;
  fallbackExt: string;
}): string {
  const raw = String(params.fileName || "").trim();
  const base = (raw || "attachment")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  const safeBase = base || "attachment";
  const fallbackExt = params.fallbackExt.startsWith(".")
    ? params.fallbackExt
    : `.${params.fallbackExt}`;
  const hasExt = /\.[A-Za-z0-9]+$/.test(safeBase);
  return hasExt ? safeBase : `${safeBase}${fallbackExt}`;
}

function inferAttachmentExt(params: {
  type: ControlSessionExecuteAttachmentType;
  fileName?: string;
  contentType?: string;
}): string {
  const fromFileName = path.extname(String(params.fileName || "").trim())
    .toLowerCase()
    .trim();
  if (fromFileName) return fromFileName;
  const contentType = String(params.contentType || "").toLowerCase();
  if (contentType.includes("markdown")) return ".md";
  if (contentType.includes("json")) return ".json";
  if (contentType.includes("html")) return ".html";
  if (contentType.includes("plain")) return ".txt";
  if (params.type === "photo") return ".jpg";
  if (params.type === "voice" || params.type === "audio") return ".mp3";
  if (params.type === "video") return ".mp4";
  return ".md";
}

async function resolveAttachmentPathFromInput(params: {
  project_root: string;
  attachment: ControlSessionExecuteAttachmentInput;
}): Promise<string | null> {
  const rawPath = String(params.attachment.path || "").trim();
  if (!rawPath) return null;
  const abs = path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(params.project_root, rawPath);
  const relative = toProjectRelativePath(params.project_root, abs);
  if (!relative) return null;
  const stat = await fs
    .stat(abs)
    .then((value) => value)
    .catch(() => null);
  if (!stat?.isFile()) return null;
  return relative;
}

function resolveAttachmentBytes(
  attachment: ControlSessionExecuteAttachmentInput,
): Buffer | null {
  const textContent =
    typeof attachment.content === "string" ? attachment.content : "";
  if (textContent) {
    const clipped = textContent.slice(0, EXECUTE_ATTACHMENT_CONTENT_MAX_CHARS);
    return Buffer.from(clipped, "utf8");
  }

  const base64 = String(attachment.contentBase64 || "").trim();
  if (!base64) return null;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

async function materializeAttachmentContent(params: {
  data_path: string;
  session_id: string;
  attachment: ControlSessionExecuteAttachmentInput;
  index: number;
}): Promise<string | null> {
  const bytes = resolveAttachmentBytes(params.attachment);
  if (!bytes || bytes.length <= 0) return null;
  if (bytes.length > EXECUTE_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `Attachment too large (>${EXECUTE_ATTACHMENT_MAX_BYTES} bytes)`,
    );
  }

  const type = normalizeExecuteAttachmentType(params.attachment.type);
  const ext = inferAttachmentExt({
    type,
    fileName: params.attachment.fileName,
    contentType: params.attachment.contentType,
  });
  const safeName = normalizeAttachmentFileName({
    fileName: params.attachment.fileName,
    fallbackExt: ext,
  });
  const safeContext = String(params.session_id || "session")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const prefix = safeContext || "context";
  const fileName = `${Date.now()}-${prefix}-${String(params.index + 1).padStart(2, "0")}-${safeName}`;
  const cacheDir = path.join(getCacheDirPath(params.data_path), "chrome-extension");
  await fs.ensureDir(cacheDir);
  const absPath = path.join(cacheDir, fileName);
  await fs.writeFile(absPath, bytes);
  return absPath;
}

function toAttachmentLine(params: {
  type: ControlSessionExecuteAttachmentType;
  filePath: string;
  caption?: string;
}): string {
  return render_chat_message_file_tag({
    type: params.type,
    path: params.filePath,
    ...(params.caption ? { caption: params.caption } : {}),
  });
}

/**
 * 构造 execute 入站文本。
 */
export async function buildExecuteInputText(params: {
  /** 当前项目根目录，只用于校验调用方传入的已有文件路径。 */
  project_root: string;
  /** 当前 AgentWorkspace 私有数据目录，用于保存请求内联附件。 */
  data_path: string;
  session_id: string;
  instructions: string;
  attachments?: ControlSessionExecuteAttachmentInput[];
}): Promise<string> {
  const instructions = String(params.instructions || "").trim();
  const inputAttachments = Array.isArray(params.attachments)
    ? params.attachments.slice(0, EXECUTE_ATTACHMENT_MAX_COUNT)
    : [];
  if (inputAttachments.length === 0) return instructions;

  const lines: string[] = [];
  for (let index = 0; index < inputAttachments.length; index += 1) {
    const attachment = inputAttachments[index];
    if (!attachment || typeof attachment !== "object") continue;
    const type = normalizeExecuteAttachmentType(attachment.type);
    const caption = normalizeAttachmentCaption(attachment.caption);

    const reusePath = await resolveAttachmentPathFromInput({
      project_root: params.project_root,
      attachment,
    });
    const filePath =
      reusePath ||
      (await materializeAttachmentContent({
        data_path: params.data_path,
        session_id: params.session_id,
        attachment,
        index,
      }));
    if (!filePath) continue;

    lines.push(
      toAttachmentLine({
        type,
        filePath,
        ...(caption ? { caption } : {}),
      }),
    );
  }

  if (lines.length === 0) return instructions;
  return [lines.join("\n"), instructions || EXECUTE_ATTACHMENT_FALLBACK_TEXT]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
