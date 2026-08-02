/**
 * 管理端类型。
 */

import type { FetchLike } from "../http.js";
import type { CityModelDescriptor } from "@downcity/type";
import type { UserServiceSummary } from "../user/types.js";

/** Federation Root Admin 访问层构造参数。 */
export interface FederationAdminOptions {
  /** Federation 管理端入口地址，支持 `http(s)://`。 */
  base_url: string;

  /** Federation Root Secret。 */
  credential: string;
  /** 自定义 fetch 实现 */
  fetch?: FetchLike;
}

/**
 * 管理端可见的 Service 摘要。
 *
 * 复用统一 Service 目录结构：
 * - `id` / `name` 用于展示可调用模块
 * - `env` 用于提示当前模块依赖的配置项
 */
export type AdminServiceSummary = UserServiceSummary;

/**
 * 管理端可见的模型目录记录。
 *
 * 复用统一模型目录结构；admin 身份下会额外看到：
 * - `env_requirements`
 */
export type AdminModelRecord = CityModelDescriptor;

/**
 * City 聚合说明文档结果。
 */
export interface AdminInstructionResult {
  /**
   * 供管理端直接阅读的纯文本说明。
   */
  text: string;
}
