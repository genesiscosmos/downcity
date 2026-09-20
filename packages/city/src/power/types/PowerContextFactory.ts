/**
 * Power 调用上下文工厂协议。
 *
 * 工厂只在调用发生时使用，不缓存 PowerContext。Agent 注入的 ToolCallContext 提供
 * 执行身份与 Workspace，City 在此之上补齐 storage、config、logger 等 City 侧句柄。
 */

import type { ToolCallContext } from "@downcity/type";
import type { PowerContext } from "./PowerContext.js";

/** 为一次具体调用创建指定 Power 的上下文。 */
export type PowerContextFactory = (
  /** 当前调用目标 Power 的稳定 ID。 */
  power_id: string,
  /** Agent 注入的工具调用环境。 */
  call_context: ToolCallContext,
) => PowerContext;
