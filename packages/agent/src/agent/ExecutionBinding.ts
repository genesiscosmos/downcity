/**
 * Agent 执行绑定解析与校验模块。
 *
 * 职责说明（中文）
 * - 统一负责从宿主传入的 Agent 配置中读取执行目标定义。
 * - 负责提供最小的存在性判断、主模型读取与错误断言，避免调用方重复解析结构。
 * - 让初始化、配置装配、运行时启动都复用同一套执行目标解释规则。
 *
 * 边界说明（中文）
 * - 这里只解析配置结构，不负责验证模型是否真实存在于 City AIService 中。
 * - 当前只接受 agent 包已经落地支持的执行绑定格式。
 */

import type { DowncityConfig } from "@/types/config/DowncityConfig.js";
import type { ExecutionBindingConfig } from "@/types/config/ExecutionBinding.js";

/**
 * 读取项目执行绑定。
 *
 * 关键点（中文）
 * - 当前只接受 `execution.type = "api"` 且存在非空 `modelId` 的配置。
 * - 若结构不满足最小要求，则返回 `null`，由调用方决定是兜底还是报错。
 */
export function readProjectExecutionBinding(
  config: DowncityConfig,
): ExecutionBindingConfig | null {
  const execution = config.execution;
  if (!execution || typeof execution !== "object") return null;
  if (execution.type !== "api") return null;
  const modelId = String(execution.modelId || "").trim();
  if (!modelId) return null;
  return {
    type: "api",
    modelId,
  };
}

/**
 * 断言项目已经声明执行目标。
 *
 * 关键点（中文）
 * - 适合在配置加载完成后的早期阶段调用，尽早暴露缺失执行目标的问题。
 * - 失败时抛出稳定错误文案，便于 CLI 和上层界面直接展示。
 */
export function assertProjectExecutionTarget(config: DowncityConfig): void {
  if (readProjectExecutionBinding(config) !== null) return;
  throw new Error(
    'Invalid Agent config: "execution" is required and must be { "type": "api", "modelId": "..." }',
  );
}
