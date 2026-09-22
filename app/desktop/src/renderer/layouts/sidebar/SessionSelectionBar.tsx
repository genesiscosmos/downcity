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
 * ## 归档与删除都作用于全部选中项
 *
 * 两类会话（Agent 会话与群聊）都能归档，因此这里没有「含群聊就禁用」或
 * 「跳过一部分」的逻辑。曾短暂存在过这两种处理——那是群聊归档实现前的补丁，
 * 能力补上后它们就该消失。
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
  /** 是否正在执行批量操作。 */
  pending: boolean;
  /** 退出多选模式。 */
  on_exit(): void;
  /** 批量归档选中的会话。 */
  on_archive(): void;
  /** 批量删除选中的会话。 */
  on_remove(): void;
}

/** 渲染「已选 N 项 + 批量操作」的工具条。 */
export function SessionSelectionBar({ selected_count, pending, on_exit, on_archive, on_remove }: SessionSelectionBarProps) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  const exit_label = translate("sidebar.exit_selection");
  const archive_label = translate("sidebar.archive_selected");
  return <div className={cn("flex h-9 shrink-0 items-center gap-1", sidebar_heading_class_name)}>
    {/* 退出在最左：多选是临时状态，结束它的手势要最好找。 */}
    <Button size="icon" title={exit_label} aria-label={exit_label} onClick={on_exit}><TbX /></Button>
    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{translate("sidebar.selected_count", { count: selected_count })}</span>
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="icon"
        disabled={pending || selected_count === 0}
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
