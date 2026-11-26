/** CLI 模型选择统一读取 Town 目录；同名模型保留各自来源和身份绑定。 */
import { same_model, type ModelReference } from "@downcity/type";
import type { TownModelEntry, TownModelList } from "@downcity/city";
import { call_cli_town } from "../../resources/TownClient.js";

/** CLI 选择项保留 Town 目录元数据，不构造当前 Downtown。 */
export interface PlatformModelChoice {
  /** 显示模型名称与来源，帮助区分同名模型。 */
  title: string;
  /** 目录返回的结构化模型引用，可直接保存。 */
  value: ModelReference;
  /** 来自 Town 的精确目录条目和非秘密身份绑定。 */
  model: TownModelEntry;
}

/** 通过运行中 owner 或独占离线 Town 获取所有文本模型。 */
export async function listPlatformModelChoices(root?: string): Promise<PlatformModelChoice[]> {
  const result = await call_cli_town("town.models", {}, root) as TownModelList;
  return result.items.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)))
    .map((model) => ({ title: `${model.name || model.id} · ${model.source_name}`, value: model.model, model }));
}

/** 裸 ID 和缺失来源要求用户显式选择目录条目，不猜测某一 Downtown。 */
export async function assertPlatformModelReady(model_id: ModelReference): Promise<void> {
  if (!(await listPlatformModelChoices()).some((choice) => same_model(choice.value, model_id))) throw new Error("Model requires explicit selection from city towns models");
}

/** 命令行输入不承担路由编码；同名模型要求通过交互目录明确选择。 */
export async function resolve_platform_model_selection(id: string, root?: string): Promise<ModelReference> {
  const matches = (await listPlatformModelChoices(root)).filter((choice) => choice.model.id === id);
  if (matches.length !== 1) throw new Error(matches.length ? "Multiple Downtowns provide this model; select it from the model picker" : "Model is unavailable");
  return matches[0]!.value;
}
