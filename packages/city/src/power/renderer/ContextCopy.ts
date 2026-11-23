/** Context 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "env.get": {
    running: ["正在获取当前身份和工作目录", "Getting current identity and working directory"],
    complete: ["已获取当前身份和工作目录", "Retrieved current identity and working directory"],
    failed: ["未能获取当前身份和工作目录", "Could not retrieve current identity and working directory"],
    waiting: ["等待你允许获取当前身份和工作目录", "Waiting for permission to retrieve current identity and working directory"],
  },
  "sandbox.get": {
    running: ["正在检查执行限制", "Checking execution restrictions"],
    complete: ["已获取执行限制", "Retrieved execution restrictions"],
    failed: ["未能获取执行限制", "Could not retrieve execution restrictions"],
    waiting: ["等待你允许检查执行限制", "Waiting for permission to check execution restrictions"],
  },
  "sandbox.list_mounts": {
    running: ["正在查找挂载目录", "Finding mounted directories"],
    complete: ["已获取挂载目录", "Retrieved mounted directories"],
    failed: ["未能获取挂载目录", "Could not retrieve mounted directories"],
    waiting: ["等待你允许查找挂载目录", "Waiting for permission to find mounted directories"],
  },
  "sandbox.explain_path": {
    running: ["正在检查路径权限", "Checking path permissions"],
    complete: ["已获取路径权限结果", "Retrieved path access result"],
    failed: ["未能获取路径权限结果", "Could not retrieve path access result"],
    waiting: ["等待你允许检查路径权限", "Waiting for permission to check path permissions"],
  },
  "workspaces.get": {
    running: ["正在获取工作区信息", "Getting workspace details"],
    complete: ["已获取工作区信息", "Retrieved workspace details"],
    failed: ["未能获取工作区信息", "Could not retrieve workspace details"],
    waiting: ["等待你允许获取工作区信息", "Waiting for permission to retrieve workspace details"],
  },
  "workspaces.list": {
    running: ["正在查找工作区", "Finding workspaces"],
    complete: ["已获取工作区列表", "Retrieved workspace list"],
    failed: ["未能查找工作区", "Could not find workspaces"],
    waiting: ["等待你允许查找工作区", "Waiting for permission to find workspaces"],
  },
  "usage.get": {
    running: ["正在统计 Token 消耗", "Calculating token usage"],
    complete: ["已获取 Token 消耗统计", "Retrieved token usage statistics"],
    failed: ["未能获取 Token 消耗统计", "Could not retrieve token usage statistics"],
    waiting: ["等待你允许统计 Token 消耗", "Waiting for permission to calculate token usage"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备查看运行信息", "Preparing to check execution information"],
    complete: ["已查看运行信息", "Checked execution information"],
    failed: ["未能查看运行信息", "Could not check execution information"],
    waiting: ["等待你允许查看运行信息", "Waiting for permission to view execution information"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备查看运行信息", "Preparing to check execution information"];
