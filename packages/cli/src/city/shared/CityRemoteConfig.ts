/**
 * CLI City 的远程发布配置。使用现有 platform_settings 保存非凭据设置，
 * 启动时读取快照；写入只修改配置，不负责监听、隧道或 daemon 生命周期。
 */
import type { LocalSettingRepository } from "@downcity/city/local";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";

import type { CityRemoteConfig } from "@/city/types/config/CityRemoteConfig.js";

/** 单条设置同时保存地址和来源，避免两个键之间的部分更新。 */
const remote_config_key = "city.remote";

/** 校验地址且不在异常中回显输入，避免无效 URL 中的凭据进入日志。 */
export function normalize_remote_url(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Invalid City connection address"); }
  if (url.href.length > 8192 || !/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.hostname.includes("*") || ["0.0.0.0", "[::]"].includes(url.hostname)) {
    throw new Error("City address requires HTTP/HTTPS and a concrete host, without credentials, query or fragment");
  }
  return url.toString().replace(/\/+$/, "");
}

/** 来源必须是精确 Origin；错误消息不包含用户输入。 */
export function normalize_remote_origin(value: string): string {
  normalize_remote_url(value);
  // 使用原始路径校验，不能让基础 URL 的尾斜线规范化吞掉 Origin 路径。
  const url = new URL(value.trim());
  if (url.pathname !== "/") throw new Error("Allowed origin must not include a path");
  return url.origin;
}

/** 读取并校验配置；损坏配置明确报错，避免静默扩大来源边界。 */
export function read_city_remote_settings(settings: LocalSettingRepository): CityRemoteConfig {
  const saved = settings.get<CityRemoteConfig>(remote_config_key);
  if (!saved) return { public_url: null, allowed_origins: [] };
  if ((saved.public_url !== null && typeof saved.public_url !== "string") || !Array.isArray(saved.allowed_origins) || saved.allowed_origins.some(origin => typeof origin !== "string")) {
    throw new Error("Invalid saved City remote configuration");
  }
  return {
    public_url: saved.public_url === null ? null : normalize_remote_url(saved.public_url),
    allowed_origins: [...new Set(saved.allowed_origins.map(normalize_remote_origin))],
  };
}

/** 短连接读取当前 root 的保存值，不从 daemon 启动参数推测公开地址。 */
export function read_city_remote_config(root_path: string): CityRemoteConfig {
  const data = create_cli_local_data(root_path);
  try { return read_city_remote_settings(data.settings); }
  finally { data.database.close(); }
}

/** 在一个事务内合并显式字段；调用方负责在写入前收集完整交互输入。 */
export function update_city_remote_config(root_path: string, update: Partial<CityRemoteConfig>): CityRemoteConfig {
  const data = create_cli_local_data(root_path);
  try {
    return data.database.transaction(() => {
      const config = { ...read_city_remote_settings(data.settings), ...update };
      const normalized = {
        public_url: config.public_url === null ? null : normalize_remote_url(config.public_url),
        allowed_origins: [...new Set(config.allowed_origins.map(normalize_remote_origin))],
      };
      data.settings.set(remote_config_key, normalized);
      return normalized;
    });
  } finally { data.database.close(); }
}
