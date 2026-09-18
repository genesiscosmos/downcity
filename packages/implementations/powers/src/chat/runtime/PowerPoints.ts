/**
 * Chat power 点定义。
 *
 * 关键点（中文）
 * - power 点由 chat power runtime 定义，不由具体 power 定义。
 * - chat power runtime 只依赖这些稳定点名，具体 power 负责实现其中某些点。
 * - 后续新增 chat 生命周期 power 点，也应统一收敛到这里。
 */

/**
 * Chat runtime 对外暴露的 power 点目录。
 */
export const CHAT_POWER_POINTS = {
  /**
   * 增强入站消息正文。
   *
   * 说明（中文）
   * - chat power runtime 先构造基础 attachment/body 文本。
   * - power 通过 pipeline 往 `powerSections` 中追加中间块。
   */
  augmentInbound: "chat.augmentInbound",
  /**
   * 回复前文本增强。
   *
   * 说明（中文）
   * - chat power runtime 在真正回发到 channel 前调用。
   * - power 可在这里做收尾改写、格式整理、签名注入等。
   */
  beforeReply: "chat.beforeReply",
  /**
   * 回复后事件通知。
   *
   * 说明（中文）
   * - chat power runtime 在一次回复发送完成后触发。
   * - power 可在这里做审计、统计、回执同步等副作用。
   */
  afterReply: "chat.afterReply",
  /**
   * 入队前数据增强。
   *
   * 说明（中文）
   * - chat power runtime 在 append ingress / enqueue 之前调用。
   * - power 可在这里改写入队文本或补充 extra metadata。
   */
  beforeEnqueue: "chat.beforeEnqueue",
  /**
   * 入队后事件通知。
   *
   * 说明（中文）
   * - chat power runtime 在消息真正入队完成后调用。
   * - power 可在这里做统计、观测、调试落点。
   */
  afterEnqueue: "chat.afterEnqueue",
} as const;
