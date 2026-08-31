/**
 * Plugin Mainview 的浏览器侧 action gateway。
 *
 * Mainview 运行在独立 iframe 中，只能通过结构化 postMessage 调用宿主转发的 Plugin
 * main action。消息不携带 Plugin ID 或 Profile ID，身份由承载 iframe 的宿主页面绑定。
 */

import type { PluginJsonValue } from "./types/Json.js";
import type {
  PluginRendererGateway,
  PluginRendererInvokeRequest,
  PluginRendererInvokeResponse,
} from "./types/PluginRenderer.js";

/** 等待中的 Mainview action 请求。 */
const pending_requests = new Map<string, {
  /** 成功回调。 */
  resolve(value: PluginJsonValue): void;
  /** 失败回调。 */
  reject(reason: Error): void;
}>();

let request_sequence = 0;

/** 接收宿主对 action 调用的结构化响应。 */
function handle_host_message(event: MessageEvent<unknown>): void {
  if (event.source !== window.parent || !is_invoke_response(event.data)) return;
  const pending = pending_requests.get(event.data.request_id);
  if (!pending) return;
  pending_requests.delete(event.data.request_id);
  if (event.data.success) pending.resolve(event.data.result ?? null);
  else pending.reject(new Error(event.data.error || "Plugin action failed"));
}

window.addEventListener("message", handle_host_message);

/** 当前 Mainview 绑定的 Plugin action gateway。 */
export const plugin: PluginRendererGateway = {
  async invoke<Result extends PluginJsonValue = PluginJsonValue>(
    action_id_input: string,
    input?: PluginJsonValue,
  ): Promise<Result> {
    const action_id = String(action_id_input || "").trim();
    if (!action_id) throw new Error("Plugin action_id is required");
    const request_id = `${Date.now().toString(36)}_${(++request_sequence).toString(36)}`;
    const request: PluginRendererInvokeRequest = {
      source: "downcity_plugin",
      type: "invoke",
      request_id,
      action_id,
      ...(input !== undefined ? { input } : {}),
    };
    return await new Promise<Result>((resolve, reject) => {
      pending_requests.set(request_id, {
        resolve: (value) => resolve(value as Result),
        reject,
      });
      window.parent.postMessage(request, "*");
    });
  },
};

/** 判断未知消息是否为宿主 action 响应。 */
function is_invoke_response(value: unknown): value is PluginRendererInvokeResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Partial<PluginRendererInvokeResponse>;
  return response.source === "downcity_host"
    && response.type === "invoke_result"
    && typeof response.request_id === "string"
    && typeof response.success === "boolean";
}

export type {
  PluginRendererGateway,
  PluginRendererInvokeRequest,
  PluginRendererInvokeResponse,
} from "./types/PluginRenderer.js";
