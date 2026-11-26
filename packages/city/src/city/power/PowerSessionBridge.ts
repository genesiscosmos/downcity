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
import { session_address_schema, session_archive_input, session_archive_result, session_list_input, session_metadata_schema, session_page_schema, session_title_input } from "@/power/types/PowerSessionManagement.js";
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
  /** 只允许当前 Power 选择自己登记的约束。 */
  readonly assert_execution_profile?: (id: string, version: number) => void;
}): PowerSessionCollection {
  const read_sessions = (): AgentSessionCollection => input.get_sessions();

  return Object.freeze<PowerSessionCollection>({
    list: async (query = {}) => {
      const page = await read_sessions().list(session_list_input.parse(query));
      return session_page_schema.parse({ ...page, items: page.items.map(item => ({ ...item, archived: false })) });
    },
    metadata: async (address) => {
      const { session_id, type } = session_address_schema.parse(address);
      const sessions = read_sessions();
      const [view] = await sessions.read_metadata([{ session_id, type }]);
      if (!view) throw new Error("session_not_found");
      return session_metadata_schema.parse({ ...view.metadata, id: view.session_id, archived: view.archived,
        executing: sessions.list_executing_session_ids().includes(session_id) });
    },
    rename: async (input) => {
      const { session_id, type } = session_address_schema.parse({ session_id: input.session_id, type: input.type });
      const sessions = read_sessions();
      const [view] = await sessions.read_metadata([{ session_id, type }]);
      if (!view) throw new Error("session_not_found");
      if (view.archived) throw new Error("permission_denied: archived Session cannot be renamed");
      const session = await sessions.get(session_id, type);
      return { title: await session.rename(session_title_input.parse({ title: input.title }).title) };
    },
    archive: async (input) => {
      const { session_id, type, operation_id, root_session_id } = session_archive_input.parse(input);
      try {
        return session_archive_result.parse({ ...await read_sessions().archive({ id: session_id, type, operation_id, root_session_id }), status: "archived" });
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "session_archive_incomplete") throw error;
        // Worker 的异常通道只保留文本；固定计划的恢复标识必须通过结果通道传递。
        return session_archive_result.parse({ ...error, status: "incomplete", session_id, error: error.message });
      }
    },
    create: async (create_input) => {
      if (create_input?.execution_profile) {
        if (!input.assert_execution_profile) throw new Error("execution_profile_unavailable");
        const profile = create_input.execution_profile;
        input.assert_execution_profile(profile.id, profile.version);
        const session = await read_sessions().create_execution_session({
          ...normalize_session_descriptor(create_input), workspace: input.workspace, workspace_id: input.workspace?.id,
          execution_profile_id: profile.id, execution_profile_version: profile.version,
        });
        return create_power_session_handle(read_sessions().runtime(session.id, session.type));
      }
      const session = await read_sessions().create({
        type: create_input?.type,
        kind: create_input?.kind,
        parent: create_input?.parent,
        workspace: input.workspace,
      });
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
