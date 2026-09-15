/**
 * Desktop Workspace 摘要投影。
 *
 * Workspace 的登记信息是列表的主体，根目录 README 仅用于补充展示。README 不存在或
 * 当前宿主无权读取时，不应阻止其他 Workspace 被列出；未知文件系统错误仍由调用方处理。
 */

import type { LocalWorkspaceConfig } from "@downcity/city/local";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DesktopWorkspaceSummary } from "../../common/types/DesktopApi.js";

const unavailable_readme_error_codes = new Set(["EACCES", "ENOENT", "EPERM"]);

/** 判断文件系统错误是否只表示 Workspace README 当前不可用于展示。 */
export function is_unavailable_workspace_readme_error(reason: unknown): boolean {
  return unavailable_readme_error_codes.has((reason as NodeJS.ErrnoException | undefined)?.code || "");
}

/** 读取 Workspace 根目录 README；缺失或无读取权限时返回空内容。 */
export async function read_workspace_readme(workspace_path: string): Promise<string> {
  try {
    return await readFile(path.join(workspace_path, "README.md"), "utf8");
  } catch (reason) {
    if (is_unavailable_workspace_readme_error(reason)) return "";
    throw reason;
  }
}

/** 把 Registry Workspace 收敛成 Renderer 所需摘要。 */
export async function to_desktop_workspace_summary(record: LocalWorkspaceConfig): Promise<DesktopWorkspaceSummary> {
  return {
    workspace_id: record.workspace_id,
    workspace_path: record.workspace_path,
    name: record.name,
    readme: await read_workspace_readme(record.workspace_path),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}
