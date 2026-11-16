/** 扩展错误只输出宿主定义文案，底层进程 stderr 和入口异常不直接进入协议。 */
import type { ExtensionError } from "../types/Extension.js";

/** 带稳定退出码与阶段的扩展操作异常。 */
export class ExtensionFailure extends Error {
  constructor(readonly code: string, message: string, readonly stage: ExtensionError["stage"], readonly exit_code = 1, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ExtensionFailure";
  }

  /** 不输出 stack、源码内容或底层 URL。 */
  to_result(): ExtensionError {
    return { code: this.code, message: this.message, stage: this.stage, ...(this.details ? { details: this.details } : {}) };
  }
}

/** 未识别异常不能把项目秘密意外转成可展示错误。 */
export function extension_error(error: unknown, stage: ExtensionError["stage"]): ExtensionError {
  return error instanceof ExtensionFailure ? error.to_result() : { code: `${stage}_failed`, message: `Extension ${stage} failed`, stage };
}
