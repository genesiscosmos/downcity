/**
 * 消息视口底部的「回到最新」入口。
 *
 * 自动跟随在被用户上滑打断后会静默停止，没有任何反馈：长回答流式输出时，
 * 用户以为 Agent 卡住了。这里在退出跟随时浮出入口，并只在确实有新增消息时显示数量——
 * 用户只是上滑回看而没有新内容时，报「0 条新消息」比不报更让人困惑。
 */

import { TbArrowDown } from "react-icons/tb";
import { use_translation } from "@/locales/i18n";
import { cn } from "@/lib/utils";

/** 回到最新入口属性。 */
export function JumpToLatest({ visible, new_message_count, on_click }: {
  /** 是否可见；跟随中与空会话都不展示。 */
  visible: boolean;
  /** 离开底部后新增的消息数；0 表示只提示位置。 */
  new_message_count: number;
  /** 回到最新位置。 */
  on_click(): void;
}) {
  const translate = use_translation("chat");
  if (!visible) return null;
  const label = new_message_count > 0
    ? translate("message.new_messages", { count: new_message_count })
    : translate("message.jump_to_latest");
  return <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
    <button
      type="button"
      onClick={on_click}
      // 数量会让按钮宽度变化，tabular-nums 避免跳动；pill 形状与消息操作保持同一套圆角语言。
      className={cn(
        "pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-border-subtle bg-background px-3 text-[0.6875rem] font-medium text-foreground shadow-lg",
        "transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30 outline-none",
      )}
    >
      <TbArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="tabular-nums">{label}</span>
    </button>
  </div>;
}
