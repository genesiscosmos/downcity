/** Desktop 用户链接分类与 Workspace 路径解析。 */

import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Desktop 可以执行的链接动作。 */
export type DesktopLinkAction =
  | { /** 使用默认浏览器打开网络地址。 */ kind: "external_url"; /** 规范化后的 HTTP(S) 地址。 */ url: string }
  | { /** 使用 Workspace 文件视图打开文件。 */ kind: "workspace_file"; /** 文件所属 Workspace。 */ workspace_id: string; /** Workspace 内相对路径。 */ relative_path: string }
  | { /** 使用系统默认应用打开文件。 */ kind: "local_file"; /** 规范化后的绝对文件路径。 */ file_path: string }
  | { /** 链接类型不受 Desktop 支持，应阻止 WebContents 导航。 */ kind: "blocked" }
  | { /** 当前链接不应触发跨页面打开。 */ kind: "ignore" };

/** 链接解析时可用的当前 Workspace 上下文。 */
export interface DesktopLinkContext {
  /** 当前 Workspace 标识；没有明确上下文时为空。 */
  workspace_id?: string;
  /** 当前预览文件相对路径，用于解析 Markdown 相对链接。 */
  relative_path?: string;
}

/** 按 Desktop 产品语义把原始链接解析为唯一打开动作。 */
export function resolve_desktop_link(target: string, workspaces: readonly DesktopWorkspaceSummary[], context: DesktopLinkContext): DesktopLinkAction {
  const value = target.trim();
  if (!value || value.startsWith("#")) return { kind: "ignore" };
  const protocol = read_protocol(value);
  if (protocol === "http:" || protocol === "https:") {
    try { return { kind: "external_url", url: new URL(value).toString() }; } catch { return { kind: "blocked" }; }
  }
  let local_path: string | undefined;
  try {
    local_path = protocol === "file:" ? decode_file_url(value) : is_absolute_path(value) ? value : undefined;
  } catch {
    return { kind: "blocked" };
  }
  if (local_path) return resolve_local_path(local_path, workspaces);
  if (protocol) return { kind: "blocked" };

  const workspace = context.workspace_id ? workspaces.find((item) => item.workspace_id === context.workspace_id) : undefined;
  if (!workspace) return { kind: "blocked" };
  const base_path = context.relative_path ? dirname(context.relative_path) : "";
  try {
    const relative_path = normalize_relative_path(`${base_path}/${decodeURIComponent(value.split(/[?#]/, 1)[0])}`);
    return relative_path ? { kind: "workspace_file", workspace_id: workspace.workspace_id, relative_path } : { kind: "blocked" };
  } catch {
    return { kind: "blocked" };
  }
}

function resolve_local_path(file_path: string, workspaces: readonly DesktopWorkspaceSummary[]): DesktopLinkAction {
  const normalized_path = normalize_absolute_path(file_path);
  const workspace = [...workspaces]
    .sort((left, right) => right.workspace_path.length - left.workspace_path.length)
    .find((item) => is_path_inside(normalized_path, normalize_absolute_path(item.workspace_path)));
  if (!workspace) return { kind: "local_file", file_path: normalized_path };
  const workspace_path = normalize_absolute_path(workspace.workspace_path);
  const relative_path = normalized_path.slice(workspace_path.length).replace(/^\/+/, "");
  return relative_path ? { kind: "workspace_file", workspace_id: workspace.workspace_id, relative_path } : { kind: "ignore" };
}

function read_protocol(value: string): string | undefined {
  const match = /^([a-z][a-z\d+.-]*):/i.exec(value);
  return match ? `${match[1].toLowerCase()}:` : undefined;
}

function decode_file_url(value: string): string {
  const url = new URL(value);
  const pathname = decodeURIComponent(url.pathname);
  if (url.host) return `//${url.host}${pathname}`;
  return /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname;
}

function is_absolute_path(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[a-z]:[\\/]/i.test(value);
}

function normalize_absolute_path(value: string): string {
  const uses_network_root = value.startsWith("\\\\") || value.startsWith("//");
  const normalized_body = value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const normalized = uses_network_root ? `/${normalized_body}` : normalized_body;
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function normalize_relative_path(value: string): string | undefined {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/") || undefined;
}

function dirname(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
}

function is_path_inside(file_path: string, directory_path: string): boolean {
  const case_insensitive = /^[a-z]:\//i.test(directory_path);
  const candidate = case_insensitive ? file_path.toLowerCase() : file_path;
  const directory = case_insensitive ? directory_path.toLowerCase() : directory_path;
  return candidate === directory || candidate.startsWith(`${directory}/`);
}
