/**
 * RPC request dispatcher。
 *
 * 关键点（中文）
 * - server.ts 不直接包含业务 switch，只负责把已解析请求交给这里。
 * - dispatcher 按命名空间分发，避免 SDK 与 downcity internal 方法混在一起。
 */

import type { RpcRequest } from "@/transport/types/RpcProtocol.js";
import type {
  RpcRequestHandlerOptions,
  RpcSocketSubscription,
  RpcWriteError,
  RpcWriteEvent,
  RpcWriteSuccess,
} from "@/transport/rpc/server/ServerTypes.js";
import { handleSdkSessionRpcRequest } from "@/transport/rpc/server/SdkSessionHandlers.js";
import { handleInternalRpcRequest } from "@/transport/rpc/server/InternalHandlers.js";

/**
 * 分发并执行单个 RPC 请求。
 */
export async function dispatchRpcRequest(params: {
  /** 当前 RPC 请求。 */
  request: RpcRequest;
  /** handler 依赖。 */
  options: RpcRequestHandlerOptions;
  /** 当前 socket 的订阅表。 */
  subscriptions: Map<string, RpcSocketSubscription>;
  /** 成功帧写入函数。 */
  write_success: RpcWriteSuccess;
  /** 失败帧写入函数。 */
  write_error: RpcWriteError;
  /** 事件帧写入函数。 */
  write_event: RpcWriteEvent;
}): Promise<void> {
  const {
    request,
    options,
    subscriptions,
    write_success,
    write_error,
    write_event,
  } = params;

  try {
    const handled_by_sdk = await handleSdkSessionRpcRequest({
      request,
      options,
      subscriptions,
      write_success,
      write_event,
    });
    if (handled_by_sdk) return;

    const handled_by_internal = await handleInternalRpcRequest({
      request,
      options,
      write_success,
    });
    if (handled_by_internal) return;

    throw new Error(`Unsupported RPC method: ${request.method}`);
  } catch (error) {
    write_error(request.id, error);
  }
}
