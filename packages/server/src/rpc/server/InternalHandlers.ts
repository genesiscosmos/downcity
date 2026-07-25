/**
 * RPC internal handlers。
 *
 * 关键点（中文）
 * - 只处理 `internal.*` 方法。
 * - 这些方法服务 downcity 本机管理通道，不属于 RemoteAgent 的用户 SDK 面。
 * - Session 与 Plugin 数据通过 Agent 能力操作，不读取领域内部路径。
 */

import type { SystemModelMessage } from "ai";
import type { Agent } from "@downcity/agent";
import type { RpcRequest } from "@/types/RpcProtocol.js";
import type {
  RpcRequestHandlerOptions,
  RpcWriteSuccess,
} from "@/rpc/server/ServerTypes.js";
import { parse_plugin_command_request_body } from "@downcity/agent";

/**
 * 处理 internal RPC 请求。
 */
export async function handleInternalRpcRequest(params: {
  /** 当前 RPC 请求。 */
  request: RpcRequest;
  /** handler 依赖。 */
  options: RpcRequestHandlerOptions;
  /** 成功帧写入函数。 */
  write_success: RpcWriteSuccess;
}): Promise<boolean> {
  const { request, options, write_success } = params;

  switch (request.method) {
    case "internal.status.get": {
      const context = requireAgent(options);
      write_success(request.id, {
        status: "ok",
        pid: process.pid,
        project_root: context.workspace.path,
        instance_id: String(process.env.DOWNCITY_DAEMON_INSTANCE_ID || "").trim(),
      });
      return true;
    }
    case "internal.sessions.clear_messages": {
      const context = requireAgent(options);
      const session_id = String(request.params.session_id || "").trim();
      if (!session_id) throw new Error("Missing session_id");
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
      const result = await context.plugins.run_action({
        plugin: "chat",
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
        profile: "chat",
      });
      write_success(request.id, {
        session_id: session_id,
        ...toSystemPromptPayload(system_messages),
      });
      return true;
    }
    case "internal.plugins.catalog": {
      const context = requireAgent(options);
      write_success(request.id, {
        plugins: context.plugins.list(),
      });
      return true;
    }
    case "internal.plugins.list": {
      const context = requireAgent(options);
      write_success(request.id, {
        plugins: context.list_plugin_states(),
      });
      return true;
    }
    case "internal.plugins.control": {
      const context = requireAgent(options);
      const result = await context.control_plugin_state({
        plugin_name: request.params.plugin_name,
        action: request.params.action,
      });
      write_success(request.id, result);
      return true;
    }
    case "internal.plugins.command": {
      const context = requireAgent(options);
      const body = parse_plugin_command_request_body(request.params);
      const result = await context.run_plugin_command({
        plugin_name: body.plugin_name,
        command: body.command,
        payload: body.payload,
        schedule: body.schedule,
      });
      write_success(request.id, result);
      return true;
    }
    case "internal.plugins.availability": {
      const context = requireAgent(options);
      const availability = await context.plugins.availability(
        request.params.plugin_name,
      );
      write_success(request.id, {
        plugin_name: request.params.plugin_name,
        availability,
      });
      return true;
    }
    case "internal.plugins.action": {
      const context = requireAgent(options);
      const result = await context.plugins.run_action({
        plugin: request.params.plugin_name,
        action: request.params.action_name,
        payload: request.params.payload,
      });
      write_success(request.id, {
        ...result,
        plugin_name: request.params.plugin_name,
        action_name: request.params.action_name,
      });
      return true;
    }
    default:
      return false;
  }
}

function requireAgent(options: RpcRequestHandlerOptions): Agent {
  const context = options.get_agent?.();
  if (!context) {
    throw new Error("Agent RPC server was started without Agent");
  }
  return context;
}

function normalizeSystemText(input: string | null | undefined): string {
  return String(input || "").trim();
}

function toSystemMessageText(message: SystemModelMessage): string {
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
function toSystemPromptPayload(messages: SystemModelMessage[]): {
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
