/**
 * Memory Power 的全局宿主管理协议。
 *
 * Provider 快照直接报告当前实例状态；范围目录仅提供宿主可用的 Agent 与 Workspace，
 * 两者都不依赖 Agent 执行上下文，也不读取记忆正文或统计知识数量。
 */

import type { MemoryStatusResult } from "./Memory.js";
import type { MemoryJobView } from "./MemoryJob.js";
export type { MemoryDreamSummary } from "./MemoryDream.js";

/** 宿主全局处理记录的可选筛选与分页；不作为普通 Agent 的访问身份。 */
export interface MemoryRecordListInput {
  /** 只显示指定 Agent 的记录；省略时显示所有当前可管理 Agent。 */
  agent_id?: string;
  /** 指定项目；空串明确筛选无项目，省略时包含所有当前可管理项目及无项目记录。 */
  workspace_id?: string;
  /** 每页条数，整数 1–100；默认 30。 */
  limit?: number;
  /** 在权限与范围筛选后的偏移量，非负整数；默认 0。 */
  offset?: number;
}

/** 当前 City 的处理记录分页，不包含来源正文。 */
export interface MemoryRecordListResult {
  /** 按 updated_at 降序、相同时间按 job_id 升序排列的当前页。 */
  items: MemoryJobView[];
  /** 当前权限与筛选条件匹配的总条数，不受分页影响。 */
  total: number;
}

/** Power 配置快照：Knowledge 后端与语义处理分别归属，后台策略通过独立管理端口读取。 */
export interface MemoryConfigSnapshot {
  /** 可替换知识后端的实际运行信息，不含 Profile 或处理模型配置。 */
  knowledge: {
    /** 当前 Provider 生命周期、存储和知识能力，不读取知识计数。 */
    status: MemoryStatusResult;
  };
  /** Power 自身的处理配置，切换知识后端不改变其归属。 */
  processing: {
    /** 初始化时固定的 Memory Session 模型；省略时跟随执行 Agent 默认模型。 */
    model_id?: string;
  };
}

/** 供管理页面显式选择执行范围的宿主目录，不包含记忆条数或知识内容。 */
export interface MemoryManagementScopes {
  /** 宿主当前可用的 Agent 目录；没有 Agent 时返回空数组。 */
  agents: {
    /** 宿主提供的稳定 Agent 标识，用于后续管理 action 的范围校验。 */
    agent_id: string;
    /** 宿主提供的 Agent 展示名称。 */
    name: string;
  }[];

  /** 宿主当前可用的 Workspace 目录；空目录仍允许选择无项目范围。 */
  workspaces: {
    /** 宿主提供的稳定 Workspace 标识；无项目通过请求中的空 workspace_id 表达。 */
    workspace_id: string;
    /** 宿主提供的 Workspace 展示名称，不暴露宿主文件路径。 */
    name: string;
  }[];
}
