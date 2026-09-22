/**
 * 空白对话页的 Agent 切换入口。
 *
 * ## 它换的是「和谁聊」，不是「在哪聊」
 *
 * 空白页的 Workspace 在**进入它的那一刻**就已经定了（侧栏 Workspace 行上的新建按钮长在那个
 * Workspace 上），因此这里只剩 Agent 这一件事可换。再给一个 Workspace 选择器等于把用户刚选定的
 * 目录重新问一遍，而且换 Workspace 会让他离开那个目录——那正是他按下新建时明确选中的东西。
 *
 * ## 与 `ChatWorkspaceSelector` 的关系
 *
 * 两者形状同源（`field` 那一档），但数据源与语义不同，因此不合并：那个换执行边界，
 * 这个换联系人。Group 草稿页仍然需要换 Workspace（群聊可以从任意目录开始），
 * 所以那个组件保留。
 */

import { TbCheck, TbChevronDown } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";

/** Agent 选择器属性。 */
interface ChatAgentSelectorProps {
  /** 当前选中的 Agent 标识。 */
  agent_id: string;
  /** 可选 Agent 列表；顺序由目录决定（默认 Agent 在前）。 */
  agents: DesktopAgentSummary[];
  /** 当前是否禁止切换。 */
  disabled: boolean;
  /** 确认后换一个联系人；Workspace 保持不变。 */
  switch_agent(agent_id: string): void;
}

/** 选择联系人，并保持当前 Workspace 不变。 */
export function ChatAgentSelector({ agent_id, agents, disabled, switch_agent }: ChatAgentSelectorProps) {
  const translate_chat = use_translation("chat");
  const current = agents.find((agent) => agent.agent_id === agent_id);
  // 只有一个 Agent 时不给入口：那时它没有可选项，一个点开只有一条「当前」的菜单只会让人白点一次。
  const can_switch = !disabled && agents.length > 1;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        className="h-9 min-w-52 max-w-72 justify-start gap-2 rounded-control border border-border-subtle bg-background px-3 text-xs font-normal text-foreground shadow-none hover:bg-interaction-hover"
        disabled={!can_switch}
        title={current?.name || translate_chat("conversation.contact")}
        aria-label={translate_chat("conversation.select_contact")}
      >
        {current ? <AgentAvatar agent={current} class_name="size-5" /> : null}
        <span className="min-w-0 flex-1 truncate text-left">{current?.name || translate_chat("conversation.contact")}</span>
        <TbChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    {/* 向上弹：这个入口住在正文底部，向下弹会被输入区压住。 */}
    <DropdownMenuContent align="center" side="top" sideOffset={4}>
      {agents.map((agent) => <DropdownMenuItem
        key={agent.agent_id}
        disabled={agent.agent_id === agent_id}
        onClick={() => switch_agent(agent.agent_id)}
      >
        <AgentAvatar agent={agent} class_name="size-5" />
        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
        {agent.agent_id === agent_id ? <TbCheck className="size-3.5 text-primary" /> : null}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
