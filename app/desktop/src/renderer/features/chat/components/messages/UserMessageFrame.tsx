/**
 * 用户消息行的唯一骨架：右侧气泡 + 下方一行元信息。
 *
 * ## 谁在用
 *
 * - Agent Session Chat 的正式用户消息与本机编辑态（`UserMessage`）；
 * - Group 共享消息里的用户发言（`GroupView`）。
 *
 * 两处原本各写一遍，结果是元信息行的高度与间距不同（`h-6 gap-1` 与 `gap-1.5 px-1`）、
 * 气泡的宽度约束写法不同（`w-full` 栈 + `w-fit` 气泡 与 `w-fit` 栈）。
 * 用户消息的气泡、右对齐、元信息行位置应当只有一种，因此统一到这里。
 *
 * ## 两个表面真正的差异用 props 表达
 *
 * - `meta`：Session 是「时间 + 编辑/分支操作」，Group 是「已读 + 时间」；
 * - `editing`：Session 支持就地重写，编辑态要改用无气泡容器并放宽最大宽度。
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { user_message_bubble_class_name, user_message_editor_class_name, user_message_meta_class_name, user_message_root_class_name, user_message_stack_class_name, user_message_stack_expanded_class_name, user_message_stack_max_class_name } from "@/features/chat/components/messages/message_layout";

/** 用户消息骨架属性。 */
export interface UserMessageFrameProps {
  /** 气泡内容（正文，或就地编辑器）。 */
  children: ReactNode;
  /** 气泡下方的元信息行（时间、操作、已读标记）；不传则不渲染。 */
  meta?: ReactNode;
  /**
   * 是否处于就地编辑态。
   *
   * 编辑态去掉气泡外观（编辑器自带边框与背景），并把最大宽度放宽到 42rem——
   * 编辑长消息时 80% 的宽度不够用。
   */
  editing?: boolean;
}

/** 组装一条用户消息：右对齐气泡 + 元信息行。 */
export function UserMessageFrame({ children, meta, editing = false }: UserMessageFrameProps) {
  return <article className={user_message_root_class_name}>
    <div className="flex w-full justify-end">
      <div className={cn(user_message_stack_class_name, editing ? user_message_stack_expanded_class_name : user_message_stack_max_class_name)}>
        <div className={editing ? user_message_editor_class_name : user_message_bubble_class_name}>{children}</div>
        {meta ? <div className={user_message_meta_class_name}>{meta}</div> : null}
      </div>
    </div>
  </article>;
}
