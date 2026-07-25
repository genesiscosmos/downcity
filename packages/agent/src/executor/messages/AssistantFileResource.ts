/**
 * AssistantFileResource：assistant file part 的本地资源落盘工具。
 *
 * 关键点（中文）
 * - 只处理运行期产生的 assistant file part，不参与 user 附件注入。
 * - 将 data URL、远程 URL 与本地文件统一写入 `.downcity/resources`。
 * - 历史中只保留基于 Agent 项目根目录的相对路径，避免暴露本机绝对路径。
 * - 资源文件按内容 hash 命名，天然去重并避免重复写入大文件。
 */

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import type { FileUIPart } from "ai";
import { getDowncityResourcesDirPath } from "@/workspace/WorkspacePaths.js";

/** 单个 assistant 资源下载允许占用的最长时间。 */
const ASSISTANT_RESOURCE_TIMEOUT_MS = 30_000;
/** 单个 assistant 资源允许写入内存与磁盘的最大字节数。 */
const MAX_ASSISTANT_RESOURCE_BYTES = 25 * 1024 * 1024;

type ParsedDataUrl = {
  /**
   * data URL 声明的媒体类型。
   */
  media_type: string;
  /**
   * data URL 解码后的二进制内容。
   */
  bytes: Buffer;
};

/**
 * assistant file part 资源落盘参数。
 */
export interface MaterializeAssistantFilePartsParams {
  /**
   * 当前项目根目录。
   *
   * 关键点（中文）
   * - 正常 session run 必须显式传入 project_root。
   * - 旧入口未传时仅为兼容回退到 `process.cwd()`。
   */
  project_root?: string;

  /**
   * 待处理的 assistant file parts。
   */
  parts: FileUIPart[];
}

function resolve_project_root(project_root: string | undefined): string {
  const raw = String(project_root || "").trim();
  return path.resolve(raw || process.cwd());
}

function parse_data_url(url: string): ParsedDataUrl | null {
  const raw = String(url || "").trim();
  if (!raw.startsWith("data:")) return null;
  const comma_index = raw.indexOf(",");
  if (comma_index < 0) return null;

  const header = raw.slice(5, comma_index);
  const body = raw.slice(comma_index + 1);
  const header_parts = header.split(";").filter(Boolean);
  const media_type =
    header_parts.find((item) => item.includes("/")) || "application/octet-stream";
  const is_base64 = header_parts.some((item) => item.toLowerCase() === "base64");

  try {
    const bytes = is_base64
      ? Buffer.from(body, "base64")
      : Buffer.from(decodeURIComponent(body), "utf8");
    if (bytes.length === 0) return null;
    return {
      media_type,
      bytes,
    };
  } catch {
    return null;
  }
}

function extension_from_media_type(mediaType: string): string {
  const value = String(mediaType || "").toLowerCase();
  if (value === "image/png") return ".png";
  if (value === "image/jpeg" || value === "image/jpg") return ".jpg";
  if (value === "image/webp") return ".webp";
  if (value === "image/gif") return ".gif";
  if (value === "application/pdf") return ".pdf";
  return ".bin";
}

function extension_from_filename(filename: string | undefined): string {
  const ext = path.extname(String(filename || "").trim()).toLowerCase();
  if (!ext || ext.length > 12) return "";
  return /^[.][a-z0-9]+$/u.test(ext) ? ext : "";
}

