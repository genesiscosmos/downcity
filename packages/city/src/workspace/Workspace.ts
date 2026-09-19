/**
 * Workspace：本地项目资源与安全作用域。
 *
 * 职责说明（中文）
 * - 只解析一次项目根目录，并组合项目 Tool、Env 与可选 Shell。
 * - Agent private runtime directory 私有 Store 使用独立 FileSystem，不暴露给项目文件工具。
 * - Workspace 不持有 Agent；同一物理目录可以由不同 Agent 分别创建实例进入。
 */

import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { FileSystem, WorkspaceRuntime } from "@downcity/type/workspace";
import { LocalFileSystem } from "@/workspace/LocalFileSystem.js";
import type { WorkspaceOptions } from "@/types/workspace/Workspace.js";
import type { WorkspaceTools } from "@downcity/type/workspace";
import type {
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
} from "@downcity/type/workspace";
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
export class Workspace implements WorkspaceRuntime {
  /** Workspace 的稳定标识。 */
  readonly id: string;

  /** Workspace 的用户可见名称；未提供时回退到 id。 */
  readonly name: string;

  /** 已解析且不可变的项目根目录。 */
  readonly path: string;

  /** Workspace 根目录内统一的受控文件与搜索能力。 */
  readonly files: FileSystem;

  /** Workspace 内可用的文件、搜索与可选命令工具。 */
  readonly tools: WorkspaceTools;

  /** Workspace 内可选的受控命令执行能力。 */
  readonly shell?: WorkspaceOptions["shell"];

  /** 当前 Workspace 的一次性宿主运行资源绑定。 */
  private runtime_binding?: {
    /** Downcity 私有运行数据目录。 */
    runtime_path: string;
  };

  /** Workspace 首次释放产生的稳定 Promise，保证重复释放不会重复关闭资源。 */
  private dispose_promise?: Promise<void>;

  /** 当前 Workspace configured env 的唯一可变状态。 */
  private readonly env: Record<string, string>;

  /** Workspace env 变化订阅器。 */
  private readonly env_subscribers = new Set<WorkspaceEnvSubscriber>();

  constructor(options: WorkspaceOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Workspace requires a non-empty id");
    this.name = String(options.name || "").trim() || this.id;
    this.path = resolve_workspace_path(options.path);
    this.env = resolve_workspace_env(this.path, options.env);
    this.shell = options.shell;
    this.shell?.set_env(this.env);
    // 关键点（中文）：文件工具运行在宿主进程，模型却可能回传隔离环境内的绝对路径。
    // 这里把当前 Shell 的挂载以惰性方式接入文件系统，让路径策略能把两者视为同一目标。
    this.files = new LocalFileSystem({
      root_path: this.path,
      read_sandbox_mounts: () => this.shell?.describe_sandbox()?.mounts ?? [],
    });
    this.tools = create_workspace_tools({
      files: this.files,
      ...(this.shell ? { shell: this.shell } : {}),
    });
    if (options.runtime_path) {
      this.bind_runtime({ runtime_path: options.runtime_path });
    }
  }

  /** 由 City 或独立宿主一次性注入运行目录，并绑定当前 Shell。 */
  bind_runtime(input: {
    runtime_path: string;
  }): void {
    const runtime_path = String(input?.runtime_path || "").trim();
    if (!runtime_path) throw new Error("Workspace.bind_runtime requires runtime_path");
    if (!this.shell) return;
    const next_binding = {
      runtime_path: path.resolve(runtime_path),
    };
    if (this.runtime_binding) {
      if (this.runtime_binding.runtime_path !== next_binding.runtime_path) {
        throw new Error(`Workspace is already bound: ${this.id}`);
      }
      return;
    }
    this.shell.bind({
      workspace_id: this.id,
      root_path: this.path,
      data_path: next_binding.runtime_path,
    });
    this.runtime_binding = next_binding;
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

  /** 释放当前 Workspace 持有的 Shell。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const errors: unknown[] = [];
      try {
        await (this.shell?.dispose() ?? Promise.resolve());
      } catch (error) {
        errors.push(error);
      }
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
