/**
 * RPC SDK session handlers。
 *
 * 关键点（中文）
 * - 只处理 `sdk.sessions.*` 方法。
 * - 这些方法是 RemoteAgent RPC transport 的稳定 SDK 面。
 */

import type { RpcRequest } from "@/city/transport/types/RpcProtocol.js";
import type {
  RpcSocketSubscription,
  RpcWriteEvent,
  RpcWriteSuccess,
  RpcRequestHandlerOptions,
} from "@/city/transport/rpc/server/ServerTypes.js";
import { resolve_remote_session_set_input } from "@/city/transport/session/RemoteSessionConfig.js";

/**
 * 处理 SDK session RPC 请求。
 */
export async function handle_sdk_session_rpc_request(params: {
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
  const session_context = options.workspace ? { workspace: options.workspace } : undefined;
  const get_session = async (session_id: string, origin_type?: string) =>
    await options.sessions.get(session_id, origin_type, session_context);

  switch (request.method) {
    case "sdk.sessions.list": {
      const page = await options.sessions.list({
        ...request.params,
        ...(options.workspace ? { workspace_id: options.workspace.id } : {}),
      });
      write_success(request.id, { page });
      return true;
    }
    case "sdk.sessions.create": {
      const session = await options.sessions.create({
        ...request.params,
        ...(options.workspace ? { workspace: options.workspace } : {}),
      });
      write_success(request.id, { session: await session.get_info() });
      return true;
    }
    case "sdk.sessions.get": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      write_success(request.id, { session: await session.get_info() });
      return true;
    }
    case "sdk.sessions.prompt": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      const turn = await session.prompt(request.params.input);
      write_success(request.id, { turn: { id: turn.id } });
      return true;
    }
    case "sdk.sessions.stop": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      const result = await session.stop();
      write_success(request.id, { result });
      return true;
    }
    case "sdk.sessions.compact": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      const compact = await session.compact();
      write_success(request.id, { compact: { id: compact.id } });
      return true;
    }
    case "sdk.sessions.messages": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      const messages = await session.messages(request.params.input);
      write_success(request.id, { messages });
      return true;
    }
    case "sdk.sessions.interactions": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      write_success(request.id, { interactions: await session.interactions() });
      return true;
    }
    case "sdk.sessions.status": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      write_success(request.id, { status: await session.status() });
      return true;
    }
    case "sdk.sessions.set": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      const input = await resolve_remote_session_set_input({
        config: request.params.input,
        resolve_session_model: options.resolve_session_model,
      });
      await session.set(input, request.params.options);
      write_success(request.id, { queued: true });
      return true;
    }
    case "sdk.sessions.respond": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      write_success(request.id, {
        result: await session.respond(request.params.input),
      });
      return true;
    }
    case "sdk.sessions.system": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      write_success(request.id, { system: await session.system() });
      return true;
    }
    case "sdk.sessions.fork": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
      const forked = await session.fork(request.params.message_id ? {
        message_id: request.params.message_id,
        include_message: request.params.include_message,
      } : undefined);
      write_success(request.id, { session: await forked.get_info() });
      return true;
    }
    case "sdk.sessions.subscribe": {
      const session = await get_session(request.params.session_id, request.params.origin_type);
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
      await get_session(request.params.session_id, request.params.origin_type);
      const result = await options.sessions.archive({
        id: request.params.session_id,
        origin_type: request.params.origin_type,
      });
      write_success(request.id, { result });
      return true;
    }
    case "sdk.sessions.archived.list": {
      const page = await options.sessions.archived({
        ...request.params,
        ...(options.workspace ? { workspace_id: options.workspace.id } : {}),
      });
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
