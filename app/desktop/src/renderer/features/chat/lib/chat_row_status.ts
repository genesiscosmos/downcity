/**
 * Chat 行状态：一行对用户可见的唯一结论，以及它决定的展示规则。
 *
 * 本模块可以被直接单测，因此只允许 type-only 别名导入；对词表数据的运行时引用必须使用相对路径。
 */

import { attention_visual, type ChatAttention } from "../../../lib/notification/attention.ts";
import type { ChatLiveStatus } from "@/types/DesktopView";

/** 一行的完整状态取值。 */
export type ChatRowStatus = "idle" | ChatLiveStatus | ChatAttention;

/** 需要向用户表达的状态；idle 没有可读名称。 */
export type ChatRowAttentionStatus = Exclude<ChatRowStatus, "idle">;

/** 正在推进的文案 key；它是唯一不属于注意力词表的行状态。 */
export const chat_working_label_key = "conversation.responding";

/**
 * 解析一行状态。
 *
 * 两个输入共用同一套取值，因此优先级就是「实时优先于未读」：Runtime 描述此刻正在发生的事，
 * 未读只是过去的结果。取值本身的含义已经决定了顺序，不需要额外的排序表。
 */
export function resolve_chat_row_status(live: ChatLiveStatus | null, unread: ChatAttention | null): ChatRowStatus {
  return live ?? unread ?? "idle";
}

/** 非 idle 状态必须脱离 hover 常显，否则「需要处理」会被藏起来。 */
export function is_chat_row_status_visible(status: ChatRowStatus): boolean {
  return status !== "idle";
}

/** 状态的可读文案 key；这是状态到文案的唯一映射。 */
export function chat_row_status_label_key(status: ChatRowAttentionStatus): string {
  return status === "working" ? chat_working_label_key : attention_visual[status].label_key;
}

/**
 * 状态在行描述位要使用的文案 key；不占用描述位时返回 null。
 *
 * 只有解释「此刻为什么是这样」的状态才值得替换数据描述：正在推进与等待用户行动属于这一类；
 * 失败与完成是已经落地的结果，只改变图标，描述继续说明这个对象本身。
 */
export function chat_row_status_description_key(status: ChatRowStatus): string | null {
  return status === "working" || status === "action_required" ? chat_row_status_label_key(status) : null;
}

/**
 * 行内操作入口的显隐类名。
 *
 * 规则：需要用户注意的状态常显；其余状态随行 hover、键盘聚焦、菜单展开显隐。键盘聚焦与展开态
 * 都不能省——省掉前者等于键盘用户看不到入口，用错后者等于菜单展开时图标消失。展开态必须用
 * Base UI 的 `data-popup-open`；它不存在 `data-state`。
 */
export function chat_row_trigger_class_name(status: ChatRowStatus): string {
  return is_chat_row_status_visible(status)
    ? "opacity-100"
    : "opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100";
}
