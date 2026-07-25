/**
 * Workspace：本地项目资源与安全作用域。
 *
 * 职责说明（中文）
 * - 只解析一次项目根目录，并将 Store、Tool 与可选 Shell 绑定到同一资源容器。
 * - AgentStore 与 WorkspaceTools 共用同一个 FileSystem 和目录访问范围。
 * - 每个 Workspace 实例只绑定一个 Agent；同一物理目录可创建多个独立实例。
 */

import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import { LocalFileSystem } from "@/workspace/LocalFileSystem.js";
import type { WorkspaceOptions } from "@/types/workspace/Workspace.js";
import type { AgentStore } from "@/types/store/AgentStore.js";
import { LocalAgentStore } from "@/workspace/store/LocalAgentStore.js";
import type { WorkspaceTools } from "@/types/workspace/WorkspaceTools.js";
import type {
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
} from "@/types/workspace/WorkspaceEnv.js";
import { resolve_workspace_env } from "@/workspace/WorkspaceEnv.js";
import { create_workspace_tools } from "@/workspace/tool/WorkspaceTools.js";

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
  readonly tools: WorkspaceTools;

  /** Workspace 内可选的受控命令执行能力。 */
  readonly shell?: WorkspaceOptions["shell"];

  /** Workspace 首次释放产生的稳定 Promise，保证重复释放不会重复关闭资源。 */
  private dispose_promise?: Promise<void>;

  /** 当前 Workspace 已绑定的 Agent 标识；未绑定时为空。 */
  private bound_agent_id?: string;

  /** 当前 Workspace 为唯一 Agent 创建的结构化 Store。 */
  private bound_store?: AgentStore;

  /** 当前 Workspace configured env 的唯一可变状态。 */
  private readonly env: Record<string, string>;

  /** Workspace env 变化订阅器。 */
  private readonly env_subscribers = new Set<WorkspaceEnvSubscriber>();

  constructor(options: WorkspaceOptions) {
    this.path = resolve_workspace_path(options.path);
    this.files = new LocalFileSystem(this.path);
    this.env = resolve_workspace_env(this.path, options.env);
    this.shell = options.shell;
    this.shell?.bind(this.path);
    this.shell?.set_env(this.env);
    this.tools = create_workspace_tools({
      files: this.files,
      ...(this.shell ? { shell: this.shell } : {}),
    });
  }

  /** 返回当前 Workspace env 的浅拷贝快照。 */
  get_env(): Record<string, string> {
    return { ...this.env };
  }

  /** 整体覆盖 Workspace env，并通知已绑定的 Agent。 */
  set_env(next: WorkspaceEnvPatch): void {
    const previous = this.get_env();
    for (const key of Object.keys(this.env)) delete this.env[key];
    this.apply_env_patch(next);
    this.publish_env_if_changed(previous);
  }

  /** 增量修改 Workspace env，并通知已绑定的 Agent。 */
  patch_env(patch: WorkspaceEnvPatch): void {
    const previous = this.get_env();
    this.apply_env_patch(patch);
    this.publish_env_if_changed(previous);
  }

  /** 订阅 Workspace env 的后续变化。 */
  subscribe_env(subscriber: WorkspaceEnvSubscriber): WorkspaceEnvUnsubscribe {
    this.env_subscribers.add(subscriber);
    return () => {
      this.env_subscribers.delete(subscriber);
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

  /** 原地应用一次 env patch。 */
  private apply_env_patch(patch: WorkspaceEnvPatch): void {
    if (!patch || typeof patch !== "object") return;
    for (const [raw_key, raw_value] of Object.entries(patch)) {
      const key = String(raw_key || "").trim();
      if (!key) continue;
      if (raw_value === null || raw_value === undefined) {
        delete this.env[key];
        continue;
      }
      this.env[key] = String(raw_value);
    }
  }

  /** 只在内容真实变化时发布完整 env 快照。 */
  private publish_env_if_changed(previous: Record<string, string>): void {
    const current = this.get_env();
    const previous_keys = Object.keys(previous);
    const current_keys = Object.keys(current);
    const changed = previous_keys.length !== current_keys.length ||
      current_keys.some((key) => previous[key] !== current[key]);
    if (!changed) return;
    const snapshot = Object.freeze(current);
    this.shell?.set_env(snapshot);
    for (const subscriber of this.env_subscribers) {
      try {
        subscriber(snapshot);
      } catch {
        // 观察者失败不能回滚已经完成的 Workspace env 修改。
      }
    }
  }
}
