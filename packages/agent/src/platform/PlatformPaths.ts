/**
 * 平台级全局路径规则。
 *
 * 职责说明（中文）
 * - 统一描述用户级 `~/.downcity` 根目录及其关键子路径。
 * - 让 `agent` 在不依赖 `city` 实现细节的前提下，也能复用同一套默认全局存储位置。
 *
 * 边界说明（中文）
 * - 这里只定义“路径约定”，不负责任何数据库、密钥或业务读写逻辑。
 * - 如需更换根目录，只能通过 `DC_PLATFORM_ROOT` 环境变量覆盖。
 */

import os from "node:os";
import path from "node:path";

/**
 * 返回 Downcity 平台级全局根目录。
 *
 * 关键点（中文）
 * - 默认固定为 `~/.downcity`。
 * - 测试或隔离运行场景可通过 `DC_PLATFORM_ROOT` 覆盖。
 */
export function getPlatformRootDirPath(): string {
  const explicitRoot = String(process.env.DC_PLATFORM_ROOT || "").trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  return path.join(os.homedir(), ".downcity");
}

/**
 * 返回平台级运行目录。
 *
 * 关键点（中文）
 * - 当前仅供本模块内部拼接平台级派生路径使用。
 * - 不再对外导出，避免暴露未被实际消费的路径 API。
 */
function getPlatformRuntimeDirPath(): string {
  return path.join(getPlatformRootDirPath(), "main");
}

/**
 * 返回平台级全局 SQLite 数据库路径。
 */
export function getPlatformStoreDbPath(): string {
  return path.join(getPlatformRootDirPath(), "downcity.db");
}

/**
 * 返回平台级数据库密钥文件路径。
 *
 * 关键点（中文）
 * - 这里沿用现有 `city` 的默认密钥位置，保证账号密钥读写格式一致。
 */
export function getPlatformStoreKeyPath(): string {
  return path.join(getPlatformRuntimeDirPath(), "model-db.key");
}
