/** Notification 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "@downcity/city/power/react";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "list": {
    running: ["正在查看收件箱", "Checking inbox"],
    complete: ["已查看收件箱", "Inbox checked"],
    failed: ["无法查看收件箱", "Could not check inbox"],
    waiting: ["等待你允许查看收件箱", "Waiting for permission to check the inbox"],
  },
  "refresh": {
    running: ["正在刷新收件箱", "Refreshing inbox"],
    complete: ["收件箱已刷新", "Inbox refreshed"],
    failed: ["收件箱刷新失败", "Could not refresh inbox"],
    waiting: ["等待你允许刷新收件箱", "Waiting for permission to refresh the inbox"],
  },
  "view": {
    running: ["正在更新收件箱", "Updating inbox"],
    complete: ["收件箱已更新", "Inbox updated"],
    failed: ["收件箱更新失败", "Could not update inbox"],
    waiting: ["等待你允许更新收件箱", "Waiting for permission to update the inbox"],
  },
  "respond": {
    running: ["正在回应", "Responding"],
    complete: ["已回应", "Response sent"],
    failed: ["回应失败", "Could not respond"],
    waiting: ["等待你允许回应", "Waiting for permission to respond"],
  },
  "read": {
    running: ["正在标记已读", "Marking as read"],
    complete: ["已标记为已读", "Marked as read"],
    failed: ["无法标记已读", "Could not mark as read"],
    waiting: ["等待你允许标记已读", "Waiting for permission to mark as read"],
  },
  "read_updates": {
    running: ["正在标记已读", "Marking as read"],
    complete: ["已标记为已读", "Marked as read"],
    failed: ["无法标记已读", "Could not mark as read"],
    waiting: ["等待你允许标记已读", "Waiting for permission to mark as read"],
  },
  "clear_update": {
    running: ["正在清除通知", "Clearing notification"],
    complete: ["通知已清除", "Notification cleared"],
    failed: ["通知清除失败", "Could not clear notification"],
    waiting: ["等待你允许清除通知", "Waiting for permission to clear the notification"],
  },
  "clear_read_updates": {
    running: ["正在清除已读通知", "Clearing read notifications"],
    complete: ["已读通知已清除", "Read notifications cleared"],
    failed: ["无法清除已读通知", "Could not clear read notifications"],
    waiting: ["等待你允许清除已读通知", "Waiting for permission to clear read notifications"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Available actions checked"],
    failed: ["无法查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在查看通知", "Checking notifications"],
    complete: ["通知处理已结束", "Notification action finished"],
    failed: ["通知处理未能完成", "Could not handle notification"],
    waiting: ["等待你回应", "Waiting for your response"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在查看通知", "Checking notifications"];
