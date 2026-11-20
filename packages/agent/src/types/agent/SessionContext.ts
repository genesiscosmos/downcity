/**
 * AgentSessions 解析单个 Session 执行上下文时的输入。
 *
 * 职责说明（中文）
 * - 执行资源由宿主按 Session 的顶层创建字段与 Workspace 装配。
 * - type/kind 表达会话用途，不授予工具或权限。
 *
 * 关键点（中文）
 * - 这里描述「创建/恢复这一个 Session 需要什么」，不是 Agent 全局配置。
 */

import type { SessionDescriptor, WorkspaceRuntime } from "@downcity/type";

/** 单个 Session 的执行上下文解析输入。 */
export interface SessionContextResolution extends Partial<SessionDescriptor> {

  /** 本次创建或恢复时指定的当前目录；未指定时创建使用 Agent 默认目录。 */
  readonly workspace?: WorkspaceRuntime;

  /**
   * 本次解析是否用于创建新会话。
   *
   * 关键点（中文）：Agent 的默认目录只在新会话生效；恢复时必须由宿主注入，
   * 不能用默认值顶替，否则会静默换目录。
   */
  readonly creating?: boolean;
}
