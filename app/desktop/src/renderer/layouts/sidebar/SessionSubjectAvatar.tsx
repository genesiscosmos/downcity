/**
 * 会话行的行首：归属头像按钮 + 它的下拉菜单。
 *
 * ## 它取代了行尾的归属文字
 *
 * 会话的归属（哪个 Agent / 哪个 Group）原本写在行右端。那个位置的问题是它一直在跟标题
 * 抢宽度，而标题才是这一行最该读全的东西。改成行首的头像后，归属只占一格、标题拿到整行，
 * 而「这是谁的会话」仍然一眼可辨——头像是身份的天然载体。
 *
 * 代价必须说清：**没有自定义头像的 Agent 默认都是同一个幽灵图标**，因此多个 Agent 的会话
 * 在头像是同一张脸。这一点靠按钮的 `title` / `aria-label`（写明是谁）与悬停提示补上，
 * 而不是靠再写一行文字。
 *
 * ## 头像也是这一行的第二个入口
 *
 * 点行身打开会话，点头像开它自己的菜单：
 *
 * ```text
 * [头像 ▾]  会话标题                                  ⋯
 *            ├ [头像] Agent 名（当前归属，仅作说明）
 *            └ 新建会话
 * ```
 *
 * 「新建会话」落在**同一个 Workspace、同一个 Agent** 上：用户是从这条会话认出头像的，
 * 那么他想要的「再来一条」多半也是同一个组合。
 *
 * 它占的正是树行展开箭头那一格，因此根节点与叶子的文字仍在同一条线上（见 `SidebarTreeProps.leading`）。
 */

import { TbPlus } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";

/** 会话归属头像属性。 */
interface SessionSubjectAvatarProps {
  /** 这条会话是 Agent 会话还是 Group 会话。 */
  kind: "agent" | "group";
  /** Agent 会话的 Agent；已被删除时为空。 */
  agent?: DesktopAgentSummary;
  /** Group 会话的 Group；已被删除时为空。 */
  group?: DesktopGroupSummary;
  /** 全部 Agent；Group 头像用它拼成员。 */
  agents: DesktopAgentSummary[];
  /** 这条会话所属的 Workspace。 */
  workspace_id: string;
  /** 当前归属的可读名称；对象已删除时由调用方给一个兜底。 */
  subject_label: string;
  /** 在当前 Workspace 与这个归属下新建会话。 */
  on_new_session(): void;
}

/**
 * 渲染行首的归属头像与它的菜单。
 *
 * 归属对象已被删除时（`agent` / `group` 都为空）只画一个中性图标：
 * 那时头像没有身份可表达，而菜单里「新建会话」也失去了目标。
 */
export function SessionSubjectAvatar({ kind, agent, group, agents, subject_label, on_new_session }: SessionSubjectAvatarProps) {
  const translate = use_translation("navigation");
  const trigger_label = translate("sidebar.session_subject", { name: subject_label });
  const avatar = kind === "agent"
    ? agent ? <AgentAvatar agent={agent} class_name="size-5" /> : <span className="size-5 rounded-avatar bg-surface-emphasis" />
    : group ? <GroupAvatar group={group} agents={agents} class_name="size-5" member_class_name="size-3" /> : <span className="size-5 rounded-avatar bg-surface-emphasis" />;

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      {/* 一个 `size-6` 的按钮，与展开箭头同格：树行的行首列只放一样东西。 */}
      <Button
        size="icon"
        title={trigger_label}
        aria-label={trigger_label}
        // 菜单展开时保持可见：那一刻它是指示器，不该随鼠标离开而消失。
        className="data-[popup-open]:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >{avatar}</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={4} onClick={(event) => event.stopPropagation()}>
      {/* `DropdownMenuLabel` 就是 Base UI 的 `Menu.GroupLabel`，**必须**住在 `Menu.Group` 里：
          不包就会在打开菜单时直接抛 `MenuGroupContext is missing`（类型检查抓不到）。
          这个菜单本来也就是一个对象菜单：归属是这一组的标题，新建会话是组内动作。 */}
      <DropdownMenuGroup>
        {/* 第一项是**说明**，不是可执行项：它回答「这是谁的会话」，而那个问题已经由头像
            回答了，这里再给一遍头像与名字只是为了确认。因此它是 Label 而不是 MenuItem——
            做成可点项会让用户以为点它能做什么。

            保留 Label 还有一个必要原因：菜单项的 `[&>svg]:size-3.5` 是**直接子元素**选择器，
            权重高于 `AgentAvatar` 自己的 `size-5`，会把头像压成 14px。
            Label 不带这个规则，头像因此能保持与行内同一尺寸。 */}
        <DropdownMenuLabel className="flex items-center gap-2.5 py-1.5">
          {avatar}
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-foreground">{subject_label}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={!agent && !group} onClick={on_new_session}>
          <TbPlus /><span>{translate("sidebar.new_session_here")}</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
