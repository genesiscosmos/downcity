/** Presentation 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "@downcity/city/power/react";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "show": {
    running: ["正在展示内容", "Displaying content"],
    complete: ["已展示内容", "Displayed content"],
    failed: ["未能展示内容", "Could not display content"],
    waiting: ["等待你允许展示内容", "Waiting for permission to display content"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备展示内容", "Preparing content"],
    complete: ["已展示内容", "Displayed content"],
    failed: ["未能展示内容", "Could not display content"],
    waiting: ["等待你确认展示内容", "Waiting for confirmation to display content"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备展示内容", "Preparing content"];
