/**
 * ChatChannelFacade：chat 渠道子模块门面。
 *
 * 关键点（中文）
 * - 这里只负责把 channel 相关子模块重新聚合为一个稳定入口。
 * - 内部实现已经拆为 core / lifecycle / config / actions 四层。
 * - 这样可以在不影响 `ChatPlugin` 与 action 调用方的前提下，持续收敛复杂度。
 */

export {
  createChatChannelState,
  resolveChatChannelNameOrThrow,
} from "./ChatChannelCore.js";
export { startChatChannels, stopChatChannels } from "./ChatChannelLifecycle.js";
export {
  executeChatStatusAction,
  executeChatTestAction,
  executeChatReconnectAction,
} from "./ChatChannelActions.js";
