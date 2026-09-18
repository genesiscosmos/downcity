/**
 * City PowerContext 工厂。
 *
 * 该模块只把 City、Agent、Workspace、Session 与 Power 私有资源投影为
 * @downcity/city/power 定义的受限句柄，不复制领域对象的可变状态。
 */

import type { Embassy } from "@downcity/federation";
import type { FileSystem, WorkspaceRuntime, WorkspaceShell } from "@/workspace/index.js";
import type {
  PowerContext,
  PowerJsonObject,
  PowerJsonValue,
  PowerNotificationPublisher,
  PowerSessionCollection,
  PowerSessionHandle,
  PowerSessionMutation,
  PowerSessionOrigin,
} from "@/power/index.js";
import type { AgentSessionCollection, Logger } from "@downcity/agent";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type { PowerExecutionContext } from "@/power/index.js";

/** PowerContext 工厂输入。 */
export interface CreatePowerContextInput {
  /** 当前 Agent 稳定标识。 */
  readonly agent_id: string;
  /** 当前 Agent 用户可见名称。 */
  readonly agent_name?: string;
  /** 当前 Agent 能力描述。 */
  readonly agent_description?: string;
  /** 当前 Workspace 稳定标识。 */
  readonly workspace_id: string;
  /** 当前 Workspace 绝对根目录。 */
  readonly workspace_path: string;
  /** 当前 PowerContext 对应的 Workspace 运行时引用。 */
  readonly workspace: WorkspaceRuntime;
  /** 当前 Power 私有数据根路径。 */
  readonly data_path: string;
  /** 当前 Workspace 文件端口。 */
  readonly files: FileSystem;
  /** 当前 Power 私有数据文件端口。 */
  readonly data_files: FileSystem;
  /** 读取当前 Power 的 City 级业务配置。 */
  readonly get_config?: () => PowerJsonObject;
  /** 当前 Workspace 可选 Shell。 */
  readonly shell?: WorkspaceShell;
  /** 当前执行范围日志器。 */
  readonly logger: Logger;
  /** City 可选 Embassy。 */
  readonly embassy?: Embassy;
  /** 当前 Power 可选通知端口。 */
  readonly notifications?: PowerNotificationPublisher;
  /** 延迟读取当前 Workspace 绑定的 Session 集合。 */
  readonly get_sessions: () => AgentSessionCollection;
  /** 延迟读取 City 提供给当前 Agent 的 Power 执行面。 */
  readonly get_powers: () => AgentPowerRuntime;
  /** 延迟读取 Workspace env。 */
  readonly get_workspace_env: () => Readonly<Record<string, string>>;
  /** 延迟读取 Agent instruction。 */
  readonly get_instructions: () => readonly string[];
}

/** 创建一个不复制动态领域状态的 PowerContext。 */
export function create_power_context(input: CreatePowerContextInput): PowerContext {
  const abort_controller = new AbortController();
  const sessions = create_session_collection(input.get_sessions, input.workspace);
  // 配置只在 Context 创建检查点读取一次，确保同一次 Action、Hook、System 或
  // Availability 调用不会因并发保存而观察到中途变化。
  const config = freeze_json_object(input.get_config?.() ?? {});
  return Object.freeze({
    city: Object.freeze({
      ...(input.embassy ? { embassy: input.embassy } : {}),
      powers: Object.freeze({
        get: (power_id: string) => input.get_powers().get(power_id),
        snapshots: () => input.get_powers().snapshots(),
        run_action: async (action_input) => await input.get_powers().run_action(action_input),
        pipeline: async <TValue extends import("@/power/index.js").PowerJsonValue>(
          point_name: string,
          value: TValue,
        ) => await input.get_powers().pipeline(point_name, value) as TValue,
        effect: async <TValue extends import("@/power/index.js").PowerJsonValue>(
          point_name: string,
          value: TValue,
        ) => await input.get_powers().effect(point_name, value),
      }),
    }),
    agent: Object.freeze({
      id: input.agent_id,
      name: String(input.agent_name || input.agent_id).trim() || input.agent_id,
      description: String(input.agent_description || "").trim(),
      get instructions() {
        return input.get_instructions();
      },
      sessions,
    }),
    workspace: Object.freeze({
      id: input.workspace_id,
      path: input.workspace_path,
      files: input.files,
      ...(input.shell ? { shell: input.shell } : {}),
      get env() {
        return input.get_workspace_env();
      },
    }),
    storage: Object.freeze({
      path: input.data_path,
      files: input.data_files,
    }),
    config,
    logger: input.logger,
    ...(input.notifications ? { notifications: input.notifications } : {}),
    abort_signal: abort_controller.signal,
  });
}

