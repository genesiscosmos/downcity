/**
 * 官方后台 Power 的可信模型适配器。
 * 从真实 City/Agent/Session SDK 读取已确认基线，核对 Town 当前身份和持久来源，
 * 并通过 Session.set 保存执行模型。不会从裸模型 ID 捕获当前账号，也不读取凭据。
 */
import type { City } from "@downcity/city";
import type { ModelClient } from "@downcity/type";
import type { TaskModelBinding, TaskModelHost, TaskModelTarget } from "../task/types/TaskModelBinding.js";
import type { MemoryModelResolver } from "../memory/types/MemoryModelBinding.js";

/** 两个后台领域复用同一份 SDK 身份校验；各领域仍持有自己的基线存储。 */
export interface BackgroundModelHost {
  /** Task 创建/确认时读取，以及执行器和评审器的持久绑定端口。 */
  task: TaskModelHost;
  /** 新 Memory Job 提交时读取的默认/明确配置模型基线。 */
  memory: MemoryModelResolver;
}

/** 构造时只保存 City getter，允许 Power 注册早于 City 和 Agent 的装配。 */
export function create_background_model_host(get_city: () => City): BackgroundModelHost {
  const require_agent = (agent_id: string) => {
    const agent = get_city().agents.get(agent_id);
    if (!agent) throw new Error(`Background model Agent unavailable: ${agent_id}`);
    return agent;
  };

  /** 必须已有 binding；目录只核对持久性与可用性，不能为未知历史提供新身份。 */
  const validate_model = async (model: Pick<ModelClient, "id" | "binding_id"> | undefined): Promise<TaskModelBinding> => {
    if (!model?.id || !model.binding_id) throw new Error("background_model_configuration_required: saved model and authorization binding are required");
    const city = get_city();
    city.town.models.client(model.id, { binding_id: model.binding_id });
    const catalog = await city.town.models.list({ modality: "text" });
    const entry = catalog.items.find((item) => item.model_id === model.id && item.binding_id === model.binding_id);
    if (!entry?.durable) throw new Error("background_model_configuration_required: model requires an available durable Town source");
    // 目录读取期间账号可能变化；再次核对后才允许将该基线返回给调用方。
    const client = city.town.models.client(model.id, { binding_id: model.binding_id });
    if (client.binding_id !== model.binding_id) throw new Error("background_model_binding_changed");
    return { model_id: model.id, binding_id: model.binding_id };
  };

  const read_task_model = async (target: TaskModelTarget): Promise<TaskModelBinding> => {
    const agent = require_agent(target.agent_id);
    const source = target.delivery_session;
    if (!source) return await validate_model(agent.model);
    if (source.agent_id !== target.agent_id || source.workspace_id !== target.workspace_id) throw new Error("Task model source is outside the execution scope");
    const session = await agent.sessions.get(source.session_id, source.type);
    if ((session.workspace_id ?? null) !== source.workspace_id) throw new Error("Task model source Workspace changed");
    return await validate_model(session.get("model"));
  };

  return {
    task: {
      read: read_task_model,
      bind: async (target, session_id, binding) => {
        const agent = require_agent(target.agent_id);
        const session = await agent.sessions.get(session_id, "work");
        if (session.workspace_id !== target.workspace_id) throw new Error("Task execution Session is outside its Workspace");
        await validate_model({ id: binding.model_id, binding_id: binding.binding_id });
        const current = await read_task_model(target);
        if (current.model_id !== binding.model_id || current.binding_id !== binding.binding_id) throw new Error("task_model_binding_changed: explicit confirmation is required");
        const model = get_city().town.models.client(binding.model_id, { binding_id: binding.binding_id });
        await session.set({ model }, { persist_action: false, publish_mutation: false });
      },
    },
    memory: async (access, model_id) => {
      // 专用配置 pair 由 Coordinator 直接使用。只有 model_id 时，必须能证明它就是
      // Agent 已确认的默认模型；不能按配置裸 ID 去捕获此刻 Town 的计费账号。
      const model = require_agent(access.agent_id).model;
      if (model_id !== undefined && model?.id !== model_id) throw new Error("memory_model_configuration_required: configured model needs an explicitly saved binding");
      return await validate_model(model);
    },
  };
}
