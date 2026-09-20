/**
 * POSIX Shell 调用构造。
 *
 * 关键点（中文）
 * - 原生隔离只在 macOS 与 Linux 生效，因此这里只处理 POSIX 语义。
 * - 本模块只负责命令解释器参数，不承担任何权限控制。
 * - 与 City 侧 ShellCommandModel 保持同一语义；Provider 不能反向依赖 City，因此单独实现。
 */

import type { ShellCommandInvocation } from "@downcity/type/shell";

/** 构造 POSIX Shell 进程参数。 */
export function build_shell_command_invocation(input: {
  /** Shell 可执行文件路径。 */
  shell_path: string;
  /** 要解释执行的完整命令文本。 */
  cmd: string;
  /** 是否启用 login shell 语义。 */
  login: boolean;
}): ShellCommandInvocation {
  return {
    command: input.shell_path,
    args: [input.login ? "-lc" : "-c", input.cmd],
  };
}
