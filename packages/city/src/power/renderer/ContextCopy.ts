/** Context 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "env.get": {
    running: ["正在查看运行环境", "Checking execution environment"],
    complete: ["已查看运行环境", "Execution environment checked"],
    failed: ["无法查看运行环境", "Could not check execution environment"],
    waiting: ["等待你允许查看运行环境", "Waiting for permission to view the execution environment"],
  },
  "sandbox.get": {
    running: ["正在查看访问范围", "Checking access boundaries"],
    complete: ["已查看访问范围", "Access boundaries checked"],
    failed: ["无法查看访问范围", "Could not check access boundaries"],
    waiting: ["等待你允许查看访问范围", "Waiting for permission to check access boundaries"],
  },
  "sandbox.list_mounts": {
    running: ["正在查看可访问目录", "Checking accessible directories"],
    complete: ["已查看可访问目录", "Accessible directories checked"],
    failed: ["无法查看可访问目录", "Could not list accessible directories"],
    waiting: ["等待你允许查看可访问目录", "Waiting for permission to check accessible directories"],
  },
  "sandbox.explain_path": {
    running: ["正在检查路径访问权限", "Checking path access"],
    complete: ["已检查路径访问权限", "Path access checked"],
    failed: ["路径权限检查失败", "Could not check path access"],
    waiting: ["等待你允许检查路径访问权限", "Waiting for permission to check path access"],
  },
  "workspaces.get": {
    running: ["正在查看工作区", "Checking workspace"],
    complete: ["已查看工作区", "Workspace checked"],
    failed: ["无法查看工作区", "Could not check workspace"],
    waiting: ["等待你允许查看工作区", "Waiting for permission to check the workspace"],
  },
  "workspaces.list": {
    running: ["正在查看工作区", "Checking workspaces"],
    complete: ["已查看工作区", "Workspaces checked"],
    failed: ["无法查看工作区列表", "Could not list workspaces"],
    waiting: ["等待你允许查看工作区", "Waiting for permission to check workspaces"],
  },
  "usage.get": {
    running: ["正在查看用量", "Checking usage"],
    complete: ["已查看用量", "Usage checked"],
    failed: ["无法查看用量", "Could not check usage"],
    waiting: ["等待你允许查看用量", "Waiting for permission to check usage"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Available actions checked"],
    failed: ["无法查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备查看运行信息", "Preparing to check execution information"],
    complete: ["运行信息检查已结束", "Execution information check finished"],
    failed: ["无法查看运行信息", "Could not check execution information"],
    waiting: ["等待你允许查看运行信息", "Waiting for permission to view execution information"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备查看运行信息", "Preparing to check execution information"];
