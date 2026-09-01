/**
 * Federation 客户端模型类型。
 *
 * FederationModel 是带目录元数据的可执行 ModelClient；字符串只用于
 * 在需要序列化成 HTTP 请求时表达模型 ID。
 */

import type { CityModel } from "./CityModel.js";
import type { ModelCall } from "@downcity/type";

/** 可以传给 Federation action 的模型引用。 */
export type FederationModelInput = CityModel | string;

/** 语言模型流调用输入。 */
export interface FederationModelStreamInput {
  /** 要执行的 Federation 模型或模型 ID。 */
  model: FederationModelInput;
  /** 标准 Downcity 模型调用。 */
  call: ModelCall;
  /** 可选的取消信号。 */
  signal?: AbortSignal;
}
