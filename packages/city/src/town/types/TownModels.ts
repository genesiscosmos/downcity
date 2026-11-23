/** Town 统一模型目录、直接客户端和多模态执行契约。 */
import type { CityModelDescriptor, DowntownModelReference, ModelClient } from "@downcity/type";
import type { DowntownUser } from "@downcity/downtown";
import type { TownExecutionOptions, TownSourceStatus } from "./Town.js";

/** City 的可读目录项；model_id 是可持久化的不透明引用。 */
export interface TownModelEntry extends Omit<CityModelDescriptor, "id"> {
  /** 不需要解析的来源与模型原始 ID。 */
  model: DowntownModelReference;
  /** City 来源明确的统一模型字符串 ID。 */
  model_id: string;
  /** 原始 SDK/远端模型 ID；只发给原来源，不用于跨来源查找。 */
  original_model_id: string;
  /** 远端服务或扩展直接模型。 */
  source_kind: "downtown" | "client";
  /** Downtown connection_id 或直接模型稳定 source_id。 */
  source_id: string;
  /** 来源可读名称，不影响路由。 */
  source_name: string;
  /** 当前身份的非秘密绑定，恢复执行时必须传回。 */
  binding_id: string;
  /** 是否有宿主持久托管的来源。 */
  durable: boolean;
}

/** 一次聚合读取保留每个失败来源。 */
export interface TownModelList {
  /** 所有成功来源的模型条目；不合并同名模型。 */
  items: TownModelEntry[];
  /** 各 Downtown 的读取状态。直接模型是本地条目，不产生网络状态。 */
  sources: TownSourceStatus[];
}

/** 扩展直接 ModelClient 登记参数；只声明实际支持的文本能力。 */
export interface TownDirectModelRegistration {
  /** 扩展/宿主的稳定条目标识，重复登记必须失败。 */
  source_id: string;
  /** 底层客户端，id 不会被 Town 改写。 */
  client: ModelClient;
  /** 可选来源名称，用于模型选择器。 */
  name?: string;
  /** 来源可在重启后恢复时显式声明；宿主仍负责保存注册。 */
  durable?: boolean;
}

/** 多模态调用固定模型路由，input 中不能再提供 model 或 model_id。 */
export interface TownModelRequest<T> extends TownExecutionOptions {
  /** 结构化的 Downtown 与原始模型 ID。 */
  model?: DowntownModelReference;
  /** 旧的内部目录键；新的 Agent/Session 路径使用 model。 */
  model_id?: string;
  /** 原模态请求的业务字段；model 由 Town 唯一注入。 */
  input: T;
}

/** 删除路由字段，并恢复 TS 索引签名会掩盖的必要语义由运行时再次检查。 */
export type TownDecisionInput = Omit<Parameters<DowntownUser["ai"]["decision"]>[0], "model">;
/** 图片业务输入，目标模型来自外层 model_id。 */
export type TownImageInput = Omit<Parameters<DowntownUser["ai"]["image_create"]>[0], "model">;
/** 语音合成业务输入。 */
export type TownTtsInput = Omit<Parameters<DowntownUser["ai"]["tts"]>[0], "model">;
/** 语音识别业务输入。 */
export type TownAsrInput = Omit<Parameters<DowntownUser["ai"]["asr"]>[0], "model">;
