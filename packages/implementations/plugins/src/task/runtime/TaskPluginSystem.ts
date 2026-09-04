/**
 * TaskPluginSystem：task plugin 的 system prompt 模块。
 *
 * 关键点（中文）
 * - task plugin prompt 属于静态资产。
 * - 当前直接从 TS 常量导出，避免运行时文件系统依赖。
 */
export { TASK_PLUGIN_PROMPT } from "@/task/runtime/TaskPromptAssets.js";
