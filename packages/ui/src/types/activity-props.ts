/** 完整 Activity 组件的公开输入；网络、权限与业务执行均属于宿主。 */
import type { AgentActivityPart } from "./chat-blocks";
import type { ActivityHost } from "./activity-host";
import type { ChatControlMessages } from "./chat-controls";

/** 单条消息内按原始顺序展示的完整活动块。 */
export interface ActivityProps extends ChatControlMessages {
  /** canonical Tool、Action、Reasoning 与 Input；相邻非推理活动自动分组。 */
  parts: readonly AgentActivityPart[];
  /** 可选领域元数据、资源入口、Power 详情和阅读状态适配；缺省时组件完整可用。 */
  host?: ActivityHost;
}
