/** Task 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "@downcity/city/power/react";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "create": {
    running: ["正在创建任务", "Creating task"],
    complete: ["已创建任务", "Created task"],
    failed: ["未能创建任务", "Could not create task"],
    waiting: ["等待你允许创建任务", "Waiting for permission to create the task"],
  },
  "generate": {
    running: ["正在准备任务", "Preparing task"],
    complete: ["已准备任务", "Prepared task"],
    failed: ["未能准备任务", "Could not prepare task"],
    waiting: ["等待你允许准备任务", "Waiting for permission to prepare the task"],
  },
  "update": {
    running: ["正在更新任务", "Updating task"],
    complete: ["已更新任务", "Updated task"],
    failed: ["未能更新任务", "Could not update task"],
    waiting: ["等待你允许更新任务", "Waiting for permission to update the task"],
  },
  "list": {
    running: ["正在查看任务", "Checking tasks"],
    complete: ["已查看任务", "Checked tasks"],
    failed: ["未能查看任务", "Could not list tasks"],
    waiting: ["等待你允许查看任务", "Waiting for permission to check tasks"],
  },
  "delete": {
    running: ["正在删除任务", "Deleting task"],
    complete: ["已删除任务", "Deleted task"],
    failed: ["未能删除任务", "Could not delete task"],
    waiting: ["等待你允许删除任务", "Waiting for permission to delete the task"],
  },
  "status": {
    running: ["正在调整任务安排", "Updating task schedule"],
    complete: ["已更新任务安排", "Updated task schedule"],
    failed: ["未能调整任务安排", "Could not update task schedule"],
    waiting: ["等待你允许调整任务安排", "Waiting for permission to update the task schedule"],
  },
  "enable": {
    running: ["正在启用任务安排", "Enabling task schedule"],
    complete: ["已启用任务安排", "Enabled task schedule"],
    failed: ["未能启用任务安排", "Could not enable task schedule"],
    waiting: ["等待你允许启用任务安排", "Waiting for permission to enable the task schedule"],
  },
  "disable": {
    running: ["正在停用任务安排", "Disabling task schedule"],
    complete: ["已停用任务安排", "Disabled task schedule"],
    failed: ["未能停用任务安排", "Could not disable task schedule"],
    waiting: ["等待你允许停用任务安排", "Waiting for permission to disable the task schedule"],
  },
  "reload": {
    running: ["正在刷新任务安排", "Refreshing task schedules"],
    complete: ["已刷新任务安排", "Refreshed task schedules"],
    failed: ["未能刷新任务安排", "Could not refresh task schedules"],
    waiting: ["等待你允许刷新任务安排", "Waiting for permission to refresh task schedules"],
  },
  "run": {
    running: ["正在开始任务", "Starting task"],
    complete: ["已安排任务执行", "Scheduled task execution"],
    failed: ["未能开始任务", "Could not start task"],
    waiting: ["等待你允许开始任务", "Waiting for permission to start the task"],
  },
  "history": {
    running: ["正在查看任务执行记录", "Checking task runs"],
    complete: ["已查看任务执行记录", "Checked task runs"],
    failed: ["未能查看任务执行记录", "Could not read task runs"],
    waiting: ["等待你允许查看任务执行记录", "Waiting for permission to check task runs"],
  },
  "run_detail": {
    running: ["正在查看任务结果", "Reading task result"],
    complete: ["已查看任务结果", "Read task result"],
    failed: ["未能查看任务结果", "Could not read task result"],
    waiting: ["等待你允许查看任务结果", "Waiting for permission to read the task result"],
  },
  "inbox": {
    running: ["正在查看待处理事项", "Checking task items"],
    complete: ["已查看待处理事项", "Checked task items"],
    failed: ["未能查看待处理事项", "Could not read task items"],
    waiting: ["等待你允许查看待处理事项", "Waiting for permission to check task items"],
  },
  "organize": {
    running: ["正在整理任务", "Organizing task"],
    complete: ["已整理任务", "Organized task"],
    failed: ["未能整理任务", "Could not organize task"],
    waiting: ["等待你允许整理任务", "Waiting for permission to organize the task"],
  },
  "start": {
    running: ["正在标记任务为进行中", "Marking task in progress"],
    complete: ["已标记任务为进行中", "Marked task in progress"],
    failed: ["未能标记任务为进行中", "Could not update task progress"],
    waiting: ["等待你允许标记任务为进行中", "Waiting for permission to mark the task in progress"],
  },
  "complete": {
    running: ["正在标记任务完成", "Marking task complete"],
    complete: ["已标记任务完成", "Marked task complete"],
    failed: ["未能标记任务完成", "Could not mark task complete"],
    waiting: ["等待你允许标记任务完成", "Waiting for permission to mark the task complete"],
  },
  "cancel": {
    running: ["正在取消任务", "Cancelling task"],
    complete: ["已取消任务", "Cancelled task"],
    failed: ["未能取消任务", "Could not cancel task"],
    waiting: ["等待你允许取消任务", "Waiting for permission to cancel the task"],
  },
  "reopen": {
    running: ["正在重新打开任务", "Reopening task"],
    complete: ["已重新打开任务", "Reopened task"],
    failed: ["未能重新打开任务", "Could not reopen task"],
    waiting: ["等待你允许重新打开任务", "Waiting for permission to reopen the task"],
  },
  "pause": {
    running: ["正在暂停任务安排", "Pausing task schedule"],
    complete: ["已暂停任务安排", "Paused task schedule"],
    failed: ["未能暂停任务安排", "Could not pause task schedule"],
    waiting: ["等待你允许暂停任务安排", "Waiting for permission to pause the task schedule"],
  },
  "resume": {
    running: ["正在恢复任务安排", "Resuming task schedule"],
    complete: ["已恢复任务安排", "Resumed task schedule"],
    failed: ["未能恢复任务安排", "Could not resume task schedule"],
    waiting: ["等待你允许恢复任务安排", "Waiting for permission to resume the task schedule"],
  },
  "resolve": {
    running: ["正在处理事项", "Resolving item"],
    complete: ["已处理事项", "Resolved item"],
    failed: ["未能处理事项", "Could not resolve item"],
    waiting: ["等待你允许处理事项", "Waiting for permission to resolve the item"],
  },
  "accept": {
    running: ["正在验收任务结果", "Accepting task result"],
    complete: ["已验收任务结果", "Accepted task result"],
    failed: ["未能验收任务结果", "Could not accept task result"],
    waiting: ["等待你允许验收任务结果", "Waiting for permission to accept the task result"],
  },
  "revise": {
    running: ["正在退回任务结果", "Returning task result"],
    complete: ["已退回任务结果", "Returned task result for revision"],
    failed: ["未能退回任务结果", "Could not return task result"],
    waiting: ["等待你允许退回任务结果", "Waiting for permission to return the task result"],
  },
  "skip": {
    running: ["正在跳过本次执行", "Skipping this run"],
    complete: ["已跳过本次执行", "Skipped run"],
    failed: ["未能跳过本次执行", "Could not skip run"],
    waiting: ["等待你允许跳过本次执行", "Waiting for permission to skip this run"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备任务", "Preparing task"],
    complete: ["已处理任务", "Handled task"],
    failed: ["未能完成任务", "Could not complete task"],
    waiting: ["等待你确认任务安排", "Waiting for confirmation of the task schedule"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备任务", "Preparing task"];
