/**
 * RemoteAgent plugin action 类型。
 *
 * 关键点（中文）
 * - RemoteAgent 是远程 runtime 的瘦客户端，因此这里只描述远程调用协议。
 * - 业务 action 的具体 payload 与 data 由目标 plugin 自己定义。
 */

import type { JsonValue } from "@/types/common/Json.js";
import type { PluginActionResult } from "@/types/plugin/PluginAction.js";

/**
 * RemoteAgent 远程 plugin action 调用输入。
 */
export interface RemoteAgentPluginActionInput {
  /**
   * 目标 plugin 名称。
   *
   * 示例：`shell`、`chat`、`task`。
   */
  plugin: string;

  /**
   * 目标 action 名称。
   *
   * 示例：`approve`、`deny`、`send`。
   */
  action: string;

  /**
   * 传给目标 action 的 JSON payload。
   *
   * shell approval 示例：`{ "approvalId": "ap_xxx" }`。
   */
  payload?: JsonValue;
}

/**
 * RemoteAgent 远程 plugin action 调用结果。
 */
export type RemoteAgentPluginActionResult =
  PluginActionResult<JsonValue> & {
    /**
     * Runtime 回传的 plugin 名称。
     */
    plugin_name?: string;

    /**
     * Runtime 回传的 action 名称。
     */
    action_name?: string;
  };
