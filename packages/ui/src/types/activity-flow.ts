/** 原位活动分组契约；宿主只注入领域摘要、单项正文与可选的阅读状态。 */
import type { ReactNode } from "react";
import type { AgentActivityPart } from "./chat-blocks";
import type { ActivityRowProps, ActivityRowSummary } from "./activity-row";

/** Desktop 与浏览器共同使用的有序活动流。 */
export interface ActivityFlowProps {
  /** 已按 canonical 顺序排列并过滤不可见输入的活动。 */
  parts: readonly AgentActivityPart[];
  /** 只构造轻量摘要；不可在此读取或格式化完整详情。 */
  summarize(part: AgentActivityPart): ActivityRowSummary;
  /** 展示单项活动；分组收起时不会调用。 */
  render_item(part: AgentActivityPart): ReactNode;
  /** 可选宿主行组件，用于持久化分组的展开选择；默认使用共享 ActivityRow。 */
  render_group?(props: ActivityRowProps, first_part_id: string): ReactNode;
}
