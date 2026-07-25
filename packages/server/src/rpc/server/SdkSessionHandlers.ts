/**
 * RPC SDK session handlers。
 *
 * 关键点（中文）
 * - 只处理 `sdk.sessions.*` 方法。
 * - 这些方法是 RemoteAgent RPC transport 的稳定 SDK 面。
 */

import type { RpcRequest } from "@/types/RpcProtocol.js";
import type {
  RpcSocketSubscription,
  RpcWriteEvent,
  RpcWriteSuccess,
  RpcRequestHandlerOptions,
} from "@/rpc/server/ServerTypes.js";

/**
 * 处理 SDK session RPC 请求。
 */
export async function handleSdkSessionRpcRequest(params: {
  /** 当前 RPC 请求。 */
  request: RpcRequest;
  /** handler 依赖。 */
  options: RpcRequestHandlerOptions;
  /** 当前 socket 的订阅表。 */
  subscriptions: Map<string, RpcSocketSubscription>;
  /** 成功帧写入函数。 */
  write_success: RpcWriteSuccess;
  /** 事件帧写入函数。 */
  write_event: RpcWriteEvent;
}): Promise<boolean> {
  const { request, options, subscriptions, write_success, write_event } = params;

  switch (request.method) {
    case "sdk.sessions.list": {
      const page = await options.sessions.list(request.params);
      write_success(request.id, { page });
      return true;
    }
    case "sdk.sessions.create": {
      const session = await options.sessions.create(request.params);
      write_success(request.id, { session: await session.get_info() });
      return true;
    }
    case "sdk.sessions.get": {
      const session = await options.sessions.get(request.params.session_id);
      write_success(request.id, { session: await session.get_info() });
      return true;
    }
    case "sdk.sessions.prompt": {
      const session = await options.sessions.get(request.params.session_id);
      const turn = await session.prompt(request.params.input);
      write_success(request.id, { turn: { id: turn.id } });
      return true;
    }
    case "sdk.sessions.stop": {
      const session = await options.sessions.get(request.params.session_id);
      const result = await session.stop();
      write_success(request.id, { result });
      return true;
    }
    case "sdk.sessions.compact": {
      const session = await options.sessions.get(request.params.session_id);
      await session.compact();
      write_success(request.id, { queued: true });
      return true;
    }
    case "sdk.sessions.messages": {
      const session = await options.sessions.get(request.params.session_id);
      const messages = await session.messages(request.params.input);
      write_success(request.id, { messages });
      return true;
    }
    case "sdk.sessions.approvals": {
      const session = await options.sessions.get(request.params.session_id);
      write_success(request.id, { approvals: await session.approvals() });
      return true;
    }
    case "sdk.sessions.approvalMode": {
      const session = await options.sessions.get(request.params.session_id);
      write_success(request.id, { approval_mode: await session.approval_mode() });
      return true;
    }
    case "sdk.sessions.setApprovalMode": {
      const session = await options.sessions.get(request.params.session_id);
      write_success(request.id, {
        approval_mode: await session.set_approval_mode(request.params.input),
      });
      return true;
    }
    case "sdk.sessions.resolveApproval": {
      const session = await options.sessions.get(request.params.session_id);
      write_success(request.id, {
        result: await session.resolve_approval(request.params.input),
      });
      return true;
    }
    case "sdk.sessions.system": {
      const session = await options.sessions.get(request.params.session_id);
      write_success(request.id, { system: await session.system() });
      return true;
    }
    case "sdk.sessions.fork": {
      const session = await options.sessions.get(request.params.session_id);
      const forked = await session.fork(request.params.message_id);
      write_success(request.id, { session: await forked.get_info() });
      return true;
    }
    case "sdk.sessions.subscribe": {
      const session = await options.sessions.get(request.params.session_id);
      const subscription_id = [
        request.params.session_id,
        Date.now(),
        Math.random().toString(36).slice(2, 10),
      ].join(":");
      const unsubscribe = session.subscribe((event) => {
        write_event({
          type: "event",
          subscription_id: subscription_id,
          event,
        });
      });
      subscriptions.set(subscription_id, {
        session_id: request.params.session_id,
        unsubscribe,
      });
      write_success(request.id, { subscription_id: subscription_id });
      return true;
    }
    case "sdk.sessions.unsubscribe": {
      const subscription = subscriptions.get(request.params.subscription_id);
      if (subscription) {
        subscription.unsubscribe();
        subscriptions.delete(request.params.subscription_id);
      }
      write_success(request.id, { unsubscribed: true });
      return true;
    }
    case "sdk.sessions.archive": {
      const result = await options.sessions.archive({
        id: request.params.session_id,
      });
      write_success(request.id, { result });
      return true;
    }
    case "sdk.sessions.archived.list": {
      const page = await options.sessions.archived(request.params);
      write_success(request.id, { page });
      return true;
    }
    case "sdk.sessions.archived.clean": {
      const result = await options.sessions.clean_archive();
      write_success(request.id, { removed_session_ids: result.removed_session_ids });
      return true;
    }
    default:
      return false;
  }
}
