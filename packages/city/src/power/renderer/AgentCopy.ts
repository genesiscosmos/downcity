/** Agent 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "agent.list": {
    running: ["正在查看可用 Agent", "Checking available agents"],
    complete: ["已查看可用 Agent", "Available agents checked"],
    failed: ["无法查看 Agent", "Could not list agents"],
    waiting: ["等待你允许查看可用 Agent", "Waiting for permission to check available agents"],
  },
  "agent.create": {
    running: ["正在创建 Agent", "Creating agent"],
    complete: ["Agent 已创建", "Agent created"],
    failed: ["Agent 创建失败", "Could not create agent"],
    waiting: ["等待你允许创建 Agent", "Waiting for permission to create the agent"],
  },
  "agent.delegate": {
    running: ["正在创建工作会话", "Creating work session"],
    complete: ["工作会话已创建", "Work session created"],
    failed: ["工作会话创建失败", "Could not create work session"],
    waiting: ["等待你允许创建工作会话", "Waiting for permission to create the work session"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Available actions checked"],
    failed: ["无法查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备协作", "Preparing collaboration"],
    complete: ["协作处理已结束", "Collaboration finished"],
    failed: ["协作未能完成", "Could not complete collaboration"],
    waiting: ["等待你确认协作", "Waiting for confirmation about collaboration"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备协作", "Preparing collaboration"];
