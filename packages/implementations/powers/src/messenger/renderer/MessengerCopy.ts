/** Messenger 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "@downcity/city/power/react";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "context": {
    running: ["正在查看当前聊天", "Checking current conversation"],
    complete: ["已查看当前聊天", "Checked current conversation"],
    failed: ["未能查看当前聊天", "Could not check current conversation"],
    waiting: ["等待你允许查看当前聊天", "Waiting for permission to check the current conversation"],
  },
  "list": {
    running: ["正在查看外部聊天", "Checking external conversations"],
    complete: ["已查看外部聊天", "Checked external conversations"],
    failed: ["未能查看外部聊天", "Could not list conversations"],
    waiting: ["等待你允许查看外部聊天", "Waiting for permission to check external conversations"],
  },
  "history": {
    running: ["正在读取聊天记录", "Reading conversation history"],
    complete: ["已读取聊天记录", "Read conversation history"],
    failed: ["未能读取聊天记录", "Could not read conversation history"],
    waiting: ["等待你允许读取聊天记录", "Waiting for permission to read conversation history"],
  },
  "send": {
    running: ["正在安排消息发送", "Scheduling message delivery"],
    complete: ["已安排消息发送", "Scheduled message delivery"],
    failed: ["未能发送消息", "Could not send message"],
    waiting: ["等待你允许发送消息", "Waiting for permission to send the message"],
  },
  "react": {
    running: ["正在添加回应", "Adding reaction"],
    complete: ["已安排回应", "Scheduled reaction"],
    failed: ["未能添加回应", "Could not add reaction"],
    waiting: ["等待你允许添加回应", "Waiting for permission to add the reaction"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备聊天内容", "Preparing conversation content"],
    complete: ["已处理聊天", "Handled conversation"],
    failed: ["未能处理聊天", "Could not complete conversation"],
    waiting: ["等待你确认聊天内容", "Waiting for confirmation about conversation content"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备聊天内容", "Preparing conversation content"];
