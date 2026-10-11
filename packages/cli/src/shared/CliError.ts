/**
 * CLI 统一错误类型。
 *
 * 关键点（中文）
 * - 所有命令层只 throw CliError，不再直接 process.exit。
 * - createVersionBanner 作为全局 catch point 统一渲染 CliError。
 * - 保证 --json 模式下也能输出结构化错误。
 */

/**
 * CLI 错误构造参数。
 */
export interface CliErrorParams {
  /**
   * 进程退出码。
   *
   * 说明（中文）
   * - 默认 1。
   * - 仅在顶层 catch 时写入 process.exitCode，不直接 process.exit。
   */
  exitCode?: number;

  /**
   * 错误标题。
   *
   * 说明（中文）
   * - 人类可读模式下渲染为 block 的 title。
   * - JSON 模式下作为 error 字段输出。
   */
  title: string;

  /**
   * 错误补充说明。
   *
   * 说明（中文）
   * - 人类可读模式下渲染为 block 的 note。
   * - JSON 模式下作为 error.detail 输出。
   */
  note?: string;

  /**
   * 修复建议。
   *
   * 说明（中文）
   * - 人类可读模式下渲染为 fact（label: "fix", value: this）。
   * - JSON 模式下作为 error.fix 输出。
   */
  fix?: string;
}

/**
 * CLI 统一错误类。
 *
 * 说明（中文）
 * - 继承自 Error，保持 try/catch 兼容。
 * - 携带渲染所需的 metadata（exitCode / note / fix）。
 */
export class CliError extends Error {
  /** 进程退出码（默认 1）。 */
  readonly exitCode: number;
  /** 错误补充说明。 */
  readonly note?: string;
  /** 修复建议。 */
  readonly fix?: string;

  constructor(params: CliErrorParams) {
    super(params.title);
    this.exitCode = params.exitCode ?? 1;
    this.note = params.note;
    this.fix = params.fix;
  }
}
