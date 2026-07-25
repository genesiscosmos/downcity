/**
 * Workspace：本地项目资源与安全作用域。
 *
 * 职责说明（中文）
 * - 只解析一次项目根目录，并将文件、搜索与可选 Shell 绑定到同一边界。
 * - 不管理 Session、Message、Memory、Task 或 Agent 生命周期。
 * - Workspace 的所有权属于创建它的调用方，可安全地被多个 Agent 引用。
 */

import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Tool } from "ai";
import { create_file_tools } from "@/workspace/tool/FileTools.js";
import { create_search_tools } from "@/workspace/tool/SearchTools.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import { LocalFileSystem } from "@/workspace/LocalFileSystem.js";
import type {
  WorkspaceOptions,
  WorkspaceResources,
} from "@/types/workspace/Workspace.js";

/** 将调用方路径解析为稳定、真实的本地目录。 */
function resolve_workspace_path(input: string): string {
  const requested_path = String(input || "").trim();
  if (!requested_path) {
    throw new Error("Workspace requires a non-empty path");
  }
  const resolved_path = realpathSync.native(path.resolve(requested_path));
  if (!statSync(resolved_path).isDirectory()) {
    throw new Error(`Workspace path must be a directory: ${resolved_path}`);
  }
  return resolved_path;
}

/** 本地 Workspace。 */
export class Workspace implements WorkspaceResources {
  /** 已解析且不可变的项目根目录。 */
  readonly path: string;

  /** Workspace 根目录内统一的受控文件与搜索能力。 */
  readonly files: FileSystem;

  /** Workspace 内可用的文件、搜索与可选命令工具。 */
  readonly tools: Record<string, Tool>;

  /** Workspace 内可选的受控命令执行能力。 */
  readonly shell?: WorkspaceOptions["shell"];

  /** Workspace 首次释放产生的稳定 Promise，保证重复释放不会重复关闭资源。 */
  private dispose_promise?: Promise<void>;

  constructor(options: WorkspaceOptions) {
    this.path = resolve_workspace_path(options.path);
    this.files = new LocalFileSystem(this.path);
    this.shell = options.shell;
    this.shell?.bind(this.path);

    this.tools = {
      ...create_file_tools({
        run_file_action: async (request) =>
          await this.files.run_file_action(request),
      }),
      ...create_search_tools({
        run_search_action: async (request) =>
          await this.files.run_search_action(request),
      }),
      ...(this.shell?.tools || {}),
    };
  }

  /** 关闭 Workspace 持有的命令进程与平台 Sandbox 资源。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= this.shell?.dispose() ?? Promise.resolve();
    await this.dispose_promise;
  }
}
