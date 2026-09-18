/**
 * TaskPowerSystem：task power 的 system prompt 模块。
 *
 * 关键点（中文）
 * - task power prompt 属于静态资产。
 * - 当前直接从 TS 常量导出，避免运行时文件系统依赖。
 */
export { TASK_POWER_PROMPT } from "@/task/runtime/TaskPromptAssets.js";
