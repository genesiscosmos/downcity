/**
 * TaskPromptAssets：task power 静态提示词资产。
 *
 * 关键点（中文）
 * - task prompt 文本真实来源是 `PROMPT.ts.txt`。
 * - 这里统一做 `trim()`，保持 power system 文本行为稳定。
 */

import taskPowerPromptText from "@/task/PROMPT.js";

/**
 * task power 固定 system prompt 文本。
 */
export const TASK_POWER_PROMPT = taskPowerPromptText.trim();
