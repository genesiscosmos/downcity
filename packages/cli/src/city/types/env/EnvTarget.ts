/**
 * City Env 配置目标与修改结果类型。
 */

import type { EnvBroadcastResult } from "@/city/types/env/EnvBroadcast.js";

/** Env 文件配置目标。 */
export interface EnvTarget {
  /** 配置作用域：平台全局默认值或具体 Workspace。 */
  scope: "global" | "workspace";
  /** 目标 `.env` 文件绝对路径。 */
  file_path: string;
  /** Workspace 作用域对应的 Agent ID，仅用于用户展示。 */
  agent_id?: string;
  /** Workspace 作用域对应的项目绝对路径。 */
  workspace_path?: string;
  /** 文件权限；全局 Env 固定为仅当前用户可读写。 */
  mode?: number;
}

/** Env 文件修改与在线广播结果。 */
export interface EnvMutationResult {
  /** 已修改的配置目标。 */
  target: EnvTarget;
  /** 已规范化的 Env key。 */
  key: string;
  /** 本次是否真实修改了文件。 */
  changed: boolean;
  /** 受影响 Agent 的运行时广播结果。 */
  broadcast: EnvBroadcastResult;
}
