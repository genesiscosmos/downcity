/** Duobox 风格 Session 导航项与操作菜单。 */

import { TbDots, TbLoader2 } from "react-icons/tb";
import { SessionActionsMenu } from "@/components/session/SessionActionsMenu";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";
import type { DesktopAgentSummary, DesktopSessionSummary } from "@common/types/DesktopApi";

/** Session 导航项属性。 */
interface SessionListItemProps {
  /** Session 摘要。 */
  session: DesktopSessionSummary;
  /** Session 使用的 Agent 摘要。 */
  agent: DesktopAgentSummary;
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

/** 与 Duobox ThreadListItem 一致的行布局。 */
export function SessionListItem({ session, agent, active, on_select, on_rename, on_archive, on_remove }: SessionListItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex min-h-7 w-full cursor-pointer items-center gap-1 rounded-lg border border-transparent p-0.5 pl-1 text-left transition-all duration-200 ease-out",
        active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]",
      )}
      onClick={on_select}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); on_select(); } }}
    >
      <AgentAvatar agent={agent} class_name="size-5 rounded-md" />
      <div className="flex min-w-0 flex-1 items-center">
        <span className="min-w-0 truncate text-xs leading-4 text-foreground">{session.title || "新对话"}</span>
      </div>
      <SessionActionsMenu session={session} on_rename={on_rename} on_archive={on_archive} on_remove={on_remove} trigger={
          <Button
            size="icon"
            className={cn("group/menu", session.executing ? "opacity-100" : "opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100 data-[state=open]:opacity-100")}
            title="更多操作"
            aria-label="更多操作"
            onClick={(event) => event.stopPropagation()}
          >
            {session.executing ? <TbLoader2 className="animate-spin text-primary" /> : <TbDots />}
          </Button>
      } />
    </div>
  );
}