/** 深拷贝并冻结 Power 配置，避免调用方修改当前执行快照。 */
function freeze_json_object(input: PowerJsonObject): PowerJsonObject {
  return freeze_json_value(structuredClone(input)) as PowerJsonObject;
}

/** 递归冻结一个 JSON 值。 */
function freeze_json_value(input: PowerJsonValue): PowerJsonValue {
  if (Array.isArray(input)) {
    return Object.freeze(input.map((value) => freeze_json_value(value))) as PowerJsonValue[];
  }
  if (input !== null && typeof input === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, freeze_json_value(value)]),
    )) as PowerJsonObject;
  }
  return input;
}

/** 为一次 Action 调用投影直接可通信的 Session 与 Turn 句柄。 */
export function create_power_action_context(
  context: PowerContext,
  execution_context: PowerExecutionContext,
  abort_signal: AbortSignal,
): PowerContext {
  const session_id = String(execution_context.session_id || "").trim();
  const turn_id = String(execution_context.turn_id || "").trim();
  const origin = execution_context.session_origin;
  const session = session_id && origin
    ? create_session_handle(
        context.agent.sessions,
        session_id,
        origin,
        context.workspace.id,
      )
    : undefined;
  return Object.freeze({
    ...context,
    ...(session ? { session } : {}),
    ...(turn_id ? { turn: Object.freeze({ id: turn_id, abort_signal }) } : {}),
    abort_signal,
  });
}

/** 把 AgentSessionCollection 收窄为 Power 可直接使用的集合端口。 */
function create_session_collection(
  get_sessions: () => AgentSessionCollection,
  workspace: WorkspaceRuntime,
): PowerSessionCollection {
  const collection: PowerSessionCollection = {
    create: async (input) => {
      const session = await get_sessions().create({
        ...(input?.origin ? { origin: input.origin } : {}),
        workspace,
      });
      if (input?.inherit_model_from) {
        const source = await get_sessions().get(
          input.inherit_model_from.session_id,
          input.inherit_model_from.origin_type,
          { workspace },
        );
        if (source.config.model) {
          await session.set(
            { model: source.config.model },
            { persist_action: false, publish_mutation: false },
          );
        }
      }
      return create_session_handle(
        collection,
        session.id,
        session.origin,
        session.workspace_id,
      );
    },
    get: async (session_id, origin_type = "chat") => {
      const session = await get_sessions().get(session_id, origin_type, { workspace });
      return create_session_handle(
        collection,
        session.id,
        session.origin,
        session.workspace_id,
      );
    },
    runtime: (session_id, origin_type = "chat") => create_session_handle(
      collection,
      session_id,
      { type: origin_type },
      undefined,
    ),
    remove: async (session_id, origin_type) => {
      await get_sessions().get(session_id, origin_type, { workspace });
      return await get_sessions().remove(session_id, origin_type);
    },
  };
  return Object.freeze(collection);

  function create_session_handle(
    _collection: PowerSessionCollection,
    session_id: string,
    origin: PowerSessionOrigin,
    workspace_id: string | undefined,
  ): PowerSessionHandle {
    const runtime = get_sessions().runtime(session_id, origin.type);
    return Object.freeze({
      id: session_id,
      origin,
      ...(workspace_id ? { workspace_id } : {}),
      prompt: async (prompt_input) => await runtime.prompt(prompt_input),
      stop: async () => await runtime.stop() as unknown as PowerJsonObject,
      subscribe: (subscriber) => runtime.subscribe((mutation) =>
        subscriber(mutation as unknown as PowerSessionMutation)),
      messages: async () => await runtime.messages() as unknown as import("@/power/index.js").PowerJsonObject[],
      append_agent_message: async (message_input) =>
        await runtime.append_agent_message(message_input),
    });
  }
}

/** 从已有 Power Session 集合创建当前 Action 的 Session 句柄。 */
function create_session_handle(
  sessions: PowerSessionCollection,
  session_id: string,
  origin: PowerSessionOrigin,
  workspace_id: string | undefined,
): PowerSessionHandle {
  const runtime = sessions.runtime(session_id, origin.type);
  return Object.freeze({
    ...runtime,
    id: session_id,
    origin,
    ...(workspace_id ? { workspace_id } : {}),
  });
}
