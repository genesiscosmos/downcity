/**
 * 输入区的联系人切换入口。
 *
 * ## 它换的是「和谁聊」，不是「在哪聊」
 *
 * 草稿的 Workspace 在**进入它的那一刻**就已经定了（侧栏 Workspace 行上的新建按钮长在那个
 * Workspace 上）。换 Agent 保留当前 Workspace（`switch_draft_context` 就是为这件事存在的），
 * 也不改变执行边界；换目录是另一件事，由 `ChatWorkspaceSelector` 负责，两者并排给出。
 *
 * ## 与 `ChatWorkspaceSelector` 的关系
 *
 * 两者语义不同（换联系人 / 换执行边界），因此不合并；但**形状同源**，
 * 都取 `composer_context_chip_class_name`。并排出现的两个控件只要有一处字号、圆角或内边距
 * 不同，一眼就能看出是两套东西。
 */

import { TbCheck, TbChevronDown } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { composer_context_chip_class_name } from "@/features/chat/components/ComposerContextRow";
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
        className={composer_context_chip_class_name}
        disabled={!can_switch}
        title={current?.name || translate_chat("conversation.contact")}
        aria-label={translate_chat("conversation.select_contact")}
      >
        {current ? <AgentAvatar agent={current} class_name="size-3.5" /> : null}
        <span className="min-w-0 flex-1 truncate text-left">{current?.name || translate_chat("conversation.contact")}</span>
        <TbChevronDown />
      </Button>
    </DropdownMenuTrigger>
    {/* 向上弹：这个入口住在输入区上方，向下弹会被输入框压住。 */}
    <DropdownMenuContent align="start" side="top" sideOffset={4}>
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
