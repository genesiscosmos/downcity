/**
 * PowerContext 构造。
 *
 * 关键点（中文）
 * - 本模块只做「把已解析的值装成一个 PowerContext」，不做反查、不分配存储。
 *   反查与分配属于容器职责，由 `PowerRuntimeHost` 实现者完成。
 * - 活值（Workspace env、Agent instruction）通过 getter 延迟读取，与快照语义区分。
 * - 嵌套 power 调用沿用本次调用的来源身份，因此组合 power 不会丢掉交互能力。
 */

import type { Embassy } from "@downcity/federation";
import type { FileSystem, WorkspaceRuntime, WorkspaceShell } from "@/workspace/index.js";
import type {
  PowerJsonObject,
  PowerJsonValue,
  PowerNotificationPublisher,
  PowerSessionCollection,
  PowerSessionHandle,
  PowerSessionOrigin,
} from "@/power/index.js";
import type { PowerLogger } from "@/power/types/PowerContext.js";
import type { PowerCall } from "@/power/types/PowerCall.js";
import type { PowerCallSite, PowerRuntimeHost } from "@/power/types/PowerCallSite.js";
import type { StepSnapshot } from "@/power/types/StepSnapshot.js";
import { PowerContext } from "@/power/types/PowerContext.js";

/** PowerContext 构造输入；全部字段都已由容器解析完成。 */
export interface CreatePowerContextInput {
  /** 容器运行时端口；用于 `city.powers` 的嵌套调用与查询。 */
  readonly host: PowerRuntimeHost;
  /** 本次调用的来源身份；嵌套调用沿用它。 */
  readonly site: PowerCallSite;
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
  /** 当前 Workspace 运行时引用。 */
  readonly workspace: WorkspaceRuntime;
  /** 当前 Power 私有数据根路径。 */
  readonly data_path: string;
  /** 当前 Power 私有数据文件端口。 */
  readonly data_files: FileSystem;
  /** 当前 Workspace 可选 Shell。 */
  readonly shell?: WorkspaceShell;
  /** 当前 Agent 的 Session 集合端口。 */
  readonly sessions: PowerSessionCollection;
  /** 当前调用所属 Session 句柄；非 Session 调用时为空。 */
  readonly session?: PowerSessionHandle;
  /** 当前调用所属 Turn 句柄；非 Turn 调用时为空。 */
  readonly turn?: PowerContext["turn"];
  /** 本步冻结的事实。 */
  readonly snapshot: StepSnapshot;
  /** 本次调用的身份与执行面。 */
  readonly call: PowerCall;
  /** 当前 Power 业务配置。 */
  readonly config: PowerJsonObject;
  /** 当前执行范围日志器。 */
  readonly logger: PowerLogger;
  /** City 可选 Embassy。 */
  readonly embassy?: Embassy;
  /** 当前 Power 通知端口。 */
  readonly notifications?: PowerNotificationPublisher;
  /** 延迟读取 Workspace env；读当前值，与快照不同。 */
  readonly get_workspace_env: () => Readonly<Record<string, string>>;
  /** 延迟读取 Agent instruction；读当前值，与快照不同。 */
  readonly get_instructions: () => readonly string[];
}

/** 把已解析的值装成一次调用的 PowerContext。 */
export function create_power_context(input: CreatePowerContextInput): PowerContext {
  return new PowerContext({
    city: {
      ...(input.embassy ? { embassy: input.embassy } : {}),
      powers: input.host.powers_for(input.site),
    },
    agent: {
      id: input.agent_id,
      name: String(input.agent_name || input.agent_id).trim() || input.agent_id,
      description: String(input.agent_description || "").trim(),
      get instructions() {
        return input.get_instructions();
      },
      sessions: input.sessions,
    },
    workspace: {
      id: input.workspace_id,
      path: input.workspace_path,
      ...(input.shell ? { shell: input.shell } : {}),
      get env() {
        return input.get_workspace_env();
      },
    },
    ...(input.session ? { session: input.session } : {}),
    ...(input.turn ? { turn: input.turn } : {}),
    snapshot: input.snapshot,
    call: input.call,
    storage: { path: input.data_path, files: input.data_files },
    config: input.config,
    logger: input.logger,
    ...(input.notifications ? { notifications: input.notifications } : {}),
  });
}

/** 从 Session runtime 端口构造 Power 可调用的稳定句柄。 */
export function create_power_session_handle(
  runtime: PowerSessionHandle,
  session_id: string,
  origin: PowerSessionOrigin,
  workspace_id: string | undefined,
): PowerSessionHandle {
  return Object.freeze({
    ...(runtime as unknown as PowerSessionHandle),
    id: session_id,
    origin,
    ...(workspace_id ? { workspace_id } : {}),
  });
}

/** 深拷贝并冻结 Power 配置，避免调用方修改当前执行快照。 */
export function freeze_power_config(input: PowerJsonObject): PowerJsonObject {
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
