/**
 * CLI 长任务进度输出类型。
 *
 * 进度协议只描述当前任务与可选命令，TTY 动画和非 TTY 文本降级由渲染器负责。
 */

/** CLI 长任务的结构化描述。 */
export interface CliProgressInput {
  /** 用户当前等待的任务名称。 */
  title: string;
  /** 当前实际执行的命令或目标说明。 */
  detail?: string;
  /** 是否允许使用单行动画；子进程继承终端输出时应关闭。 */
  animate?: boolean;
}
