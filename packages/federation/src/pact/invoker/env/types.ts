/**
 * Env 类型（对应 service/env/types.ts）。
 */

/** 环境变量记录 */
export interface EnvEntry {
  key: string;
  value: string;
  source: "database";
}

/** 写入/更新 env 的输入 */
export interface EnvUpsertInput {
  key: string;
  value: string;
}

/**
 * env refresh 结果。
 */
export interface EnvRefreshResult {
  /** 是否刷新成功。 */
  success: boolean;
  /** 当前 refresh 后可见的 env 数量。 */
  count: number;
}

/**
 * 单个 env requirement 的当前状态。
 */
export interface EnvRequirementStatus {
  /**
   * 环境变量 key。
   */
  key: string;

  /**
   * 给管理员展示的说明文本。
   */
  description: string;

  /**
   * 当前是否必填。
   */
  required: boolean;

  /**
   * 当前 Federation 是否已经配置了该 key。
   */
  configured: boolean;

  /**
   * 当前值的安全预览文本。
   */
  value_preview?: string;
}

/**
 * City 聚合后的 env 配置分组。
 */
export interface EnvCatalogScope {
  /**
   * 分组唯一标识。
   */
  id: string;

  /**
   * 分组展示名称。
   */
  name: string;

  /**
   * 当前分组下的 env requirement 列表。
   */
  env: EnvRequirementStatus[];
}
