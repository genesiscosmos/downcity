/** Memory 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "@downcity/city/power/react";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "status": {
    running: ["正在检查记忆功能", "Checking memory availability"],
    complete: ["已检查记忆功能", "Checked memory availability"],
    failed: ["未能检查记忆功能", "Could not check memory availability"],
    waiting: ["等待你允许检查记忆功能", "Waiting for permission to check memory availability"],
  },
  "search": {
    running: ["正在回忆", "Searching memories"],
    complete: ["已查找相关记忆", "Searched memories"],
    failed: ["未能回忆", "Could not search memories"],
    waiting: ["等待你允许回忆", "Waiting for permission to search memories"],
  },
  "read": {
    running: ["正在回顾记忆", "Recalling memory"],
    complete: ["已回顾记忆", "Recalled memory"],
    failed: ["未能回顾记忆", "Could not recall memory"],
    waiting: ["等待你允许回顾记忆", "Waiting for permission to recall the memory"],
  },
  "list": {
    running: ["正在查看记忆", "Checking memories"],
    complete: ["已查看记忆", "Checked memories"],
    failed: ["未能查看记忆", "Could not list memories"],
    waiting: ["等待你允许查看记忆", "Waiting for permission to check memories"],
  },
  "remember": {
    running: ["正在记住", "Remembering"],
    complete: ["已安排记忆整理", "Scheduled memory processing"],
    failed: ["未能记住", "Could not remember this"],
    waiting: ["等待你允许记住这些内容", "Waiting for permission to remember this"],
  },
  "digest": {
    running: ["正在整理会话中的记忆", "Organizing memories from the conversation"],
    complete: ["已安排会话记忆整理", "Scheduled conversation memory processing"],
    failed: ["未能整理会话中的记忆", "Could not organize conversation memories"],
    waiting: ["等待你允许整理会话中的记忆", "Waiting for permission to organize conversation memories"],
  },
  "revise": {
    running: ["正在更新记忆", "Updating memory"],
    complete: ["已安排记忆更新", "Scheduled memory update"],
    failed: ["未能更新记忆", "Could not update memory"],
    waiting: ["等待你允许更新记忆", "Waiting for permission to update the memory"],
  },
  "forget": {
    running: ["正在忘记", "Forgetting"],
    complete: ["已忘记", "Forgotten"],
    failed: ["未能忘记", "Could not forget this"],
    waiting: ["等待你允许忘记这些内容", "Waiting for permission to forget this"],
  },
  "optimize": {
    running: ["正在整理长期记忆", "Organizing long-term memories"],
    complete: ["已安排长期记忆整理", "Scheduled long-term memory processing"],
    failed: ["未能整理长期记忆", "Could not organize long-term memories"],
    waiting: ["等待你允许整理长期记忆", "Waiting for permission to organize long-term memories"],
  },
  "jobs": {
    running: ["正在查看记忆整理记录", "Checking memory activity"],
    complete: ["已查看记忆整理记录", "Checked memory activity"],
    failed: ["未能查看记忆整理记录", "Could not read memory activity"],
    waiting: ["等待你允许查看记忆整理记录", "Waiting for permission to check memory activity"],
  },
  "job_status": {
    running: ["正在查看记忆整理进度", "Checking memory progress"],
    complete: ["已查看记忆整理进度", "Checked memory progress"],
    failed: ["未能查看记忆整理进度", "Could not check memory progress"],
    waiting: ["等待你允许查看记忆整理进度", "Waiting for permission to check memory progress"],
  },
  "job_detail": {
    running: ["正在查看记忆变化", "Reviewing memory changes"],
    complete: ["已查看记忆变化", "Reviewed memory changes"],
    failed: ["未能查看记忆变化", "Could not review memory changes"],
    waiting: ["等待你允许查看记忆变化", "Waiting for permission to review memory changes"],
  },
  "retry": {
    running: ["正在重新整理记忆", "Retrying memory processing"],
    complete: ["已重新安排记忆整理", "Rescheduled memory processing"],
    failed: ["未能重新整理记忆", "Could not retry memory processing"],
    waiting: ["等待你允许重新整理记忆", "Waiting for permission to retry memory processing"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备整理记忆", "Preparing to organize memories"],
    complete: ["已查看记忆", "Checked memories"],
    failed: ["未能整理记忆", "Could not organize memories"],
    waiting: ["等待你确认记忆更新", "Waiting for confirmation to update memories"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备整理记忆", "Preparing to organize memories"];

/** 仅同步回执确认已生效时使用结果句，不复用仅表示后台安排完成的动作句。 */
export function memory_completion_sentence(kind: string): readonly [string, string] {
  if (kind === "remember") return ["已记住", "Remembered"];
  if (kind === "digest") return ["已整理会话记忆", "Organized conversation memories"];
  if (kind === "profile_optimize" || kind === "optimize") return ["已整理长期记忆", "Organized long-term memories"];
  return ["已更新记忆", "Updated memory"];
}
