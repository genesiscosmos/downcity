/**
 * AgentSessions 解析单个 Session 执行上下文时的输入。
 *
 * 职责说明（中文）
 * - 执行上下文按会话身份解析：主对话比普通 Session 多一组工具。
 * - 会话身份就是它的完整 `origin`，因此不需要新增会话类型字段。
 *
 * 关键点（中文）
 * - 这里描述「创建/恢复这一个 Session 需要什么」，不是 Agent 全局配置。
 */

import type { SessionOrigin, WorkspaceRuntime } from "@downcity/type";

/** 单个 Session 的执行上下文解析输入。 */
export interface SessionContextResolution {
  /** 本次创建或恢复的 Session 完整来源；`type` 即会话身份。 */
  readonly origin?: SessionOrigin;

  /** 本次创建或恢复时指定的当前目录；未指定时使用 Agent 默认目录。 */
  readonly workspace?: WorkspaceRuntime;
}
