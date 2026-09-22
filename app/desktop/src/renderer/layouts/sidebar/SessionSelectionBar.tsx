/**
 * 多选模式下替换面板标题的选择工具条。
 *
 * ## 为什么占用 header 而不是浮在列表上
 *
 * 它与标题回答的是同一件事——「这一列现在是什么状态」：平时是「Works」，多选时是
 * 「已选 N 项」。占据同一个位置，用户的眼神不用换地方；而浮在列表上的操作条会盖住
 * 恰好是他正在挑的那些行。
 *
 * ## 为什么退出按钮在最左
 *
 * 多选是一次临时状态，退出的手势要最好找。它与工具条的其余动作分居两端：左边是「结束」，
 * 右边是「对选中的东西做什么」——这两件事不该混在一组里。
 *
 * ## 归档的禁用是一条真实的边界，不是防御
 *
 * 归档只存在于 Agent Session，Group 群聊没有这个语义（见 `GroupSessionActionsMenu`）。
 * 选择里含 Group 会话时它必须禁用并说明原因，而不是静默跳过——静默跳过等于告诉用户
 * 「归档了」但实际没动，那比按钮不可用糟糕得多。
 */

import { TbArchive, TbTrash, TbX } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_translation } from "@/locales/i18n";
import { sidebar_heading_class_name } from "./sidebarRow";
import { cn } from "@/lib/utils";

/** 选择工具条属性。 */
interface SessionSelectionBarProps {
  /** 已选条数。 */
  selected_count: number;
  /** 选择里是否包含 Group 群聊；含则不能批量归档。 */
  has_group_sessions: boolean;
  /** 是否正在执行批量操作。 */
  pending: boolean;
  /** 退出多选模式。 */
  on_exit(): void;
  /** 批量归档选中的 Agent 会话。 */
  on_archive(): void;
  /** 批量删除选中的会话。 */
  on_remove(): void;
}

/** 渲染「已选 N 项 + 批量操作」的工具条。 */
export function SessionSelectionBar({ selected_count, has_group_sessions, pending, on_exit, on_archive, on_remove }: SessionSelectionBarProps) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  const exit_label = translate("sidebar.exit_selection");
  const archive_label = has_group_sessions ? translate("sidebar.archive_group_unsupported") : translate("sidebar.archive_selected");
  return <div className={cn("flex h-9 shrink-0 items-center gap-1", sidebar_heading_class_name)}>
    {/* 退出在最左：多选是临时状态，结束它的手势要最好找。 */}
    <Button size="icon" title={exit_label} aria-label={exit_label} onClick={on_exit}><TbX /></Button>
    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{translate("sidebar.selected_count", { count: selected_count })}</span>
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="icon"
        // 含 Group 群聊时禁用并说明：归档对群聊没有语义（见文件头）。
        disabled={pending || has_group_sessions || selected_count === 0}
        title={archive_label}
        aria-label={archive_label}
        onClick={on_archive}
      ><TbArchive /></Button>
      <Button
        size="icon"
        disabled={pending || selected_count === 0}
        title={translate_common("actions.delete")}
        aria-label={translate_common("actions.delete")}
        onClick={on_remove}
      ><TbTrash /></Button>
    </div>
  </div>;
}
