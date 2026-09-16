/**
 * 消息视口底部的「回到最新」入口。
 *
 * ## 什么时候出现
 *
 * 只在**最新内容已经滑出视野**时出现，与「有没有新消息」无关。
 *
 * 早先的写法是「一退出自动跟随就伸出入口」，而退出跟随只要向上滑 1px（那是跟随必须的
 * 灵敏度，晚一步就会和用户的滚动抢视口），于是刚离开底部、底部内容还在眼前时按钮就冒出来，
 * 而且新内容一到它就长驻——因为它同时兼任了「有新消息」的提示。展示条件改由距离决定后，
 * 两件事各自都准了（见 chat_scroll 的 `is_chat_latest_visible`）。
 *
 * ## 视觉
 *
 * 一个紧凑的圆角浮标：只有箭头，外加确实有新增消息时才出现的数量。
 *
 * 三处收敛：
 *
 * 1. **不写文案**。原来是一句话的药丸（「回到最新」/「3 条新消息」），宽度随文案跳，
 *    居中压在对话上像一条通知。箭头指向下方的最新内容，语义自明；完整说法留在
 *    `aria-label` 与 `title` 里，读屏与悬停都不丢信息。
 * 2. **尺寸取应用里最小的一档浮层控件**（h-7），与消息操作按钮同量级。它是一张便签，
 *    不是一个按钮组。
 * 3. **表面沿用应用既有的浮层词汇**（`border-border-subtle` + `bg-popover` + `shadow-lg`，
 *    与图表浮层按钮、提示条同款），不自创一种更轻的画法：它要压在滚动的正文之上，
 *    只靠投影在浅色主题里会和文字糊在一起，1px 描边是保证可辨认的最低成本。
 *
 * 唯一强调色留给数量：它是这里唯一会变、也唯一值得被看见的「新」。
 *
 * 位置居中于视口——消息列在视口里也是居中的，两者共享同一条中轴，
 * 因此两侧面板收起/展开都不会让它偏离。
 */

import { TbArrowDown } from "react-icons/tb";
import { use_translation } from "@/locales/i18n";

/** 回到最新入口属性。 */
export function JumpToLatest({ visible, new_message_count, on_click }: {
  /** 是否可见；最新内容仍在视野内与空会话都不展示。 */
  visible: boolean;
  /** 离开底部后新增的消息数；0 表示只提示位置。 */
  new_message_count: number;
  /** 回到最新位置。 */
  on_click(): void;
}) {
  const translate = use_translation("chat");
  if (!visible) return null;
  const has_new = new_message_count > 0;
  const label = has_new ? translate("message.new_messages", { count: new_message_count }) : translate("message.jump_to_latest");
  return <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
    <button
      type="button"
      onClick={on_click}
      title={label}
      aria-label={label}
      className="pointer-events-auto inline-flex h-7 items-center justify-center gap-1 rounded-full border border-border-subtle bg-popover px-2 text-muted-foreground shadow-lg outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <TbArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
      {/* 数量随消息到来变化，tabular-nums 防止逐位跳动。 */}
      {has_new ? <span className="text-2xs font-medium tabular-nums text-primary">{new_message_count}</span> : null}
    </button>
  </div>;
}
