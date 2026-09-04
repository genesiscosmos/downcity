/**
 * TaskPromptAssets：task plugin 静态提示词资产。
 *
 * 关键点（中文）
 * - task prompt 文本真实来源是 `PROMPT.ts.txt`。
 * - 这里统一做 `trim()`，保持 plugin system 文本行为稳定。
 */

import taskPluginPromptText from "@/task/PROMPT.js";

/**
 * task plugin 固定 system prompt 文本。
 */
export const TASK_PLUGIN_PROMPT = taskPluginPromptText.trim();
