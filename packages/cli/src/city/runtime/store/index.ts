/**
 * PlatformStore 门面。
 *
 * 关键点（中文）
 * - 对外仍然只暴露一个 `PlatformStore` 类，保持调用入口稳定。
 * - 内部已经按职责拆成 schema、secure settings、env、chat accounts 多个模块。
 * - 这样既能保持外部 API 简洁，也能把通用存储层控制在可维护的模块粒度内。
 */

import fs from "fs-extra";
import Database from "better-sqlite3";
import {
  getFederationStoreDbPath,
  getPlatformStoreDbPath,
} from "@/city/process/registry/CityPaths.js";
import { ensurePlatformStoreSchema } from "@/city/runtime/store/StoreSchema.js";
import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import type {
  StoredEnvEntry,
  StoredGlobalEnvEntry,
  UpsertEnvEntryInput,
  UpsertGlobalEnvEntryInput,
} from "@/city/types/platform/PlatformStore.js";
import type {
  StoredChannelAccount,
  UpsertChannelAccountInput,
} from "@downcity/plugins/chat";
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
import {
  clearGlobalEnvEntries,
  getGlobalEnvMap,
  getGlobalEnvMapSync,
  listEnvEntries,
  listEnvEntriesSync,
  listGlobalEnvEntries,
  listGlobalEnvEntriesSync,
  removeEnvEntry,
  removeGlobalEnvEntry,
  upsertEnvEntry,
  upsertGlobalEnvEntry,
} from "@/city/runtime/store/StoreEnvRepository.js";
import {
  getChannelAccount,
  getChannelAccountSync,
  listChannelAccounts,
  listChannelAccountsSync,
  removeChannelAccount,
  upsertChannelAccount,
} from "@/city/runtime/store/StoreChannelAccountRepository.js";

/**
 * 平台控制面全局存储门面。
 */
export class PlatformStore {
  private readonly sqlite: Database.Database;

  constructor(dbPath: string = getPlatformStoreDbPath()) {
    fs.ensureDirSync(getPlatformRootDirPath());
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("journal_mode = WAL");
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
    this.sqlite.exec("DELETE FROM env_entries;");
    this.sqlite.exec("DELETE FROM managed_agents;");
    this.sqlite.exec("DELETE FROM channel_accounts;");
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

  /**
   * 查询 env 条目（同步）。
   */
  listEnvEntriesSync(): StoredEnvEntry[] {
    return listEnvEntriesSync(this.context);
  }

  /**
   * 查询 env 条目（异步）。
   */
  async listEnvEntries(): Promise<StoredEnvEntry[]> {
    return await listEnvEntries(this.context);
  }

  /**
   * 新增或更新 env 条目。
   */
  async upsertEnvEntry(input: UpsertEnvEntryInput): Promise<void> {
    await upsertEnvEntry(this.context, input);
  }

  /**
   * 删除单个 env 条目。
   */
  removeEnvEntry(keyInput: string): void {
    removeEnvEntry(this.context, keyInput);
  }

  /**
   * 列出全局环境变量（同步解密）。
   */
  listGlobalEnvEntriesSync(): StoredGlobalEnvEntry[] {
    return listGlobalEnvEntriesSync(this.context);
  }

  /**
   * 读取环境变量映射（同步解密）。
   */
  getEnvMapSync(): Record<string, string> {
    return getGlobalEnvMapSync(this.context);
  }

  /**
   * 列出环境变量（解密后）。
   */
  async listGlobalEnvEntries(): Promise<StoredGlobalEnvEntry[]> {
    return await listGlobalEnvEntries(this.context);
  }

  /**
   * 读取环境变量映射（解密后）。
   */
  async getEnvMap(): Promise<Record<string, string>> {
    return await getGlobalEnvMap(this.context);
  }

  /**
   * 新增或更新全局环境变量。
   */
  async upsertGlobalEnvEntry(input: UpsertGlobalEnvEntryInput): Promise<void> {
    await upsertGlobalEnvEntry(this.context, input);
  }

  /**
   * 删除单个全局环境变量。
   */
  removeGlobalEnvEntry(keyInput: string): void {
    removeGlobalEnvEntry(this.context, keyInput);
  }

  /**
   * 清空全局环境变量。
   */
  clearGlobalEnvEntries(): void {
    clearGlobalEnvEntries(this.context);
  }

  /**
   * 列出 chat accounts（同步解密）。
   */
  listChannelAccountsSync(channelInput?: string): StoredChannelAccount[] {
    return listChannelAccountsSync(this.context, channelInput);
  }

  /**
   * 按 ID 获取 chat account（同步解密）。
   */
  getChannelAccountSync(accountIdInput: string): StoredChannelAccount | null {
    return getChannelAccountSync(this.context, accountIdInput);
  }

  /**
   * 列出 chat accounts（解密后）。
   */
  async listChannelAccounts(channelInput?: string): Promise<StoredChannelAccount[]> {
    return await listChannelAccounts(this.context, channelInput);
  }

  /**
   * 按 ID 获取 chat account（解密后）。
   */
  async getChannelAccount(accountIdInput: string): Promise<StoredChannelAccount | null> {
    return await getChannelAccount(this.context, accountIdInput);
  }

  /**
   * 新增或更新 chat account。
   */
  async upsertChannelAccount(input: UpsertChannelAccountInput): Promise<void> {
    await upsertChannelAccount(this.context, input);
  }

  /**
   * 删除 chat account。
   */
  removeChannelAccount(accountIdInput: string): void {
    removeChannelAccount(this.context, accountIdInput);
  }

}

/**
 * 创建 City 本地状态存储。
 */
export function createCityPlatformStore(): PlatformStore {
  return new PlatformStore(getPlatformStoreDbPath());
}

/**
 * 创建 Federation 管理端状态存储。
 */
export function createFederationPlatformStore(): PlatformStore {
  return new PlatformStore(getFederationStoreDbPath());
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
  const sqlite = new Database(dbPath);
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
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
