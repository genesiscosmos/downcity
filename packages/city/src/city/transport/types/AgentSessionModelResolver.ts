/**
 * Agent transport 的 Session 模型解析能力。
 *
 * Transport 只接收远程协议中的模型 ID；具体目录、鉴权和运行时模型创建由宿主实现。
 */

import type { ModelClient } from "@downcity/type";

/** 把宿主模型 ID 解析为 Agent 可执行模型实例。 */
export type AgentSessionModelResolver = (
  /** 远程调用方请求的宿主模型 ID。 */
  model_id: string,
  /** 调用方指定的非秘密授权来源；宿主必须核对并传入模型目录，不能忽略身份变化。 */
  binding_id?: string,
) => ModelClient | Promise<ModelClient>;
