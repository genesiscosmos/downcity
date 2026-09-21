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
import type { PowerLogger } from "@/power/types/PowerContext.js";
import type { PowerCallScope } from "@/power/types/PowerRuntime.js";
import { create_denied_interaction_port } from "@/power/core/PowerActionInteraction.js";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type { SessionInteractionPort } from "@downcity/type";
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
  readonly logger: PowerLogger;
  /** City 可选 Embassy。 */
  readonly embassy?: Embassy;
  /** 当前 Power 可选通知端口。 */
  readonly notifications?: PowerNotificationPublisher;
  /** 当前 Agent 的 Session 集合端口，由 City 在调用点投影。 */
  readonly sessions: PowerSessionCollection;
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
  const sessions = input.sessions;
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
    // 调用身份由 `create_power_action_context` 在进入 Action 时注入；
    // 未进入调用的读取（如 system / availability）得到空身份。
    call: EMPTY_POWER_CALL_SCOPE,
    abort_signal: abort_controller.signal,
  });
}

/** 未进入具体调用时使用的空调用身份。 */
const EMPTY_POWER_CALL_SCOPE: PowerCallScope = Object.freeze({
  id: "",
  interactions: create_denied_interaction_port("power context"),
  snapshot: Object.freeze({}),
});

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

/**
 * 为一次 Action 调用投影直接可通信的 Session、Turn 句柄与执行面。
 *
 * 关键点（中文）
 * - 嵌套调用另一个 power 时沿用同一执行面：同一个 Session 身份与交互/审批端口。
 * - 因此 `run_action` 被包装为默认携带当前调用的快照与端口，组合 power 不会丢掉交互能力。
 */
export function create_power_action_context(
  context: PowerContext,
  call: PowerCallScope,
): PowerContext {
  const session_id = String(call.snapshot.session_id || "").trim();
  const turn_id = String(call.snapshot.turn_id || "").trim();
  const origin = call.snapshot.session_origin;
  const session = session_id && origin
    ? create_session_handle(
        context.agent.sessions,
        session_id,
        origin,
        context.workspace.id,
      )
    : undefined;
  const nested_snapshot: PowerExecutionContext = Object.freeze({
    ...(session_id ? { session_id } : {}),
    ...(origin ? { session_origin: origin } : {}),
    ...(turn_id ? { turn_id } : {}),
    abort_signal: call.snapshot.abort_signal,
  });
  const abort_signal = call.snapshot.abort_signal ?? context.abort_signal;
  return Object.freeze({
    ...context,
    city: Object.freeze({
      ...context.city,
      powers: Object.freeze({
        ...context.city.powers,
        run_action: async (action_input) =>
          await context.city.powers.run_action({
            ...action_input,
            execution_context: action_input.execution_context ?? nested_snapshot,
            ...(action_input.interactions ?? call.interactions
              ? { interactions: action_input.interactions ?? call.interactions }
              : {}),
          }),
      }),
    }),
    call,
    ...(session ? { session } : {}),
    ...(turn_id ? { turn: Object.freeze({ id: turn_id, abort_signal }) } : {}),
    abort_signal,
  });
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
