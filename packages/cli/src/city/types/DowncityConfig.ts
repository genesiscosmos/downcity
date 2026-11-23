/**
 * Downcity 本地配置类型。
 *
 * 关键点（中文）
 * - 只描述 Downcity 保存的 Downtown 与 Downtown Session 索引。
 * - Downtown 管理员配置只作为弱发现来源读取。
 */

import type { DowntownUserSession } from "@/city/types/DowntownSession.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";

/**
 * Downtown 管理员配置结构。
 */
export interface DowntownAdminConfig {
  /**
   * `downtown` admin 保存的 Downtown 列表。
   */
  servers?: Array<{
    /**
     * base 展示名称。
     */
    name?: unknown;

    /**
     * `downtown` 当前结构中的 Downtown URL 字段。
     */
    base_url?: unknown;

    /** 管理员 Session Token。 */
    admin_session_token?: unknown;
    /** 管理员 Session 到期时间。 */
    admin_session_expires_at?: unknown;
  }>;
}

/**
 * Downcity 本地保存的 Downtown。
 */
export interface DowncityDowntownProfile {
  /**
   * base 展示名称。
   */
  name: string;

  /**
   * Downtown URL。
   */
  downtown_url: string;
}

/**
 * Downcity 本地配置。
 */
export interface DowncityConfig {
  /**
   * 当前选择的 Downtown URL。
   */
  selected_downtown_url?: string;

  /**
   * 当前持久化的 CLI 语言。
   */
  cli_locale?: CliLocale;

  /**
   * Downcity 本地保存的 Downtown 列表。
   */
  profiles?: DowncityDowntownProfile[];

  /**
   * 按 Downtown URL 索引的 Downtown User Session。
   */
  sessions?: Record<string, DowntownUserSession>;
}
