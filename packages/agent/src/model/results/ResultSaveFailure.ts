/**
 * 业务工具已执行后的保存失败终态。该错误跨模型请求/上下文恢复边界保留，不能被
 * Composer 的推进建议解释成重试权限；操作可能产生副作用，必须由用户决定后续处理。
 */
export class ResultSaveFailure extends Error {
  constructor() {
    super("tool_result_save_failed: tool execution has occurred; result could not be saved. Do not rerun the operation automatically.");
    this.name = "ResultSaveFailure";
  }
}
