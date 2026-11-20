/**
 * Agent Session 集合到 Power Session 端口的边界适配。
 *
 * 关键点（中文）
 * - Power 只看到 `PowerSessionCollection`；知道 Agent Session API 的只有这里。
 * - 适配发生在容器边界，因此 Power 层不引用 Agent 实现包。
 * - Workspace 由 City 在调用点注入，Power 不自行解析。
 */

import { SESSION_TYPE_WORK, normalize_session_descriptor } from "@downcity/type";
import type { AgentSession, AgentSessionCollection, SessionPort } from "@downcity/agent";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type {
  PowerJsonObject,
  PowerSessionCollection,
  PowerSessionHandle,
  PowerSessionMutation,
} from "@/power/index.js";

/** 由实际 Session runtime 投影供 Power 使用的操作和创建描述。 */
export function create_power_session_handle(runtime: SessionPort): PowerSessionHandle {
  return Object.freeze<PowerSessionHandle>({
    id: runtime.id,
    ...normalize_session_descriptor(runtime),
    ...(runtime.workspace_id ? { workspace_id: runtime.workspace_id } : {}),
    prompt: async (input) => await runtime.prompt(input),
    stop: async () => await runtime.stop() as unknown as PowerJsonObject,
    subscribe: (subscriber) => runtime.subscribe((mutation) =>
      subscriber(mutation as unknown as PowerSessionMutation)),
    messages: async () => await runtime.messages() as unknown as PowerJsonObject[],
    append_agent_message: async (input) => await runtime.append_agent_message(input),
  });
}

/** 把 Agent Session 集合收窄为 Power 可调用的端口。 */
export function create_power_session_collection(input: {
  /** 延迟读取当前 Agent 的 Session 集合。 */
  readonly get_sessions: () => AgentSessionCollection;
  /** 当前调用所属的 Workspace；无项目会话时为空。 */
  readonly workspace?: WorkspaceRuntime;
}): PowerSessionCollection {
  const read_sessions = (): AgentSessionCollection => input.get_sessions();

  /** 按来源 Session 复制模型选择；来源未配置模型时保持默认。 */
  const inherit_model = async (
    session: AgentSession,
    source?: { readonly session_id: string; readonly type?: string },
  ): Promise<void> => {
    if (!source) return;
    const source_session = await read_sessions().get(
      source.session_id,
      source.type,
      { workspace: input.workspace },
    );
    const source_model = source_session.get("model");
    if (!source_model) return;
    await session.set(
      { model: source_model },
      { persist_action: false, publish_mutation: false },
    );
  };

  return Object.freeze({
    create: async (create_input) => {
      const session = await read_sessions().create({
        type: create_input?.type,
        kind: create_input?.kind,
        parent: create_input?.parent,
        workspace: input.workspace,
      });
      await inherit_model(session, create_input?.inherit_model_from);
      return create_power_session_handle(read_sessions().runtime(session.id, session.type));
    },
    get: async (session_id, type = SESSION_TYPE_WORK) => {
      const session = await read_sessions().get(session_id, type, {
        workspace: input.workspace,
      });
      return create_power_session_handle(read_sessions().runtime(session.id, session.type));
    },
    runtime: (session_id, type = SESSION_TYPE_WORK) =>
      create_power_session_handle(read_sessions().runtime(session_id, type)),
    remove: async (session_id, type) => {
      await read_sessions().get(session_id, type, { workspace: input.workspace });
      return await read_sessions().remove(session_id, type);
    },
  });
}
