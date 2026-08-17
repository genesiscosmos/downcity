/**
 * ShellRuntime 类型定义。
 *
 * 关键点（中文）
 * - 这些类型描述 shell runtime 的实例级运行态。
 * - 状态所有权归属于 `Shell` 实例，而不是模块级单例。
 * - 统一归档到 `src/shell/` 相邻层级，避免继续分散在跨域目录里。
 */

import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";
import type { ShellProcessHandle } from "@/shell/types/Sandbox.js";
import type {
  ShellSessionSnapshot,
} from "@/shell/types/ShellAction.js";
import type { ResolvedShellRuntimeOptions } from "@/shell/types/ShellRuntimeOptions.js";

/**
 * 单个 shell wait 调用挂起时注册的 waiter。
 */
export type ShellSessionWaiter = {
  /**
   * 当前等待完成后的唤醒回调。
   */
  resolve: () => void;
  /**
   * 当前 waiter 对应的超时定时器。
   */
  timer: NodeJS.Timeout;
};

/**
 * 单个 shell session 的内存运行态。
 */
export type ShellSessionRuntimeState = {
  /**
   * 当前 shell session 的对外快照。
   */
  snapshot: ShellSessionSnapshot;
  /**
   * 当前 shell session 对应的子进程句柄。
   */
  child: ShellProcessHandle;
  /**
   * 当前已缓存的标准输出与标准错误文本。
   */
  outputText: string;
  /**
   * 当前输出持久化文件路径。
   */
  outputFilePath: string;
  /**
   * 当前快照持久化文件路径。
   */
  snapshotFilePath: string;
  /**
   * 串行化文件写入链，避免并发 append 乱序。
   */
  writeChain: Promise<void>;
  /**
   * 终态后的延迟清理定时器。
   */
  cleanupTimer: NodeJS.Timeout | null;
  /**
   * 当前挂起等待该 session 状态变化的 waiter 集合。
   */
  waiters: Set<ShellSessionWaiter>;
  /**
   * 当前 shell 进入终态后的完成 promise。
   *
   * 关键点（中文）
   * - 供 `shell.exec` 这类 one-shot 路径直接等待进程结束。
   * - 这样可以减少对版本轮询的依赖，降低瞬时命令的竞态超时。
   */
  completionPromise: Promise<void>;
  /**
   * 当前 shell 进入终态时触发的完成回调。
   */
  resolveCompletion: () => void;
};

/**
 * `Shell` 实例级状态。
 */
export type ShellRuntimeState = {
  /**
   * 当前 shell 归一化后的运行参数。
   */
  options: ResolvedShellRuntimeOptions;
  /**
   * 当前实例持有的全部 in-memory shell session。
   */
  sessions: Map<string, ShellSessionRuntimeState>;
  /**
   * 当前实例最近一次启动时绑定的 agent context。
   *
   * 关键点（中文）
   * - 仅用于 shell 自动通知 chat 的回调路径。
   * - 这是实例字段，不再是模块级全局变量。
   */
  context: ShellHostContext | null;
};
