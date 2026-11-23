/** Skill 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "@downcity/city/power/react";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "list": {
    running: ["正在查看技能", "Checking skills"],
    complete: ["已查看技能", "Checked skills"],
    failed: ["未能查看技能", "Could not list skills"],
    waiting: ["等待你允许查看技能", "Waiting for permission to check skills"],
  },
  "lookup": {
    running: ["正在加载技能", "Loading skill"],
    complete: ["已加载技能", "Loaded skill"],
    failed: ["未能加载技能", "Could not load skill"],
    waiting: ["等待你允许加载技能", "Waiting for permission to load the skill"],
  },
  "servers": {
    running: ["正在查看外部服务", "Checking external services"],
    complete: ["已查看外部服务", "Checked external services"],
    failed: ["未能查看外部服务", "Could not list services"],
    waiting: ["等待你允许查看外部服务", "Waiting for permission to check external services"],
  },
  "tools": {
    running: ["正在查看可用工具", "Checking available tools"],
    complete: ["已查看可用工具", "Checked available tools"],
    failed: ["未能查看可用工具", "Could not list tools"],
    waiting: ["等待你允许查看可用工具", "Waiting for permission to check available tools"],
  },
  "call": {
    running: ["正在调用外部工具", "Calling external tool"],
    complete: ["已调用外部工具", "Called external tool"],
    failed: ["未能调用外部工具", "Could not call external tool"],
    waiting: ["等待你允许调用外部工具", "Waiting for permission to call the external tool"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备使用技能", "Preparing to use skills"],
    complete: ["已调用技能", "Used skill"],
    failed: ["未能使用技能", "Could not use skill"],
    waiting: ["等待你允许使用技能", "Waiting for permission to use the skill"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备使用技能", "Preparing to use skills"];
