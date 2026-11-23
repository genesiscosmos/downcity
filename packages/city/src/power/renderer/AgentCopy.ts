/** Agent 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "agent.list": {
    running: ["正在查看可用 Agent", "Checking available agents"],
    complete: ["已查看可用 Agent", "Checked available agents"],
    failed: ["未能查看可用 Agent", "Could not list agents"],
    waiting: ["等待你允许查看可用 Agent", "Waiting for permission to check available agents"],
  },
  "agent.create": {
    running: ["正在创建 Agent", "Creating agent"],
    complete: ["已创建Agent", "Created agent"],
    failed: ["未能创建 Agent", "Could not create agent"],
    waiting: ["等待你允许创建 Agent", "Waiting for permission to create the agent"],
  },
  "agent.delegate": {
    running: ["正在创建工作会话", "Creating work session"],
    complete: ["已创建工作会话", "Created work session"],
    failed: ["未能创建工作会话", "Could not create work session"],
    waiting: ["等待你允许创建工作会话", "Waiting for permission to create the work session"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备协作", "Preparing collaboration"],
    complete: ["已完成协作", "Completed collaboration"],
    failed: ["未能完成协作", "Could not complete collaboration"],
    waiting: ["等待你确认协作", "Waiting for confirmation about collaboration"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备协作", "Preparing collaboration"];
