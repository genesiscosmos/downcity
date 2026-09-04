/**
 * SkillPromptAssets：skill plugin 静态提示词资产。
 *
 * 关键点（中文）
 * - skill prompt 文本真实来源是 `PROMPT.ts.txt`。
 * - 这里统一做 `trim()`，避免 prompt 裁剪规则散落到运行时逻辑。
 */

import skillPromptText from "@/skill/PROMPT.js";

/**
 * skill plugin 稳定提示词。
 */
export const SKILL_PLUGIN_PROMPT = skillPromptText.trim();
