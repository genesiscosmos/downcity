/**
 * Downcity 本地配置类型。
 *
 * 关键点（中文）
 * - 只描述 Downcity 保存的 Federation 与 Embassy Session 索引。
 * - Federation 管理员配置只作为弱发现来源读取。
 */

import type { EmbassyUserSession } from "@/city/types/EmbassySession.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";

/**
 * Federation 管理员配置结构。
 */
export interface FederationAdminConfig {
  /**
   * `downfed` admin 当前激活的 Federation URL。
   */
  active_server_url?: unknown;

  /**
   * `downfed` admin 保存的 Federation 列表。
   */
  servers?: Array<{
    /**
     * base 展示名称。
     */
    name?: unknown;

    /**
     * `downfed` 当前结构中的 Federation URL 字段。
     */
    base_url?: unknown;

    /** 管理员 Session Token。 */
    admin_session_token?: unknown;
    /** 管理员 Session 到期时间。 */
    admin_session_expires_at?: unknown;
  }>;
}

/**
 * Downcity 本地保存的 Federation。
 */
export interface DowncityFederationProfile {
  /**
   * base 展示名称。
   */
  name: string;

  /**
   * Federation URL。
   */
  federation_url: string;
}

/**
 * Downcity 本地配置。
 */
export interface DowncityConfig {
  /**
   * 当前选择的 Federation URL。
   */
  selected_federation_url?: string;

  /**
   * 当前持久化的 CLI 语言。
   */
  cli_locale?: CliLocale;

  /**
   * Downcity 本地保存的 Federation 列表。
   */
  profiles?: DowncityFederationProfile[];

  /**
   * 按 Federation URL 索引的 Embassy User Session。
   */
  sessions?: Record<string, EmbassyUserSession>;
}
