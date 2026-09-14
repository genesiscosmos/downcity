/** Chat MainView 内统一的 Session 导航项与操作菜单。 */

import { memo, type ReactNode } from "react";
import { SessionActionsMenu } from "@/features/chat/components/SessionActionsMenu";
import { RowMenuButton } from "@/components/RowMenuButton";
import { cn } from "@/lib/utils";
import type { DesktopSessionSummary } from "@common/types/DesktopApi";
import { type ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { use_translation } from "@/locales/i18n";

/** Session 导航项属性。 */
interface SessionListItemProps {
  /** Session 摘要。 */
  session: DesktopSessionSummary;
  /** 当前 Session 的行状态。 */
  status: ChatRowStatus;
  /** 是否选中。 */
  active: boolean;
  /** 进入 Session。 */
  on_select(): void;
  /** 修改标题。 */
  on_rename(title: string): Promise<void>;
  /** 归档 Session。 */
  on_archive(): Promise<void>;
  /** 永久删除 Session。 */
  on_remove(): Promise<void>;
}

/** 所有 Agent、Draft 与 Group Session 共用的行属性。 */
interface SessionListRowProps {
  /** 行内展示的 Session 标题。 */
  title: string;
  /** 是否为当前选中的 Session。 */
  active: boolean;
  /** 选中当前 Session。 */
  on_select?: () => void;
  /** 标题前的语义图标。 */
  leading?: ReactNode;
  /** 右侧操作菜单；未提供时仍保留标准按钮宽度。 */
  menu?: ReactNode;
  /** 没有菜单时是否保留右侧标准宽度。 */
  reserve_menu_space?: boolean;
}

/** 统一 Session 行的尺寸、状态、键盘交互与右侧操作区域。 */
export const SessionListRow = memo(function SessionListRow({ title, active, on_select, leading, menu, reserve_menu_space = true }: SessionListRowProps) {
  return (
    <div
      role={on_select ? "button" : undefined}
      tabIndex={on_select ? 0 : undefined}
      className={cn(
        "group/item relative flex min-h-7 w-full cursor-pointer items-center gap-1 rounded-lg border border-transparent p-0.5 pl-2 text-left transition-colors duration-150",
        active ? "bg-interaction-selected hover:bg-interaction-active" : "hover:bg-interaction-hover focus-visible:bg-interaction-hover",
      )}
      onClick={on_select}
      onKeyDown={(event) => { if (on_select && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); on_select(); } }}
    >
      {leading ? <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate text-xs leading-4 text-foreground">{title}</span>
      {menu || reserve_menu_space ? <span className="flex size-6 shrink-0 items-center justify-center">{menu}</span> : null}
    </div>
  );
});

/** 带完整 Agent Session 操作能力的标准行。 */
export const SessionListItem = memo(function SessionListItem({ session, status, active, on_select, on_rename, on_archive, on_remove }: SessionListItemProps) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  return <SessionListRow title={session.title || translate_chat("conversation.new")} active={active} on_select={on_select} menu={
    <SessionActionsMenu session={session} on_rename={on_rename} on_archive={on_archive} on_remove={on_remove} trigger={
      <RowMenuButton status={status} label={translate_common("actions.more")} />
    } />
  } />;
});
