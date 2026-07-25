/**
 * Workspace：本地项目资源与安全作用域。
 *
 * 职责说明（中文）
 * - 只解析一次项目根目录，并将 Store、Tool 与可选 Shell 绑定到同一资源容器。
 * - AgentStore 与 AgentTools 共用同一个 FileSystem 和目录访问范围。
 * - 每个 Workspace 实例只绑定一个 Agent；同一物理目录可创建多个独立实例。
 */

import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Tool } from "ai";
import { create_file_tools } from "@/workspace/tool/FileTools.js";
import { create_search_tools } from "@/workspace/tool/SearchTools.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import { LocalFileSystem } from "@/workspace/LocalFileSystem.js";
import type { WorkspaceOptions } from "@/types/workspace/Workspace.js";
import type { AgentStore } from "@/types/store/AgentStore.js";
import { LocalAgentStore } from "@/workspace/store/LocalAgentStore.js";

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
export class Workspace {
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

  /** 当前 Workspace 已绑定的 Agent 标识；未绑定时为空。 */
  private bound_agent_id?: string;

  /** 当前 Workspace 为唯一 Agent 创建的结构化 Store。 */
  private bound_store?: AgentStore;

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

  /** 将当前 Workspace 唯一绑定到 Agent，并创建结构化状态入口。 */
  bind_agent(agent_id: string): AgentStore {
    const resolved_agent_id = String(agent_id || "").trim();
    if (!resolved_agent_id) {
      throw new Error("Workspace.bind_agent requires a non-empty agent_id");
    }
    if (this.dispose_promise) {
      throw new Error("Cannot bind a disposed Workspace");
    }
    if (this.bound_agent_id) {
      throw new Error(
        `Workspace is already bound to Agent "${this.bound_agent_id}"`,
      );
    }
    this.bound_agent_id = resolved_agent_id;
    this.bound_store = new LocalAgentStore({
      files: this.files,
      agent_id: resolved_agent_id,
    });
    return this.bound_store;
  }

  /** 关闭 Workspace 持有的 Store、命令进程与平台 Sandbox 资源。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const results = await Promise.allSettled([
        this.bound_store?.dispose() ?? Promise.resolve(),
        this.shell?.dispose() ?? Promise.resolve(),
      ]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (errors.length > 0) {
        throw new AggregateError(errors, "Workspace dispose failed");
      }
    })();
    await this.dispose_promise;
  }
}
