/**
 * Downtown 部署运行时结果类型。
 *
 * 关键点（中文）
 * - 部署过程的每个步骤都返回结构化结果，由 deployer 统一渲染最终输出。
 * - runtime 模块不直接拼接最终摘要文案，降低步骤执行和 CLI 展示之间的耦合。
 * - 所有字段都使用 snake_case，和现有 Downtown CLI 代码风格保持一致。
 */

/**
 * package script 执行状态。
 */
export type DowntownPackageScriptStatus =
  | "passed"
  | "skipped"
  | "missing";

/**
 * 单个 package script 的执行结果。
 */
export interface DowntownPackageScriptResult {
  /**
   * 展示给用户的命令文本。
   */
  command: string;

  /**
   * 当前脚本执行状态。
   */
  status: DowntownPackageScriptStatus;
}

/**
 * 部署前 package scripts 执行结果。
 */
export interface DowntownPackageDeployScriptsResult {
  /**
   * build script 的执行结果。
   */
  build: DowntownPackageScriptResult;

  /**
   * typecheck script 的执行结果。
   */
  typecheck: DowntownPackageScriptResult;
}

/**
 * D1 数据库准备状态。
 */
export type DowntownD1DatabaseStatus =
  | "created"
  | "reused"
  | "skipped";

/**
 * D1 数据库准备结果。
 */
export interface DowntownD1DatabaseSummary {
  /**
   * 数据库名称。
   */
  name?: string;

  /**
   * Cloudflare D1 database id。
   */
  id?: string;

  /**
   * 数据库准备状态。
   */
  status: DowntownD1DatabaseStatus;
}

/**
 * Queue 准备状态。
 */
export type DowntownQueueStatus =
  | "created"
  | "reused"
  | "pending"
  | "skipped";

/**
 * Queue 准备结果。
 */
export interface DowntownQueueSummary {
  /**
   * Queue 名称。
   */
  name?: string;

  /**
   * Queue 准备状态。
   */
  status: DowntownQueueStatus;
}

/**
 * Storage 准备状态。
 */
export type DowntownStorageStatus =
  | "created"
  | "reused"
  | "pending"
  | "skipped";

/**
 * Storage 准备结果。
 */
export interface DowntownStorageSummary {
  /**
   * 存储资源名称。
   */
  name?: string;

  /**
   * 存储资源类型。
   */
  type?: "r2";

  /**
   * 存储资源准备状态。
   */
  status: DowntownStorageStatus;
}
