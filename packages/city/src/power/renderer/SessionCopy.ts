/** Session 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "start": {
    running: ["正在创建工作会话", "Creating work session"],
    complete: ["工作会话已创建", "Work session created"],
    failed: ["工作会话创建失败", "Could not create work session"],
    waiting: ["等待你允许创建工作会话", "Waiting for permission to create the work session"],
  },
  "input": {
    running: ["正在补充工作会话内容", "Updating work session"],
    complete: ["工作会话内容已补充", "Work session updated"],
    failed: ["工作会话内容未能补充", "Could not update work session"],
    waiting: ["等待你允许补充工作会话内容", "Waiting for permission to update the work session"],
  },
  "check": {
    running: ["正在查看会话", "Checking session"],
    complete: ["已查看会话", "Session checked"],
    failed: ["无法查看会话", "Could not check session"],
    waiting: ["等待你允许查看会话", "Waiting for permission to check sessions"],
  },
  "messages": {
    running: ["正在查看会话记录", "Reading conversation history"],
    complete: ["已查看会话记录", "Conversation history read"],
    failed: ["无法查看会话记录", "Could not read conversation history"],
    waiting: ["等待你允许查看会话记录", "Waiting for permission to read conversation history"],
  },
  "part": {
    running: ["正在查看消息内容", "Reading message content"],
    complete: ["已查看消息内容", "Message content read"],
    failed: ["无法查看消息内容", "Could not read message content"],
    waiting: ["等待你允许查看消息内容", "Waiting for permission to read message content"],
  },
  "check.work": {
    running: ["正在查看工作会话", "Checking work session"],
    complete: ["已查看工作会话", "Work session checked"],
    failed: ["无法查看工作会话", "Could not check work session"],
    waiting: ["等待你允许查看工作会话", "Waiting for permission to check the work session"],
  },
  "check.chat": {
    running: ["正在查看聊天会话", "Checking chat session"],
    complete: ["已查看聊天会话", "Chat session checked"],
    failed: ["无法查看聊天会话", "Could not check chat session"],
    waiting: ["等待你允许查看聊天会话", "Waiting for permission to check the chat session"],
  },
  "messages.work": {
    running: ["正在查看工作会话记录", "Reading work session history"],
    complete: ["已查看工作会话记录", "Work session history read"],
    failed: ["无法查看工作会话记录", "Could not read work session history"],
    waiting: ["等待你允许查看工作会话记录", "Waiting for permission to read work session history"],
  },
  "messages.chat": {
    running: ["正在查看聊天会话记录", "Reading chat session history"],
    complete: ["已查看聊天会话记录", "Chat session history read"],
    failed: ["无法查看聊天会话记录", "Could not read chat session history"],
    waiting: ["等待你允许查看聊天会话记录", "Waiting for permission to read chat session history"],
  },
  "part.work": {
    running: ["正在查看工作会话消息", "Reading work session message"],
    complete: ["已查看工作会话消息", "Work session message read"],
    failed: ["无法查看工作会话消息", "Could not read work session message"],
    waiting: ["等待你允许查看工作会话消息", "Waiting for permission to read the work session message"],
  },
  "part.chat": {
    running: ["正在查看聊天会话消息", "Reading chat session message"],
    complete: ["已查看聊天会话消息", "Chat session message read"],
    failed: ["无法查看聊天会话消息", "Could not read chat session message"],
    waiting: ["等待你允许查看聊天会话消息", "Waiting for permission to read the chat session message"],
  },
  "reply": {
    running: ["正在回答工作会话中的问题", "Answering work session question"],
    complete: ["回答已发送", "Answer sent"],
    failed: ["回答发送失败", "Could not send answer"],
    waiting: ["等待你允许回答工作会话中的问题", "Waiting for permission to answer the work session question"],
  },
  "stop": {
    running: ["正在停止工作会话", "Stopping work session"],
    complete: ["工作会话已停止", "Work session stopped"],
    failed: ["工作会话停止失败", "Could not stop work session"],
    waiting: ["等待你允许停止工作会话", "Waiting for permission to stop the work session"],
  },
  "archive": {
    running: ["正在归档工作会话", "Archiving work session"],
    complete: ["工作会话已归档", "Work session archived"],
    failed: ["工作会话归档失败", "Could not archive work session"],
    waiting: ["等待你允许归档工作会话", "Waiting for permission to archive the work session"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Available actions checked"],
    failed: ["无法查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备会话", "Preparing session"],
    complete: ["会话处理已结束", "Session action finished"],
    failed: ["会话未能继续", "Could not continue session"],
    waiting: ["等待你确认会话", "Waiting for confirmation about the session"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备会话", "Preparing session"];
