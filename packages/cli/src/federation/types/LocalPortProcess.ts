/** 本地部署端口冲突的进程快照，用于展示及停止前身份复核。 */
export interface LocalPortProcess {
  /** 正在监听目标地址的进程 ID。 */
  pid: number;
  /** 系统报告的启动时间及完整命令，用于识别 PID 复用和进程替换。 */
  identity: string;
  /** 进程当前工作目录；不可读取时不允许自动停止。 */
  cwd: string;
}
