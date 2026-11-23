/** Session 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "start": {
    running: ["正在创建工作会话", "Creating work session"],
    complete: ["已创建工作会话", "Created work session"],
    failed: ["未能创建工作会话", "Could not create work session"],
    waiting: ["等待你允许创建工作会话", "Waiting for permission to create the work session"],
  },
  "input": {
    running: ["正在补充工作会话内容", "Updating work session"],
    complete: ["已补充工作会话内容", "Updated work session"],
    failed: ["未能补充工作会话内容", "Could not update work session"],
    waiting: ["等待你允许补充工作会话内容", "Waiting for permission to update the work session"],
  },
  "check": {
    running: ["正在查看会话", "Checking session"],
    complete: ["已查看会话", "Checked session"],
    failed: ["未能查看会话", "Could not check session"],
    waiting: ["等待你允许查看会话", "Waiting for permission to check sessions"],
  },
  "messages": {
    running: ["正在查看会话记录", "Reading conversation history"],
    complete: ["已查看会话记录", "Read conversation history"],
    failed: ["未能查看会话记录", "Could not read conversation history"],
    waiting: ["等待你允许查看会话记录", "Waiting for permission to read conversation history"],
  },
  "part": {
    running: ["正在查看消息内容", "Reading message content"],
    complete: ["已查看消息内容", "Read message content"],
    failed: ["未能查看消息内容", "Could not read message content"],
    waiting: ["等待你允许查看消息内容", "Waiting for permission to read message content"],
  },
  "check.work": {
    running: ["正在查看工作会话", "Checking work session"],
    complete: ["已查看工作会话", "Checked work session"],
    failed: ["未能查看工作会话", "Could not check work session"],
    waiting: ["等待你允许查看工作会话", "Waiting for permission to check the work session"],
  },
  "check.chat": {
    running: ["正在查看聊天会话", "Checking chat session"],
    complete: ["已查看聊天会话", "Checked chat session"],
    failed: ["未能查看聊天会话", "Could not check chat session"],
    waiting: ["等待你允许查看聊天会话", "Waiting for permission to check the chat session"],
  },
  "messages.work": {
    running: ["正在查看工作会话记录", "Reading work session history"],
    complete: ["已查看工作会话记录", "Read work session history"],
    failed: ["未能查看工作会话记录", "Could not read work session history"],
    waiting: ["等待你允许查看工作会话记录", "Waiting for permission to read work session history"],
  },
  "messages.chat": {
    running: ["正在查看聊天会话记录", "Reading chat session history"],
    complete: ["已查看聊天会话记录", "Read chat session history"],
    failed: ["未能查看聊天会话记录", "Could not read chat session history"],
    waiting: ["等待你允许查看聊天会话记录", "Waiting for permission to read chat session history"],
  },
  "part.work": {
    running: ["正在查看工作会话消息", "Reading work session message"],
    complete: ["已查看工作会话消息", "Read work session message"],
    failed: ["未能查看工作会话消息", "Could not read work session message"],
    waiting: ["等待你允许查看工作会话消息", "Waiting for permission to read the work session message"],
  },
  "part.chat": {
    running: ["正在查看聊天会话消息", "Reading chat session message"],
    complete: ["已查看聊天会话消息", "Read chat session message"],
    failed: ["未能查看聊天会话消息", "Could not read chat session message"],
    waiting: ["等待你允许查看聊天会话消息", "Waiting for permission to read the chat session message"],
  },
  "reply": {
    running: ["正在回答工作会话中的问题", "Answering work session question"],
    complete: ["已发送回答", "Sent answer"],
    failed: ["未能回答工作会话中的问题", "Could not send answer"],
    waiting: ["等待你允许回答工作会话中的问题", "Waiting for permission to answer the work session question"],
  },
  "stop": {
    running: ["正在停止工作会话", "Stopping work session"],
    complete: ["已停止工作会话", "Stopped work session"],
    failed: ["未能停止工作会话", "Could not stop work session"],
    waiting: ["等待你允许停止工作会话", "Waiting for permission to stop the work session"],
  },
  "archive": {
    running: ["正在归档工作会话", "Archiving work session"],
    complete: ["已归档工作会话", "Archived work session"],
    failed: ["未能归档工作会话", "Could not archive work session"],
    waiting: ["等待你允许归档工作会话", "Waiting for permission to archive the work session"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备会话", "Preparing session"],
    complete: ["已处理会话", "Processed session"],
    failed: ["未能继续会话", "Could not continue session"],
    waiting: ["等待你确认会话", "Waiting for confirmation about the session"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备会话", "Preparing session"];
