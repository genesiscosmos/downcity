/**
 * Chat 活动行的 Power 事实表注入。
 *
 * ## 为什么需要 context
 *
 * 活动行要显示「Shell · 执行命令」而不是裸的 `shell`，因此需要知道当前有哪些 Power、
 * 它们的标题与图标。这份数据来自 `catalog.powers`，而消息渲染树在它下面还有七层
 * （SessionTimeline → SessionMessageList → Segment → Row → AgentMessage → Content → AgentActivity）。
 * 逐层加 prop 会让每一层都多一个与自身职责无关的参数，且每一层都要进 memo 比较。
 *
 * ## 与 `show_reasoning` 的区别
 *
 * `show_reasoning` 是页面级偏好，本来就由页面持有，逐层传是合理的；
 * Power 目录是**全局事实**，任何一层都可能需要，因此走 context。
 * 这与 `TurnFileOpenProvider` 处理「打开文件」动作的方式一致。
 *
 * ## 缺失时的行为
 *
 * 未注入时活动行仍然工作：身份判定降级到 power 工具的输入契约，显示注册名而非标题。
 * 因此这个 Provider 不是硬依赖，草稿页、Group 页或未来的独立渲染器忘了包它也不会报错。
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ChatPowerLookup } from "@/features/chat/types/AgentMessage";
import { resolve_chat_power_lookup } from "@/features/chat/lib/message/agent_activity_presentation";

/** 未注入时的空表；活动行据此降级为注册名。 */
const EMPTY_POWER_LOOKUP: ChatPowerLookup = new Map();

const ChatPowerLookupContext = createContext<ChatPowerLookup>(EMPTY_POWER_LOOKUP);

/** 注入当前可见 Power 的展示事实表。 */
export function ChatPowerLookupProvider({ powers, children }: {
  /** 当前可见 Power 的摘要集合；来自 catalog store。 */
  powers: readonly { power_id: string; title: string; icon_url?: string }[];
  /** 消息渲染内容。 */
  children: ReactNode;
}) {
  // 只有 power 集合本身变化时才重建：目录里别的字段（描述、runtime 状态）与本表无关。
  const lookup = useMemo(() => resolve_chat_power_lookup(powers), [powers]);
  return <ChatPowerLookupContext.Provider value={lookup}>{children}</ChatPowerLookupContext.Provider>;
}

/** 读取当前 Power 展示事实表；未注入时为空表。 */
export function use_chat_power_lookup(): ChatPowerLookup {
  return useContext(ChatPowerLookupContext);
}
