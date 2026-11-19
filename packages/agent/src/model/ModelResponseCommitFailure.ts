/**
 * 完整模型响应的持久提交未获可靠确认。
 *
 * 工具尚未开始，不能冒充工具副作用失败；也不能再次生成覆盖可能已提交的响应。
 * 交回存储和执行恢复边界，手动模型 Retry 不接管这个错误。
 */
export class ModelResponseCommitFailure extends Error {
  constructor(cause?: unknown) {
    super("model_response_commit_failed: response persistence could not be confirmed; no tools were started. Review storage and execution state before starting a new request.", { cause });
    this.name = "ModelResponseCommitFailure";
  }
}
