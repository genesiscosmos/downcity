/**
 * Session Runtime 对宿主 Extension 开放的稳定检查点。
 *
 * 检查点由 Session 定义和触发，具体 Extension 只选择是否注册处理器。
 */

/** Session Runtime 的 Extension Hook point 目录。 */
export const SESSION_EXTENSION_POINTS = Object.freeze({
  /** 建立 Session system snapshot 时允许 Extension 追加命名 blocks。 */
  system_context: "session.system_context",

  /** 当前 Turn 首次组装模型输入时允许 Extension 追加低权限参考 blocks。 */
  turn_context: "session.turn_context",

  /** canonical Turn 完成提交后通知 Extension 执行副作用。 */
  turn_committed: "session.turn_committed",
} as const);
