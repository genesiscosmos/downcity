/**
 * PlatformStore 门面。
 *
 * 关键点（中文）
 * - 对外仍然只暴露一个 `PlatformStore` 类，保持调用入口稳定。
 * - 内部已经按职责拆成 schema、secure settings 与 Plugin Resource 等模块。
 * - 这样既能保持外部 API 简洁，也能把通用存储层控制在可维护的模块粒度内。
 */

import fs from "fs-extra";
import { DatabaseSync } from "node:sqlite";
import {
  getFederationStoreDbPath,
  getPlatformStoreDbPath,
} from "@/city/process/registry/CityPaths.js";
import { ensurePlatformStoreSchema } from "@/city/runtime/store/StoreSchema.js";
import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import {
  getPlatformRootDirPath,
} from "@/city/process/registry/CityPaths.js";
import {
  buildAgentSecureSettingKey,
  getSecureSettingJson,
  getSecureSettingJsonSync,
  removeSecureSetting,
  setSecureSettingJson,
  setSecureSettingJsonSync,
} from "@/city/runtime/store/StoreSecureSettings.js";

const FEDERATION_CONFIG_KEY = "federation.config";
const FEDERATION_STORE_MIGRATION_KEY = "migration.federation_store_to_downcity_db.v1";

/**
 * 平台控制面全局存储门面。
 */
export class PlatformStore {
  private readonly sqlite: DatabaseSync;

  constructor(dbPath: string = getPlatformStoreDbPath()) {
    fs.ensureDirSync(getPlatformRootDirPath());
    this.sqlite = new DatabaseSync(dbPath);
    configure_sqlite(this.sqlite, true);
    ensurePlatformStoreSchema(this.context);
  }

  /**
   * 暴露给内部 helper 的只读上下文视图。
   */
  private get context(): PlatformStoreContext {
    return {
      sqlite: this.sqlite,
    };
  }

  /**
   * 关闭连接。
   */
  close(): void {
    this.sqlite.close();
  }

  /**
   * 清空所有存储数据。
   */
  clearAll(): void {
    this.sqlite.exec("DELETE FROM platform_secure_settings;");
    this.sqlite.exec("DELETE FROM plugin_resources;");
    this.sqlite.exec("DELETE FROM agent_tokens;");
    this.sqlite.exec("DELETE FROM agent_plugins;");
    this.sqlite.exec("DELETE FROM plugin_installations;");
  }

  /**
   * 同步读取 console 加密配置项（JSON）。
   */
  getSecureSettingJsonSync<T>(key: string): T | null {
    return getSecureSettingJsonSync<T>(this.context, key);
  }

  /**
   * 同步写入 console 加密配置项（JSON）。
   */
  setSecureSettingJsonSync(key: string, value: unknown): void {
    setSecureSettingJsonSync(this.context, key, value);
  }

  /**
   * 删除 console 加密配置项。
   */
  removeSecureSetting(key: string): void {
    removeSecureSetting(this.context, key);
  }

  /**
   * 异步读取 console 加密配置项（JSON）。
   */
  async getSecureSettingJson<T>(key: string): Promise<T | null> {
    return await getSecureSettingJson<T>(this.context, key);
  }

  /**
   * 异步写入 console 加密配置项（JSON）。
   */
  async setSecureSettingJson(key: string, value: unknown): Promise<void> {
    await setSecureSettingJson(this.context, key, value);
  }

  /**
   * 同步读取 agent 加密配置项（JSON）。
   */
  getAgentSecureSettingJsonSync<T>(agentIdInput: string, keyInput: string): T | null {
    return this.getSecureSettingJsonSync<T>(
      buildAgentSecureSettingKey(agentIdInput, keyInput),
    );
  }

  /**
   * 同步写入 agent 加密配置项（JSON）。
   */
  setAgentSecureSettingJsonSync(agentIdInput: string, keyInput: string, value: unknown): void {
    this.setSecureSettingJsonSync(
      buildAgentSecureSettingKey(agentIdInput, keyInput),
      value,
    );
  }

  /**
   * 删除 agent 加密配置项。
   */
  removeAgentSecureSetting(agentIdInput: string, keyInput: string): void {
    this.removeSecureSetting(buildAgentSecureSettingKey(agentIdInput, keyInput));
  }

  /**
   * 异步读取 agent 加密配置项（JSON）。
   */
  async getAgentSecureSettingJson<T>(
    agentIdInput: string,
    keyInput: string,
  ): Promise<T | null> {
    return await this.getSecureSettingJson<T>(
      buildAgentSecureSettingKey(agentIdInput, keyInput),
    );
  }

  /**
   * 异步写入 agent 加密配置项（JSON）。
   */
  async setAgentSecureSettingJson(
    agentIdInput: string,
    keyInput: string,
    value: unknown,
  ): Promise<void> {
    await this.setSecureSettingJson(
      buildAgentSecureSettingKey(agentIdInput, keyInput),
      value,
    );
  }

}

/**
 * 创建 Downcity 统一平台存储。
 */
export function create_downcity_platform_store(): PlatformStore {
  return new PlatformStore(getPlatformStoreDbPath());
}

/**
 * 创建 Federation 管理端状态存储。
 */
export function create_federation_platform_store(): PlatformStore {
  const store = new PlatformStore(getPlatformStoreDbPath());
  migrate_federation_config(store);
  return store;
}

/**
 * 把旧 `federation.db` 中的管理端配置一次性迁入统一的 `downcity.db`。
 *
 * 关键点（中文）
 * - 迁移只在统一仓储尚未记录完成标记时执行。
 * - 新仓储已有配置时绝不被旧数据覆盖。
 * - 旧数据库保留在原处作为人工恢复副本，运行时不再持续读取。
 */
function migrate_federation_config(store: PlatformStore): void {
  if (store.getSecureSettingJsonSync<boolean>(FEDERATION_STORE_MIGRATION_KEY) === true) {
    return;
  }

  const legacy_db_path = getFederationStoreDbPath();
  if (
    legacy_db_path !== getPlatformStoreDbPath()
    && fs.existsSync(legacy_db_path)
    && store.getSecureSettingJsonSync<unknown>(FEDERATION_CONFIG_KEY) === null
  ) {
    const legacy_store = new PlatformStore(legacy_db_path);
    try {
      const legacy_config = legacy_store.getSecureSettingJsonSync<unknown>(FEDERATION_CONFIG_KEY);
      if (legacy_config !== null) {
        store.setSecureSettingJsonSync(FEDERATION_CONFIG_KEY, legacy_config);
      }
    } finally {
      legacy_store.close();
    }
  }

  store.setSecureSettingJsonSync(FEDERATION_STORE_MIGRATION_KEY, true);
}

/**
 * 在 PlatformStore 上下文中执行操作。
 *
 * 关键点（中文）
 * - 用于一次性数据库操作，无需手动管理 PlatformStore 实例生命周期。
 * - 自动处理数据库连接和关闭。
 */
export function withPlatformStore<T>(callback: (context: PlatformStoreContext) => T): T {
  const dbPath = getPlatformStoreDbPath();
  fs.ensureDirSync(getPlatformRootDirPath());
  const sqlite = new DatabaseSync(dbPath);
  configure_sqlite(sqlite, false);
  const context: PlatformStoreContext = {
    sqlite,
  };
  ensurePlatformStoreSchema(context);
  try {
    return callback(context);
  } finally {
    sqlite.close();
  }
}

/** 为 CLI 与 Electron 共用的内置 SQLite 连接设置运行参数。 */
function configure_sqlite(sqlite: DatabaseSync, foreign_keys: boolean): void {
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  if (foreign_keys) sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");
}
