/**
 * Chat plugin 点定义。
 *
 * 关键点（中文）
 * - plugin 点由 chat plugin runtime 定义，不由具体 plugin 定义。
 * - chat plugin runtime 只依赖这些稳定点名，具体 plugin 负责实现其中某些点。
 * - 后续新增 chat 生命周期 plugin 点，也应统一收敛到这里。
 */

/**
 * Chat runtime 对外暴露的 plugin 点目录。
 */
export const CHAT_PLUGIN_POINTS = {
  /**
   * 增强入站消息正文。
   *
   * 说明（中文）
   * - chat plugin runtime 先构造基础 attachment/body 文本。
   * - plugin 通过 pipeline 往 `pluginSections` 中追加中间块。
   */
  augmentInbound: "chat.augmentInbound",
  /**
   * 回复前文本增强。
   *
   * 说明（中文）
   * - chat plugin runtime 在真正回发到 channel 前调用。
   * - plugin 可在这里做收尾改写、格式整理、签名注入等。
   */
  beforeReply: "chat.beforeReply",
  /**
   * 回复后事件通知。
   *
   * 说明（中文）
   * - chat plugin runtime 在一次回复发送完成后触发。
   * - plugin 可在这里做审计、统计、回执同步等副作用。
   */
  afterReply: "chat.afterReply",
  /**
   * 入队前数据增强。
   *
   * 说明（中文）
   * - chat plugin runtime 在 append ingress / enqueue 之前调用。
   * - plugin 可在这里改写入队文本或补充 extra metadata。
   */
  beforeEnqueue: "chat.beforeEnqueue",
  /**
   * 入队后事件通知。
   *
   * 说明（中文）
   * - chat plugin runtime 在消息真正入队完成后调用。
   * - plugin 可在这里做统计、观测、调试落点。
   */
  afterEnqueue: "chat.afterEnqueue",
} as const;
