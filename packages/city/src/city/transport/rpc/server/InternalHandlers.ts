/**
 * RPC internal handlers。
 *
 * 关键点（中文）
 * - 只处理 `internal.*` 方法。
 * - 这些方法服务 downcity 本机管理通道，不属于 RemoteAgent 的用户 SDK 面。
 * - Session 与 Power 数据通过 Agent 能力操作，不读取领域内部路径。
 */

import type { SessionSystemMessage } from "@downcity/type";
import type { RpcRequest } from "@/city/transport/types/RpcProtocol.js";
import type {
  RpcRequestHandlerOptions,
  RpcAgentContext,
  RpcWriteSuccess,
} from "@/city/transport/rpc/server/ServerTypes.js";

/**
 * 处理 internal RPC 请求。
 */
export async function handle_internal_rpc_request(params: {
  /** 当前 RPC 请求。 */
  request: RpcRequest;
  /** handler 依赖。 */
  options: RpcRequestHandlerOptions;
  /** 成功帧写入函数。 */
  write_success: RpcWriteSuccess;
}): Promise<boolean> {
  const { request, options, write_success } = params;

  switch (request.method) {
    case "internal.city.status": {
      if (!options.get_city_status) {
        throw new Error("RPC host does not provide City status");
      }
      write_success(request.id, {
        status: "ok",
        pid: process.pid,
        agent_ids: options.get_city_status().agent_ids,
        instance_id: String(process.env.DOWNCITY_DAEMON_INSTANCE_ID || "").trim(),
      });
      return true;
    }
    case "internal.city.shutdown": {
      if (!options.shutdown_city) throw new Error("RPC host does not provide City shutdown");
      write_success(request.id, { accepted: true });
      setImmediate(() => void options.shutdown_city?.());
      return true;
    }
    case "internal.status.get": {
      const context = requireAgent(options);
      write_success(request.id, {
        status: "ok",
        pid: process.pid,
        agent_id: context.agent.id,
        workspace_id: context.workspace.id,
        workspace_path: context.workspace.path,
        instance_id: String(process.env.DOWNCITY_DAEMON_INSTANCE_ID || "").trim(),
      });
      return true;
    }
    case "internal.workspace.reload_env": {
      if (!options.reload_workspace_env) {
        throw new Error("Agent RPC host does not provide Workspace Env reload");
      }
      const env = await options.reload_workspace_env();
      write_success(request.id, {
        reloaded: true,
        key_count: Object.keys(env).length,
      });
      return true;
    }
    case "internal.sessions.clear_messages": {
      const context = requireAgent(options);
      const session_id = String(request.params.session_id || "").trim();
      if (!session_id) throw new Error("Missing session_id");
      await context.sessions.get(session_id, "chat", { workspace: context.workspace });
      await context.sessions.clear_messages(session_id);
      write_success(request.id, {
        session_id: session_id,
        cleared: true,
      });
      return true;
    }
    case "internal.sessions.clear_chat_history": {
      const context = requireAgent(options);
      const session_id = String(request.params.session_id || "").trim();
      if (!session_id) throw new Error("Missing session_id");
      const result = await context.powers.run_action({
        power: "chat",
        action: "history_clear",
        payload: { session_id: session_id },
      });
      if (!result.success) {
        throw new Error(result.error || result.message || "Chat history clear failed");
      }
      const data = result.data && typeof result.data === "object"
        ? result.data as { cleared?: unknown }
        : {};
      write_success(request.id, {
        session_id: session_id,
        cleared: data.cleared === true,
      });
      return true;
    }
    case "internal.sessions.resolve_system_prompt": {
      const context = requireAgent(options);
      const session_id =
        String(request.params.session_id || "").trim() || "consoleui-chat-main";
      const system_messages = await context.resolve_system_messages({
        session_id,
      });
      write_success(request.id, {
        session_id: session_id,
        ...toSystemPromptPayload(system_messages),
      });
      return true;
    }
    case "internal.powers.catalog": {
      const context = requireAgent(options);
      write_success(request.id, {
        powers: context.powers.list(),
      });
      return true;
    }
    case "internal.powers.list": {
      const context = requireAgent(options);
      write_success(request.id, {
        powers: context.list_power_states(),
      });
      return true;
    }
    case "internal.powers.availability": {
      const context = requireAgent(options);
      const availability = await context.powers.availability(
        request.params.power_name,
      );
      write_success(request.id, {
        power_name: request.params.power_name,
        availability,
      });
      return true;
    }
    case "internal.powers.action": {
      const context = requireAgent(options);
      const result = await context.powers.run_action({
        power: request.params.power_name,
        action: request.params.action_name,
        payload: request.params.payload,
      });
      write_success(request.id, {
        ...result,
        power_name: request.params.power_name,
        action_name: request.params.action_name,
      });
      return true;
    }
    default:
      return false;
  }
}

function requireAgent(options: RpcRequestHandlerOptions): RpcAgentContext {
  const context = options.get_agent_context?.();
  if (!context) {
    throw new Error("Agent RPC server was started without Agent");
  }
  return context;
}

function normalizeSystemText(input: string | null | undefined): string {
  return String(input || "").trim();
}

function toSystemMessageText(message: SessionSystemMessage): string {
  const content = message.content as unknown;
  if (typeof content === "string") return normalizeSystemText(content);
  if (!Array.isArray(content)) return "";
  const parts = content as Array<{ text?: unknown }>;
  const texts: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const text = normalizeSystemText(String(part.text || ""));
    if (!text) continue;
    texts.push(text);
  }
  return texts.join("\n").trim();
}

/**
 * 把 system messages 转成 Console/downcity 可直接渲染的结构。
 */
function toSystemPromptPayload(messages: SessionSystemMessage[]): {
  sections: Array<{
    key: string;
    title: string;
    items: Array<{ index: number; content: string }>;
  }>;
  total_messages: number;
  total_chars: number;
} {
  const items = messages
    .map((message, index) => ({
      index: index + 1,
      content: toSystemMessageText(message),
    }))
    .filter((item) => item.content);
  const total_chars = items.reduce(
    (acc, item) => acc + String(item.content || "").length,
    0,
  );
  return {
    sections: [
      {
        key: "resolved",
        title: "Resolved System Messages",
        items,
      },
    ],
    total_messages: items.length,
    total_chars,
  };
}
