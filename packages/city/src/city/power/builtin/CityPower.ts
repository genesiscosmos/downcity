/**
 * City Power：Agent 触碰 City 的具名 power。
 *
 * 关键点（中文）
 * - 继承 `Power` 基类，与其它 power 同构；`name` 即模型侧工具名 `city`。
 * - 动作 id 是点号形式（`env.get`、`image.create`），由动作组拼成；
 *   模型只看到一层 action，不再有 method 概念。
 * - City 内部事实源（Agent / Workspace 快照）与 Embassy 由构造期注入，
 *   不进入通用 `PowerContext`，因此外部 power 拿不到这些能力。
 * - 动作组私有文件按 Agent + 组隔离，不跨组共享。
 * - 动作 id 在构造期一次性展开，注册后不再变化。
 */

import { resolve_runtime_timezone } from "@downcity/type";
import type { Embassy } from "@downcity/federation";
import type {
  PowerAction,
  PowerActions,
  PowerContext,
  PowerJsonObject,
  PowerJsonValue,
} from "@/power/index.js";
import { Power } from "@/power/index.js";
import type { FileSystem } from "@/workspace/index.js";
import type { CityRuntimeAccess } from "@/city/types/CityRuntimeAccess.js";
import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import { CityActionError } from "@/city/power/builtin/CityAction.js";
import type { AnyCityAction } from "@/city/power/builtin/CityAction.js";
import type { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { create_city_action_groups } from "@/city/power/builtin/groups/index.js";

/** City Power 创建参数。 */
export interface CityPowerOptions {
  /** City 内部事实源访问面；city power 只读 Agent 与 Workspace 快照。 */
  readonly access: Pick<CityRuntimeAccess, "list_agents" | "list_workspaces">;
  /** 按 Agent 与动作组分配私有文件端口。 */
  readonly files_for: (agent_id: string, group_id: string) => FileSystem;
  /** City 持有的 Federation Embassy；未配置时省略。 */
  readonly embassy?: Embassy;
}

/** City 自有 power：把动作组装配为一个模型可见工具。 */
export class CityPower extends Power {
  /** Power 稳定名称，即模型侧工具名。 */
  readonly name = "city";

  /** Power 用户可见标题。 */
  readonly title = "City";

  /** Power 用途说明。 */
  readonly description =
    "The single entry point for City capabilities: read-only runtime facts and City-owned "
    + "capabilities such as image generation and speech.";

  /** 当前 power 的动作组集合。 */
  private readonly groups: readonly CityActionGroup[];

  /** 构造期一次性展开的动作集合，键为点号 action id。 */
  readonly actions: PowerActions;

  constructor(private readonly options: CityPowerOptions) {
    super();
    this.groups = create_city_action_groups();
    const actions: PowerActions = {};
    for (const group of this.groups) {
      for (const action of group.action_list()) {
        const action_id = `${group.group}.${action.action}`;
        actions[action_id] = to_power_action({
          action_id,
          group_id: group.group,
          action,
          options,
        });
      }
    }
    this.actions = actions;
  }

  /** 合并全部动作组的说明文本。 */
  system(): string {
    return this.groups
      .map((group) => String(group.system() || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
}

/** 把一个组内动作适配为通用 `PowerAction`。 */
function to_power_action(input: {
  /** 对模型可见的点号动作 id。 */
  readonly action_id: string;
  /** 所属动作组名，同时是私有文件分区。 */
  readonly group_id: string;
  /** 组内动作本体。 */
  readonly action: AnyCityAction;
  /** City 注入的特权依赖。 */
  readonly options: CityPowerOptions;
}): PowerAction {
  const json_schema = input.action.args_schema
    ? to_json_schema(input.action.args_schema)
    : null;
  return {
    description: input.action.description,
    returns: input.action.returns,
    access: input.action.access,
    ...(input.action.args_schema
      ? {
          input_schema: {
            zod: input.action.args_schema,
            ...(json_schema ? { json_schema } : {}),
          },
        }
      : {}),
    async execute(params) {
      const context = build_city_context(
        {
          action_id: input.action_id,
          group_id: input.group_id,
          power_context: params.context,
        },
        input.options,
      );
      try {
        const data = await input.action.execute(params.input ?? {}, context);
        return {
          success: true,
          data: (data === undefined ? null : data) as PowerJsonValue,
          message: `${input.action_id} completed`,
        };
      } catch (error) {
        if (error instanceof CityActionError) {
          return {
            success: false,
            error: error.message,
            message: error.message,
            ...(error.detail ? { data: error.detail as PowerJsonValue } : {}),
          };
        }
        return {
          success: false,
          error: String(error),
          message: String(error),
        };
      }
    },
  };
}

/**
 * 从通用 PowerContext 组装 city 动作上下文。
 *
 * 关键点（中文）
 * - 调用身份统一读 `power_context.call`，不再有第二个参数与兜底链。
 * - Session / Turn 句柄取 `PowerContext.session`，与 `call.session` 同一来源。
 */
function build_city_context(
  input: {
    /** 当前动作 id。 */
    readonly action_id: string;
    /** 当前动作组 id。 */
    readonly group_id: string;
    /** 注册表投影的通用上下文。 */
    readonly power_context: PowerContext;
  },
  options: CityPowerOptions,
): CityPowerContext {
  const { power_context } = input;
  const agents = options.access.list_agents();
  const workspaces = options.access.list_workspaces();
  const agent = agents.find((item) => item.id === power_context.agent.id);
  const workspace = workspaces.find((item) => item.id === power_context.workspace.id);
  const abort_signal = power_context.abort_signal;
  return {
    action_id: input.action_id,
    agent_id: power_context.agent.id,
    agent_name: power_context.agent.name,
    session_id: power_context.session?.id ?? null,
    turn_id: power_context.turn?.id ?? null,
    workspace_id: power_context.workspace.id,
    workspace_name: workspace?.name || power_context.workspace.id,
    workspace_path: power_context.workspace.path,
    model_id: agent?.model?.id ?? null,
    timezone: resolve_runtime_timezone(),
    now: new Date(),
    sandbox: power_context.workspace.shell?.describe_sandbox() ?? null,
    agents,
    workspaces,
    files: options.files_for(power_context.agent.id, input.group_id),
    call_id: power_context.call.id,
    interactions: power_context.call.interactions,
    ...(options.embassy ? { embassy: options.embassy } : {}),
    ...(abort_signal ? { abort_signal } : {}),
  };
}

/** 尽力把 Zod schema 转为 JSON Schema；失败时返回 null。 */
function to_json_schema(schema: unknown): PowerJsonObject | null {
  const candidate = schema as { toJSONSchema?: () => unknown } | null;
  if (!candidate || typeof candidate.toJSONSchema !== "function") return null;
  try {
    const value = candidate.toJSONSchema();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as PowerJsonObject;
  } catch {
    return null;
  }
}
