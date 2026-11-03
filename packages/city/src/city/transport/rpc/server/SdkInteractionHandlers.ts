/**
 * Agent interactions RPC 协议适配。
 *
 * Agent 必须来自宿主已绑定的依赖，与 Session 集合保持同一主体。
 * 订阅由当前 socket 和 Agent 共同拥有；私密提交只调用原集合专用入口，
 * 失败时使用静态异常，避免 Dispatcher 或宿主日志收到包含答案的底层错误。
 */
import type { RpcRequest } from "@/city/transport/types/RpcProtocol.js";
import type { RpcRequestHandlerOptions, RpcSocketSubscription, RpcWriteEvent, RpcWriteSuccess } from "./ServerTypes.js";
import { validate_interaction_list_input, validate_interaction_response_input } from "@/remote/InteractionValidation.js";

/** 校验订阅控制信封，不允许混入 Agent 身份或其他字段。 */
function read_subscription_id(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => key !== "subscription_id")
    || !("subscription_id" in input) || typeof input.subscription_id !== "string" || !input.subscription_id.trim()) {
    throw new Error("Invalid Agent interaction subscription input");
  }
  return input.subscription_id;
}

/** 执行主体交互协议；其他命名空间交由后续 handler。 */
export async function handle_sdk_interaction_rpc_request(params: {
  /** 当前 socket 收到的已解析请求。 */ request: RpcRequest;
  /** 宿主绑定的请求依赖。 */ options: RpcRequestHandlerOptions;
  /** 当前 socket 独占的订阅表。 */ subscriptions: Map<string, RpcSocketSubscription>;
  /** 成功响应写入器。 */ write_success: RpcWriteSuccess;
  /** canonical 事件写入器。 */ write_event: RpcWriteEvent;
}): Promise<boolean> {
  const { request, options, subscriptions, write_success, write_event } = params;
  if (!request.method.startsWith("sdk.interactions.")) return false;
  const agent = options.agent ?? options.get_agent_context?.().agent;
  if (!agent || agent.sessions !== options.sessions || (request.agent_id !== undefined && request.agent_id !== agent.id)) {
    throw new Error("Agent interactions require a matching bound Agent");
  }
  switch (request.method) {
    case "sdk.interactions.list":
      write_success(request.id, { interactions: await agent.interactions.list(validate_interaction_list_input(request.params)) });
      return true;
    case "sdk.interactions.subscribe": {
      const subscription_id = read_subscription_id(request.params);
      if (subscriptions.has(subscription_id)) throw new Error("Subscription already exists");
      const unsubscribe = agent.interactions.subscribe((event) => {
        write_event({ type: "interaction-event", subscription_id, event });
      });
      subscriptions.set(subscription_id, { interaction_agent_id: agent.id, session_id: "", unsubscribe });
      write_success(request.id, { subscription_id });
      return true;
    }
    case "sdk.interactions.unsubscribe": {
      const subscription_id = read_subscription_id(request.params);
      const subscription = subscriptions.get(subscription_id);
      if (subscription) {
        if (subscription.interaction_agent_id !== agent.id) throw new Error("Interaction subscription belongs to another scope");
        subscription.unsubscribe();
        subscriptions.delete(subscription_id);
      }
      write_success(request.id, { unsubscribed: true });
      return true;
    }
    case "sdk.interactions.respond":
      write_success(request.id, { result: await agent.interactions.respond(validate_interaction_response_input(request.params)) });
      return true;
    case "sdk.interactions.submit_private": {
      try {
        const input = validate_interaction_response_input(request.params);
        write_success(request.id, { result: await agent.interactions.submit_private(input) });
      } catch {
        throw new Error("Private Agent interaction submission failed");
      }
      return true;
    }
    default:
      throw new Error("Unsupported Agent interactions RPC method");
  }
}
