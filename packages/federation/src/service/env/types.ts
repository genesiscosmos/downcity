/**
 * Env 层公共类型。
 *
 * Downcity 的业务 env 统一由 Federation 内部管理。
 * Service / Model 只声明自己需要哪些 key，具体值统一写入 City 的 env 表。
 */

/**
 * Runtime env 列表中的单条记录。
 */
export interface EnvEntry extends Record<string, unknown> {
  /**
   * 标准化后的环境变量名。
   */
  key: string;

  /**
   * 环境变量明文值。
   */
  value: string;

  /**
   * env 值来源。
   */
  source: "database";
}

/**
 * 写入 env 时的输入。
 */
export interface EnvUpsertInput {
  /**
   * 环境变量名。
   */
  key: string;

  /**
   * 环境变量值。
   */
  value: string;
}

/**
 * env refresh 结果。
 */
export interface EnvRefreshResult {
  /**
   * 是否刷新成功。
   */
  success: boolean;

  /**
   * 当前 refresh 后可见的 env 数量。
   */
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
