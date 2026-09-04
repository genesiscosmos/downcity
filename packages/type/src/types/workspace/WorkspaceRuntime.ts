/**
 * Workspace 运行时协议。
 *
 * Agent 只借用当前执行所需的项目资源，不负责创建或释放具体实现。City 与第三方
 * Workspace Adapter 通过本协议向 Agent 提供文件、工具、环境和可选 Shell 能力。
 */

import type { WorkspaceShell } from "../shell/WorkspaceShell.js";
import type { FileSystem } from "./FileSystem.js";
import type {
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
} from "./WorkspaceEnv.js";
import type { WorkspaceTools } from "./WorkspaceTools.js";

/** Agent 执行期间借用的最小 Workspace 能力。 */
export interface WorkspaceRuntime {
  /** Workspace 的稳定业务标识，不随物理路径移动而变化。 */
  readonly id: string;

  /** Workspace 的稳定逻辑根路径；远程实现可以使用虚拟路径。 */
  readonly path: string;

  /** 受当前 Workspace 根目录约束的文件能力。 */
  readonly files: FileSystem;

  /** 当前 Workspace 提供给模型的工具集合。 */
  readonly tools: WorkspaceTools;

  /** 当前 Workspace 可选的命令和进程执行能力。 */
  readonly shell?: WorkspaceShell;

  /** 返回当前 Workspace 环境变量的独立快照。 */
  get_env(): Record<string, string>;

  /** 整体替换后续执行使用的 Workspace 环境变量。 */
  set_env(next: WorkspaceEnvPatch): void;

  /** 增量修改后续执行使用的 Workspace 环境变量。 */
  patch_env(patch: WorkspaceEnvPatch): void;

  /** 订阅 Workspace 环境变量变化并返回取消订阅函数。 */
  subscribe_env(subscriber: WorkspaceEnvSubscriber): WorkspaceEnvUnsubscribe;

  /** 释放当前 Workspace 实现拥有的文件、进程或远程连接资源。 */
  dispose(): Promise<void>;
}
