/** CLI 模型选择统一读取 Town 目录；同名模型保留各自来源和身份绑定。 */
import type { TownModelEntry, TownModelList } from "@downcity/city";
import { call_cli_town } from "../../resources/TownClient.js";

/** CLI 选择项保留 Town 目录元数据，不构造当前 Federation。 */
export interface PlatformModelChoice {
  /** 显示模型名称与来源，帮助区分同名模型。 */
  title: string;
  /** Town 统一模型 ID，作为不透明字符串持久化。 */
  value: string;
  /** 来自 Town 的精确目录条目和非秘密身份绑定。 */
  model: TownModelEntry;
}

/** 通过运行中 owner 或独占离线 Town 获取所有文本模型。 */
export async function listPlatformModelChoices(): Promise<PlatformModelChoice[]> {
  const result = await call_cli_town("town.models") as TownModelList;
  return result.items.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)))
    .map((model) => ({ title: `${model.name || model.original_model_id} · ${model.source_name}`, value: model.model_id, model }));
}

/** 裸 ID 和缺失来源要求用户显式选择目录条目，不猜测某一 Downtown。 */
export async function assertPlatformModelReady(model_id: string): Promise<void> {
  if (!(await listPlatformModelChoices()).some((choice) => choice.value === model_id)) throw new Error("Model requires explicit selection from city downtown models");
}
