/**
 * 输入区的 Workspace 切换入口。
 *
 * ## 它换的是「在哪聊」
 *
 * 切换 Workspace 会把整条草稿迁到另一个目录（`switch_draft_context` /
 * `switch_group_draft_context`），因此它改变的是**执行边界**，与换联系人是两件事。
 * 两者在草稿态并排出现，各回答一个问题。
 *
 * ## 两种形态
 *
 * - `chip`：输入区上下文行里的胶囊按钮，与联系人的入口同形（`composer_context_chip_class_name`）；
 * - `tag`（默认）：标题栏里跟在对话名后面的小标签，尺寸更小、文字更弱。
 *
 * 两者语义与菜单完全一致，差别只有形状——它长在哪一行，就用哪一行的语言。
 */

import { TbCheck, TbChevronDown, TbFolder } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { composer_context_chip_class_name } from "@/features/chat/components/ComposerContextRow";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { use_translation } from "@/locales/i18n";

/** 标题栏标签形态：跟在对话名后面，因此比上下文行更小、更弱。 */
const workspace_tag_class_name = "h-5 min-w-0 max-w-40 gap-1 rounded-full bg-surface-subtle px-2 text-3xs font-normal text-muted-foreground hover:bg-interaction-hover hover:text-foreground";

/** Workspace 选择器属性。 */
interface ChatWorkspaceSelectorProps {
  /** 当前 Workspace 标识。 */
  workspace_id: string;
  /** 可选 Workspace 列表。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前是否禁止切换。 */
  disabled: boolean;
  /** 确认后进入目标 Workspace 的新对话。 */
  switch_workspace(workspace_id: string): Promise<void> | void;
  /** 选择器的视觉规格；默认是标题栏标签。 */
  variant?: "tag" | "chip";
}

/** 选择目标 Workspace，并在改变 Session 执行边界前显式确认。 */
export function ChatWorkspaceSelector(props: ChatWorkspaceSelectorProps) {
  const translate = use_translation("resources");
  const current = props.workspaces.find((workspace) => workspace.workspace_id === props.workspace_id);
  const is_tag = props.variant !== "chip";
  const label = current?.name || "Workspace";
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        className={is_tag ? workspace_tag_class_name : composer_context_chip_class_name}
        disabled={props.disabled || props.workspaces.length < 2}
        title={props.disabled ? translate("workspace_runtime.switch_disabled") : label}
      >
        <TbFolder className={is_tag ? "size-3 shrink-0" : undefined} />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <TbChevronDown className={is_tag ? "size-2.5 shrink-0" : undefined} />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" sideOffset={4}>
      {props.workspaces.map((workspace) => <DropdownMenuItem key={workspace.workspace_id} disabled={workspace.workspace_id === props.workspace_id} onClick={() => void props.switch_workspace(workspace.workspace_id)}>
        <TbFolder className="size-4" />
        <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
        {workspace.workspace_id === props.workspace_id ? <TbCheck className="size-3.5 text-primary" /> : null}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
