/** Plugin Mainview 与宿主页面之间的消息协议。 */

import type { PluginJsonValue } from "./Json.js";

/** Mainview 发给宿主的 action 调用请求。 */
export interface PluginRendererInvokeRequest {
  /** 固定协议来源，用于拒绝无关 postMessage。 */
  readonly source: "downcity_plugin";

  /** 消息种类。 */
  readonly type: "invoke";

  /** 当前 Mainview 内唯一的请求 ID。 */
  readonly request_id: string;

  /** Plugin main 中注册的动作 ID。 */
  readonly action_id: string;

  /** 可选 JSON 输入。 */
  readonly input?: PluginJsonValue;
}

/** 宿主返回给 Mainview 的 action 调用结果。 */
export interface PluginRendererInvokeResponse {
  /** 固定协议来源，用于拒绝无关 postMessage。 */
  readonly source: "downcity_host";

  /** 消息种类。 */
  readonly type: "invoke_result";

  /** 对应请求 ID。 */
  readonly request_id: string;

  /** 调用是否成功完成。 */
  readonly success: boolean;

  /** 成功时返回的 JSON 结果。 */
  readonly result?: PluginJsonValue;

  /** 失败时返回的用户可见错误。 */
  readonly error?: string;
}

/** Mainview 使用的最小 action gateway。 */
export interface PluginRendererGateway {
  /** 调用当前 Plugin main 中的一个动作。 */
  invoke<Result extends PluginJsonValue = PluginJsonValue>(
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<Result>;
}
