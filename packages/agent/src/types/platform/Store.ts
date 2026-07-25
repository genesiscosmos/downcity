/**
 * 平台存储类型定义。
 *
 * 关键点（中文）
 * - downcity 只保存平台级 env 与安全配置。
 * - 模型能力由 City AIService 暴露，downcity 不再声明 provider/model 存储类型。
 */

/**
 * 平台环境变量记录。
 */
export interface StoredEnvEntry {
  /**
   * Env 作用域。
   *
   * 关键点（中文）
   * - 当前版本只保留 `global` 单一作用域。
   * - 所有平台 Env 都视为宿主级共享变量，由宿主决定是否注入具体运行实例。
   */
  scope: "global";
  /**
   * 环境变量 key（例如 `OPENAI_API_KEY`）。
   */
  key: string;
  /**
   * 环境变量描述。
   *
   * 关键点（中文）
   * - 面向用户说明该变量的用途。
   * - 可为空，用于兼容历史只存 key/value 的数据。
   */
  description?: string;
  /**
   * 环境变量 value（解密后的明文，仅运行时内存可见）。
   */
  value: string;
  /**
   * 创建时间（ISO 字符串）。
   */
  createdAt: string;
  /**
   * 更新时间（ISO 字符串）。
   */
  updatedAt: string;
}

/**
 * Env 写入参数。
 */
export interface UpsertEnvEntryInput {
  /**
   * Env 作用域。
   *
   * 关键点（中文）
   * - 当前只允许写入 `global`。
   * - 保留该字段是为了让宿主侧调用点显式表达“这是平台全局 env 写入”。
   */
  scope: "global";
  /**
   * 环境变量 key。
   */
  key: string;
  /**
   * 环境变量描述。
   *
   * 关键点（中文）
   * - 允许为空，表示暂未填写用途说明。
   */
  description?: string;
  /**
   * 环境变量值；空字符串也允许（用于显式置空）。
   */
  value: string;
}

/**
 * 全局环境变量记录。
 */
export type StoredGlobalEnvEntry = StoredEnvEntry;

/**
 * 全局环境变量写入参数。
 */
export type UpsertGlobalEnvEntryInput = Omit<UpsertEnvEntryInput, "scope">;
