/**
 * Workspace 可扩展基类。
 *
 * 职责说明（中文）
 * - 定义 Agent 依赖的 Workspace 资源契约与环境变量生命周期。
 * - 不绑定本地文件系统、远程文件系统或具体执行后端。
 * - 本地 Workspace 与 Cloudflare Computer Workspace 均通过该基类接入 Agent。
 */

import type { WorkspaceShell } from "@/shell/types/WorkspaceShell.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import type { WorkspaceTools } from "@/types/workspace/WorkspaceTools.js";
import type { WorkspaceStorageProvider } from "@/types/workspace/WorkspaceStorage.js";
import type {
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
} from "@/types/workspace/WorkspaceEnv.js";

/** Agent 所需的可扩展 Workspace 基类。 */
export abstract class WorkspaceBase {
  /** 子类完成自身资源装配前调用的无状态基类构造函数。 */
  protected constructor() {}

  /** Workspace 的稳定标识。 */
  abstract readonly id: string;

  /** Workspace 的稳定逻辑根路径；远程实现可以使用虚拟路径。 */
  abstract readonly path: string;

  /** Workspace 内统一的文件与搜索能力。 */
  abstract readonly files: FileSystem;

  /** Workspace 提供给 Agent 的模型工具。 */
  abstract readonly tools: WorkspaceTools;

  /** Workspace 提供的可选命令执行能力。 */
  abstract readonly shell?: WorkspaceShell;

  /** Workspace 私有数据的通用存储后端。 */
  abstract readonly storage: WorkspaceStorageProvider;

  /** 返回当前 Workspace 环境变量快照。 */
  abstract get_env(): Record<string, string>;

  /** 整体替换 Workspace 环境变量。 */
  abstract set_env(next: WorkspaceEnvPatch): void;

  /** 增量修改 Workspace 环境变量。 */
  abstract patch_env(patch: WorkspaceEnvPatch): void;

  /** 订阅 Workspace 环境变量变化。 */
  abstract subscribe_env(
    subscriber: WorkspaceEnvSubscriber,
  ): WorkspaceEnvUnsubscribe;

  /** 释放 Workspace 持有的资源。 */
  abstract dispose(): Promise<void>;
}
