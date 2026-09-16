/**
 * Desktop 本地文件受控协议。
 *
 * 关键点（中文）
 * - 聊天气泡里的 Markdown 会引用 Agent 自己产出的文件（图片、音频）；渲染进程不能直接读本地
 *   绝对路径，因此这里开一个只读协议，把「被允许的根目录」内的文件暴露成可加载 URL。
 * - 允许范围只有两处：当前用户级数据根下的 `agents/`（Agent 私有产物，例如 method 结果），
 *   以及已登记 Workspace 的真实目录。除此之外一律 404。
 * - 请求必须给出绝对路径，且解析后要落在允许根内；符号链接不走特殊处理，由 realpath 收口。
 * - 只在渲染进程侧用于展示，不提供写入、删除或目录列表能力。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { protocol } from "electron";
import { get_local_agents_path } from "@downcity/city/local";
import {
  local_file_host,
  local_file_scheme,
  read_local_file_path,
} from "../../common/file/local_file_url.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";

/** 扩展名到响应类型；未列出的一律按二进制流返回。 */
const CONTENT_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

/** 在 Electron ready 前登记本地文件特权协议。 */
export function register_local_file_scheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: local_file_scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
  }]);
}

/** 在 Electron ready 后绑定本地文件响应器。 */
export function register_local_file_protocol(data: DesktopLocalData): void {
  protocol.handle(local_file_scheme, async (request) => {
    try {
      return await local_file_response(data, new URL(request.url));
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  });
}

/** 把请求解析为允许根内的文件响应。 */
async function local_file_response(data: DesktopLocalData, url: URL): Promise<Response> {
  if (url.hostname !== local_file_host) return new Response("Not Found", { status: 404 });
  const requested_path = read_local_file_path(url.pathname);
  if (!requested_path) return new Response("Bad Request", { status: 400 });

  const resolved_path = await resolve_existing_file(path.resolve(requested_path));
  if (!resolved_path) return new Response("Not Found", { status: 404 });

  const allowed_roots = await resolve_allowed_roots(data);
  if (!allowed_roots.some((root) => is_path_inside_root(root, resolved_path))) {
    return new Response("Forbidden", { status: 403 });
  }

  const bytes = await fs.readFile(resolved_path);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": CONTENT_TYPES[path.extname(resolved_path).toLowerCase()]
        ?? "application/octet-stream",
    },
  });
}

/** 返回真实存在的普通文件路径；不存在、不可读或不是文件时返回 null。 */
async function resolve_existing_file(file_path: string): Promise<string | null> {
  try {
    const real_path = await fs.realpath(file_path);
    const stats = await fs.stat(real_path);
    return stats.isFile() ? real_path : null;
  } catch {
    return null;
  }
}

/** 计算当前允许暴露的根目录：Agent 私有产物与已登记 Workspace。 */
async function resolve_allowed_roots(data: DesktopLocalData): Promise<string[]> {
  const roots = [get_local_agents_path(data.root_path)];
  for (const workspace of data.workspaces.list()) {
    const root = await resolve_existing_directory(workspace.workspace_path);
    if (root) roots.push(root);
  }
  return roots;
}

/** 返回真实存在的目录路径；不存在或不是目录时返回 null。 */
async function resolve_existing_directory(directory_path: string): Promise<string | null> {
  try {
    const real_path = await fs.realpath(directory_path);
    const stats = await fs.stat(real_path);
    return stats.isDirectory() ? real_path : null;
  } catch {
    return null;
  }
}

/** 判断目标路径是否等于根目录或位于根目录之下。 */
function is_path_inside_root(root_path: string, target_path: string): boolean {
  const relative_path = path.relative(root_path, target_path);
  return (
    relative_path === ""
    || (relative_path !== ".."
      && !relative_path.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative_path))
  );
}
