/** Group 成员组合头像，统一用于 Sidebar、配置页和 Chat 标题。 */

import { TbUsers } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import { use_translation } from "@/locales/i18n";

/** Group 组合头像属性。 */
interface GroupAvatarProps {
  /** 当前 Group 摘要。 */
  group: DesktopGroupSummary;
  /** 当前可用 Agent。 */
  agents: DesktopAgentSummary[];
  /** 头像整体尺寸样式。 */
  class_name?: string;
  /** 单个成员头像尺寸样式。 */
  member_class_name?: string;
}

/** 使用前三个成员头像构成 Group 的稳定视觉身份。 */
export function GroupAvatar({ group, agents, class_name = "size-8", member_class_name = "size-6" }: GroupAvatarProps) {
  const translate_navigation = use_translation("navigation");
  const members = group.members.slice(0, 3).map((member) => agents.find((agent) => agent.agent_id === member.agent_id) ?? { agent_id: member.agent_id, name: "Agent", model_id: "", version: "" });
  if (members.length === 0) return <TbUsers className={cn("shrink-0 rounded-full bg-surface-emphasis p-2 text-muted-foreground", class_name)} />;
  return <span className={cn("relative flex shrink-0", class_name)} aria-label={translate_navigation("sidebar.members", { count: group.members.length })}>{members.map((agent, index) => <AgentAvatar key={agent.agent_id} agent={agent} class_name={cn("absolute rounded-md border-2 border-background", member_class_name, index === 0 && "left-0 top-0", index === 1 && "right-0 top-1", index === 2 && "left-1 bottom-0")} />)}</span>;
}