function filename_from_url(raw_url: string): string | undefined {
  try {
    const parsed = new URL(raw_url);
    return path.basename(decodeURIComponent(parsed.pathname)) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 将项目内文件路径转换为基于 Agent 根目录的相对路径。
 */
export function toAgentRelativePath(params: {
  /**
   * 当前 Agent 项目根目录。
   */
  project_root: string;
  /**
   * 项目内文件绝对路径。
   */
  filePath: string;
}): string {
  const project_root = resolve_project_root(params.project_root);
  const relative = path
    .relative(project_root, params.filePath)
    .split(path.sep)
    .join("/");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Assistant resource path is outside agent root: ${params.filePath}`);
  }
  return relative;
}

/**
 * 将相对路径解析为 Agent 项目内绝对路径。
 *
 * 关键点（中文）
 * - 相对路径统一基于 Agent 项目根目录解析。
 * - 绝对路径原样归一化后返回。
 * - 越界路径返回空字符串，由调用方决定是否忽略。
 */
export function resolveAgentFilePath(params: {
  /**
   * 当前 Agent 项目根目录。
   */
  project_root: string;
  /**
   * 待解析的相对路径或绝对路径。
   */
  filePath: string;
}): string {
  const raw = String(params.filePath || "").trim();
  if (!raw) return "";
  const project_root = resolve_project_root(params.project_root);
  const file_path = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(project_root, raw);
  if (path.isAbsolute(raw)) return file_path;
  const rel = path.relative(project_root, file_path);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return file_path;
}

async function write_resource_file(params: {
  project_root: string;
  mediaType: string;
  filename?: string;
  bytes: Buffer;
}): Promise<string> {
  const hash = crypto.createHash("sha256").update(params.bytes).digest("hex");
  const ext =
    extension_from_filename(params.filename) ||
    extension_from_media_type(params.mediaType);
  const file_name = `${hash}${ext}`;
  const resources_dir = getDowncityResourcesDirPath(params.project_root);
  const file_path = path.join(resources_dir, file_name);

  await fs.ensureDir(resources_dir);
  try {
    await fs.writeFile(file_path, params.bytes, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
  }

  return file_path;
}

async function read_remote_resource(raw_url: string): Promise<{
  mediaType?: string;
  filename?: string;
  bytes: Buffer;
}> {
  const abort_controller = new AbortController();
  const timeout = setTimeout(() => {
    abort_controller.abort(new Error("Assistant resource download timed out"));
  }, ASSISTANT_RESOURCE_TIMEOUT_MS);
  try {
    const result = await fetch_with_retry(raw_url, abort_controller.signal);
    if (!result.ok) {
      throw new Error(
        `Failed to download assistant file resource: ${result.status} :: url=${raw_url}`,
      );
    }
    const declared_size = Number(result.headers.get("content-length"));
    if (Number.isFinite(declared_size) && declared_size > MAX_ASSISTANT_RESOURCE_BYTES) {
      throw new Error(`Assistant file resource exceeds 25 MiB :: url=${raw_url}`);
    }
    if (!result.body) {
      throw new Error(`Assistant file resource has no response body :: url=${raw_url}`);
    }

    const reader = result.body.getReader();
    const chunks: Buffer[] = [];
    let total_bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total_bytes += value.byteLength;
      if (total_bytes > MAX_ASSISTANT_RESOURCE_BYTES) {
        await reader.cancel();
        throw new Error(`Assistant file resource exceeds 25 MiB :: url=${raw_url}`);
      }
      chunks.push(Buffer.from(value));
    }
    if (total_bytes === 0) {
      throw new Error(`Downloaded assistant file resource is empty :: url=${raw_url}`);
    }
    return {
      mediaType: result.headers.get("content-type")?.split(";")[0]?.trim(),
      filename: filename_from_url(raw_url),
      bytes: Buffer.concat(chunks, total_bytes),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 带重试的 fetch 远程资源。
 *
 * 关键点（中文）
 * - 对 transient 网络错误（fetch failed / UND_ERR_* / ECONNRESET 等）做 2 次指数退避重试。
 * - 最终失败时把 error.cause 链展开到 message，方便定位是代理问题、DNS 问题还是上游问题。
 */
async function fetch_with_retry(
  raw_url: string,
  signal: AbortSignal,
): Promise<Response> {
  const delays_ms = [250, 1_000];
  const attempts = delays_ms.length + 1;
  let last_error: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(raw_url, { signal });
    } catch (error) {
      last_error = error;
      if (!is_transient_fetch_error(error) || attempt === attempts - 1) {
        throw enrich_fetch_error(error, raw_url);
      }
      const delay_ms = delays_ms[attempt] ?? 1_000;
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
    }
  }
  throw enrich_fetch_error(last_error, raw_url);
}

function is_transient_fetch_error(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.message} ${describe_error_cause(error)}`;
  return /fetch failed|UND_ERR|ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(
    text,
  );
}

function enrich_fetch_error(error: unknown, url: string): Error {
  if (!(error instanceof Error)) {
    return new Error(`Download failed: ${String(error)} :: url=${url}`);
  }
  const cause_text = describe_error_cause(error);
  const enriched = new Error(
    `${error.message}${cause_text ? ` :: cause=${cause_text}` : ""} :: url=${url}`,
    error.cause ? { cause: error.cause } : undefined,
  );
  enriched.stack = error.stack;
  return enriched;
}

function describe_error_cause(error: Error): string {
  const parts: string[] = [];
  let current: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;
  while (current && depth < 3) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      const code_text = typeof code === "string" && code ? `[${code}] ` : "";
      parts.push(`${code_text}${current.message || current.name}`.trim());
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
    depth += 1;
  }
  return parts.filter(Boolean).join(" -> ");
}

async function read_local_resource(
  project_root: string,
  raw_url: string,
): Promise<{
  mediaType?: string;
  filename?: string;
  bytes: Buffer;
}> {
  const raw = String(raw_url || "").trim();
  const file_path = raw.startsWith("file://")
    ? fileURLToPath(raw)
    : path.isAbsolute(raw)
      ? raw
      : path.resolve(project_root, raw);
  const file_stat = await fs.stat(file_path);
  if (file_stat.size > MAX_ASSISTANT_RESOURCE_BYTES) {
    throw new Error(`Assistant file resource exceeds 25 MiB: ${file_path}`);
  }
  const bytes = await fs.readFile(file_path);
  if (bytes.length > MAX_ASSISTANT_RESOURCE_BYTES) {
    throw new Error(`Assistant file resource exceeds 25 MiB: ${file_path}`);
  }
  if (bytes.length === 0) {
    throw new Error(`Assistant file resource is empty: ${file_path}`);
  }
  return {
    filename: path.basename(file_path),
    bytes,
  };
}

async function materialize_file_part(params: {
  project_root: string;
  part: FileUIPart;
}): Promise<FileUIPart> {
  const raw_url = String(params.part.url || "").trim();
  if (!raw_url) {
    throw new Error("Assistant file part url is required");
  }
  const parsed_data_url = parse_data_url(raw_url);
  if (parsed_data_url) {
    if (parsed_data_url.bytes.length > MAX_ASSISTANT_RESOURCE_BYTES) {
      throw new Error("Assistant data URL resource exceeds 25 MiB");
    }
    const media_type =
      String(params.part.mediaType || parsed_data_url.media_type || "").trim() ||
      "application/octet-stream";
    const file_path = await write_resource_file({
      project_root: params.project_root,
      mediaType: media_type,
      filename:
        typeof params.part.filename === "string" ? params.part.filename : undefined,
      bytes: parsed_data_url.bytes,
    });
    return {
      ...params.part,
      mediaType: media_type,
      url: toAgentRelativePath({
        project_root: params.project_root,
        filePath: file_path,
      }),
    };
  }

  if (raw_url.startsWith("http://") || raw_url.startsWith("https://")) {
    try {
      const source = await read_remote_resource(raw_url);
      const media_type =
        String(params.part.mediaType || source.mediaType || "").trim() ||
        "application/octet-stream";
      const file_path = await write_resource_file({
        project_root: params.project_root,
        mediaType: media_type,
        filename:
          typeof params.part.filename === "string"
            ? params.part.filename
            : source.filename,
        bytes: source.bytes,
      });
      return {
        ...params.part,
        mediaType: media_type,
        url: toAgentRelativePath({
          project_root: params.project_root,
          filePath: file_path,
        }),
      };
    } catch (error) {
      // 关键点（中文）：远程下载失败时保留原始 URL，不让整张图导致 action 失败。
      // 这样图片至少以链接形式存在，用户可手动点击或后续再试。
      const error_message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AssistantFileResource] remote download failed, keeping original url :: ${error_message}`,
      );
      return params.part;
    }
  }

  const source = await read_local_resource(params.project_root, raw_url);
  const media_type =
    String(params.part.mediaType || source.mediaType || "").trim() ||
    "application/octet-stream";
  const file_path = await write_resource_file({
    project_root: params.project_root,
    mediaType: media_type,
    filename:
      typeof params.part.filename === "string"
        ? params.part.filename
        : source.filename,
    bytes: source.bytes,
  });
  return {
    ...params.part,
    mediaType: media_type,
    url: toAgentRelativePath({
      project_root: params.project_root,
      filePath: file_path,
    }),
  };
}

/**
 * 将 assistant file part 中的资源统一落盘为 Agent 根目录相对路径。
 */
export async function materializeAssistantFileParts(
  params: MaterializeAssistantFilePartsParams,
): Promise<FileUIPart[]> {
  const parts = Array.isArray(params.parts) ? params.parts : [];
  if (parts.length === 0) return [];

  const project_root = resolve_project_root(params.project_root);
  const out: FileUIPart[] = [];

  for (const part of parts) {
    out.push(await materialize_file_part({ project_root: project_root, part }));
  }

  return out;
}
