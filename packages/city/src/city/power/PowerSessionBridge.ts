/**
 * Agent Session 集合到 Power Session 端口的边界适配。
 *
 * 关键点（中文）
 * - Power 只看到 `PowerSessionCollection`；知道 Agent Session API 的只有这里。
 * - 适配发生在容器边界，因此 Power 层不引用 Agent 实现包。
 * - Workspace 由 City 在调用点注入，Power 不自行解析。
 */

import type { AgentSession, AgentSessionCollection, SessionPort } from "@downcity/agent";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type {
  PowerJsonObject,
  PowerSessionCollection,
  PowerSessionHandle,
  PowerSessionMutation,
  PowerSessionOrigin,
} from "@/power/index.js";

/** 把 Agent Session 集合收窄为 Power 可调用的端口。 */
export function create_power_session_collection(input: {
  /** 延迟读取当前 Agent 的 Session 集合。 */
  readonly get_sessions: () => AgentSessionCollection;
  /** 当前调用所属的 Workspace。 */
  readonly workspace: WorkspaceRuntime;
}): PowerSessionCollection {
  const read_sessions = (): AgentSessionCollection => input.get_sessions();

  /** 由 Session runtime 端口构造 Power 可调用的稳定句柄。 */
  const to_handle = (
    session_id: string,
    origin: PowerSessionOrigin,
    workspace_id: string | undefined,
  ): PowerSessionHandle => {
    const runtime: SessionPort = read_sessions().runtime(session_id, origin.type);
    return Object.freeze({
      id: session_id,
      origin,
      ...(workspace_id ? { workspace_id } : {}),
      prompt: async (prompt_input) => await runtime.prompt(prompt_input),
      stop: async () => await runtime.stop() as unknown as PowerJsonObject,
      subscribe: (subscriber) => runtime.subscribe((mutation) =>
        subscriber(mutation as unknown as PowerSessionMutation)),
      messages: async () => await runtime.messages() as unknown as PowerJsonObject[],
      append_agent_message: async (message_input) =>
        await runtime.append_agent_message(message_input),
    });
  };

  /** 按来源 Session 复制模型选择；来源未配置模型时保持默认。 */
  const inherit_model = async (
    session: AgentSession,
    source?: { readonly session_id: string; readonly origin_type?: string },
  ): Promise<void> => {
    if (!source) return;
    const source_session = await read_sessions().get(
      source.session_id,
      source.origin_type,
      { workspace: input.workspace },
    );
    if (!source_session.config.model) return;
    await session.set(
      { model: source_session.config.model },
      { persist_action: false, publish_mutation: false },
    );
  };

  return Object.freeze({
    create: async (create_input) => {
      const session = await read_sessions().create({
        ...(create_input?.origin ? { origin: create_input.origin } : {}),
        workspace: input.workspace,
      });
      await inherit_model(session, create_input?.inherit_model_from);
      return to_handle(session.id, session.origin, session.workspace_id);
    },
    get: async (session_id, origin_type = "chat") => {
      const session = await read_sessions().get(session_id, origin_type, {
        workspace: input.workspace,
      });
      return to_handle(session.id, session.origin, session.workspace_id);
    },
    runtime: (session_id, origin_type = "chat") =>
      to_handle(session_id, { type: origin_type }, undefined),
    remove: async (session_id, origin_type) => {
      await read_sessions().get(session_id, origin_type, { workspace: input.workspace });
      return await read_sessions().remove(session_id, origin_type);
    },
  });
}
