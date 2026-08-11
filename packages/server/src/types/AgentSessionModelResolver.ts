/**
 * Agent Server 的 Session 模型解析能力。
 *
 * Server 只接收远程协议中的模型 ID；具体目录、鉴权和运行时模型创建由宿主实现。
 */

import type { AgentModel } from "@downcity/agent";

/** 把宿主模型 ID 解析为 Agent 可执行模型实例。 */
export type AgentSessionModelResolver = (
  /** 远程调用方请求的宿主模型 ID。 */
  model_id: string,
) => AgentModel | Promise<AgentModel>;
