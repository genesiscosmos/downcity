/**
 * City 本地状态类型。
 *
 * 关键点（中文）
 * - 只描述 City 自己保存的 Federation 与 session 索引。
 * - `city` CLI 的 admin 配置只作为弱发现来源读取。
 */

import type { CityUserSession } from "@/city/types/CitySession.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";

/**
 * `city` CLI admin 配置文件结构。
 */
export interface CityAdminConfig {
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

    /**
     * admin secret key。
     */
    admin_secret_key?: unknown;
  }>;
}

/**
 * City 本地保存的 Federation。
 */
export interface CityLocalProfile {
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
 * City 本地保存的 City user 连接状态。
 */
export interface CityLocalState {
  /**
   * 当前选择的 Federation URL。
   */
  selected_federation_url?: string;

  /**
   * 当前持久化的 CLI 语言。
   */
  cli_locale?: CliLocale;

  /**
   * City 本地保存的 Federation 列表。
   */
  profiles?: CityLocalProfile[];

  /**
   * 按 City base URL 索引的 user session。
   */
  sessions?: Record<string, CityUserSession>;
}
