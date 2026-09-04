/**
 * Shell 命令解释器共享类型。
 *
 * 关键点（中文）
 * - 命令文本由对应平台的解释器消费，不能假设所有平台都支持 POSIX `-c`。
 * - 调用描述只表达可执行文件与参数，不负责 Sandbox 权限隔离。
 */

/** 单次 Shell 命令最终使用的进程调用描述。 */
export interface ShellCommandInvocation {
  /** 要启动的 Shell 可执行文件。 */
  command: string;
  /** 传给 Shell 可执行文件的完整参数。 */
  args: string[];
}
