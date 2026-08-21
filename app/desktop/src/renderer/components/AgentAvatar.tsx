/** Desktop Agent 头像组件，统一处理自定义头像与默认图标回退。 */

import { TbGhost3 } from "react-icons/tb";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";
import { cn } from "@/lib/utils";

/** Agent 头像展示属性。 */
interface AgentAvatarProps {
  /** 当前 Agent 摘要。 */
  agent: Pick<DesktopAgentSummary, "agent_id" | "avatar_url">;
  /** 头像容器样式。 */
  class_name?: string;
  /** 图标样式。 */
  icon_class_name?: string;
}

/** 展示 Agent 自定义头像；未配置时使用默认 Ghost 图标。 */
export function AgentAvatar({ agent, class_name, icon_class_name }: AgentAvatarProps) {
  return agent.avatar_url
    ? <img src={agent.avatar_url} alt={`${agent.agent_id} avatar`} className={cn("size-4 shrink-0 rounded-md object-cover", class_name)} />
    : <TbGhost3 className={cn("size-4 shrink-0 text-muted-foreground", class_name, icon_class_name)} aria-hidden="true" />;
}
