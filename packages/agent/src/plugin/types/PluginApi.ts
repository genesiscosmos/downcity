/**
 * plugin catalog / availability / action API 类型。
 *
 * 关键点（中文）
 * - 统一描述 downcity CLI -> Agent runtime 的 plugin 管理协议。
 * - 当前阶段支持 list / availability / action 三类调用。
 */

import type { JsonValue } from "@/types/common/Json.js";
import type {
  PluginAvailability,
  PluginView,
} from "@/types/plugin/PluginRuntime.js";

export type { PluginView } from "@/types/plugin/PluginRuntime.js";
export type PluginAvailabilityView = PluginAvailability;

/**
 * plugin catalog 响应。
 */
export interface PluginCatalogResponse {
  /**
   * 请求是否成功。
   */
  success: boolean;
  /**
   * Plugin 列表（可选）。
   */
  plugins?: PluginView[];
  /**
   * 错误信息（可选）。
   */
  error?: string;
}

/**
 * plugin availability 响应。
 */
export interface PluginAvailabilityResponse {
  /**
   * 请求是否成功。
   */
  success: boolean;
  /**
   * Plugin 名称（可选）。
   */
  plugin_name?: string;
  /**
   * Plugin 可用性视图（可选）。
   */
  availability?: PluginAvailabilityView;
  /**
   * 错误信息（可选）。
   */
  error?: string;
}

/**
 * plugin action 响应。
 */
export interface PluginActionResponse {
  /**
   * Action 是否成功。
   */
  success: boolean;
  /**
   * Plugin 名称（可选）。
   */
  plugin_name?: string;
  /**
   * Action 名称（可选）。
   */
  action_name?: string;
  /**
   * 返回数据（可选）。
   */
  data?: JsonValue;
  /**
   * 人类可读消息（可选）。
   */
  message?: string;
  /**
   * 错误信息（可选）。
   */
  error?: string;
}
