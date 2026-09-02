/** Chat MainView 内统一的 Session 导航项与操作菜单。 */

import type { ReactNode } from "react";
import { TbDots, TbLoader2 } from "react-icons/tb";
import { SessionActionsMenu } from "@/components/session/SessionActionsMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DesktopSessionSummary } from "@common/types/DesktopApi";

/** Session 导航项属性。 */
interface SessionListItemProps {
  /** Session 摘要。 */
  session: DesktopSessionSummary;
  /** 是否选中。 */
  active: boolean;
  /** 当前 Session 是否有未读完成通知。 */
  unread: boolean;
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
export function SessionListRow({ title, active, on_select, leading, menu, reserve_menu_space = true }: SessionListRowProps) {
  return (
    <div
      role={on_select ? "button" : undefined}
      tabIndex={on_select ? 0 : undefined}
      className={cn(
        "group relative flex min-h-7 w-full cursor-pointer items-center gap-1 rounded-lg border border-transparent p-0.5 pl-2 text-left transition-colors duration-150",
        active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]",
      )}
      onClick={on_select}
      onKeyDown={(event) => { if (on_select && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); on_select(); } }}
    >
      {leading ? <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate text-xs leading-4 text-foreground">{title}</span>
      {menu || reserve_menu_space ? <span className="flex size-6 shrink-0 items-center justify-center">{menu}</span> : null}
    </div>
  );
}

/** 带完整 Agent Session 操作能力的标准行。 */
export function SessionListItem({ session, active, unread, on_select, on_rename, on_archive, on_remove }: SessionListItemProps) {
  const has_status = session.executing || unread;
  return <SessionListRow title={session.title || "新对话"} active={active} on_select={on_select} menu={
    <SessionActionsMenu session={session} on_rename={on_rename} on_archive={on_archive} on_remove={on_remove} trigger={
          <Button
            size="icon"
            className={cn("group/menu", has_status ? "opacity-100" : "opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100 data-[state=open]:opacity-100")}
            title="更多操作"
            aria-label="更多操作"
            onClick={(event) => event.stopPropagation()}
          >
            {session.executing
              ? <TbLoader2 className="animate-spin text-primary" aria-label="正在回复。" />
              : unread
                ? <span className="size-1.5 rounded-full bg-blue-500" aria-label="有未读完成结果" />
                : <TbDots />}
          </Button>
    } />
  } />;
}
