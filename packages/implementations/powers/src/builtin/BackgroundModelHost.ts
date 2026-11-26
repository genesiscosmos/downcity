/**
 * 官方后台 Power 的可信模型适配器。
 * 从真实 City/Agent/Session SDK 读取已确认基线，核对 Town 当前身份和持久来源，
 * 执行会话继承 Agent 模型，任务领域只校验已确认的执行基线。不会从裸模型 ID 捕获当前账号，也不读取凭据。
 */
import { DeferredModelClient } from "@downcity/agent";
import type { City } from "@downcity/city";
import { same_model, type ModelClient } from "@downcity/type";
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
  const validate_model = async (model: Pick<ModelClient, "id" | "model_reference" | "binding_id"> | undefined): Promise<TaskModelBinding> => {
    if (!model?.model_reference || !model.binding_id) throw new Error("background_model_configuration_required: saved model and authorization binding are required");
    const city = get_city();
    city.town.models.client(model.model_reference, { binding_id: model.binding_id });
    const catalog = await city.town.models.list({ modality: "text" });
    const entry = catalog.items.find((item) => same_model(item.model, model.model_reference) && item.binding_id === model.binding_id);
    if (!entry?.durable) throw new Error("background_model_configuration_required: model requires an available durable Town source");
    // 目录读取期间账号可能变化；再次核对后才允许将该基线返回给调用方。
    const client = city.town.models.client(model.model_reference, { binding_id: model.binding_id });
    if (client.binding_id !== model.binding_id) throw new Error("background_model_binding_changed");
    return { model: model.model_reference, binding_id: model.binding_id };
  };

  /** 只解析 Agent 已定义的客户端，不使用 Task/Job 基线创建另一份执行模型。 */
  const resolve_model = async (model: ModelClient | undefined): Promise<ModelClient | undefined> => {
    const seen = new Set<ModelClient>();
    while (model instanceof DeferredModelClient) {
      if (seen.has(model)) throw new Error("Circular execution Agent model");
      seen.add(model);
      model = await model.resolve();
    }
    return model;
  };

  const read_task_model = async (target: TaskModelTarget): Promise<TaskModelBinding> => {
    const agent = require_agent(target.agent_id);
    const source = target.delivery_session;
    if (!source) return await validate_model(await resolve_model(agent.model));
    if (source.agent_id !== target.agent_id || source.workspace_id !== target.workspace_id) throw new Error("Task model source is outside the execution scope");
    const session = await agent.sessions.get(source.session_id, source.type);
    if ((session.workspace_id ?? null) !== source.workspace_id) throw new Error("Task model source Workspace changed");
    return await validate_model(await resolve_model(agent.model));
  };

  return {
    task: { read: read_task_model },
    memory: async (agent_id) => {
      const model = await resolve_model(require_agent(agent_id).model);
      return await validate_model(model);
    },
  };
}
