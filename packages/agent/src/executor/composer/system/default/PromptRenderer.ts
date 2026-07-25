/**
 * PromptRenderer：system prompt 消息渲染器。
 *
 * 关键点（中文）
 * - 负责文本 prompt -> system message 的转换能力。
 * - 变量替换下沉到 `session/composer/system/default/variables/VariableReplacer`。
 * - 不关注具体 prompt 来源（静态/服务/运行时）。
 */

import { type SystemModelMessage } from "ai";
import {
  replace_variables_in_prompts,
  type PromptVariableMode,
} from "@executor/composer/system/default/variables/VariableReplacer.js";

/**
 * 将纯文本 prompts 转为 `system` messages。
 *
 * 关键点（中文）
 * - 自动过滤空串并执行变量替换。
 */
export async function transform_prompts_into_system_messages(
  prompts: string[],
  options?: {
    /**
     * 项目路径（用于模板变量）。
     */
    projectPath?: string;

    /**
     * 会话 ID（用于模板变量）。
     */
    session_id?: string;

    /**
     * 变量替换模式。
     *
     * 关键点（中文）
     * - `full`：替换全部变量（含时间/位置）。
     * - `stable`：仅保留稳定变量，易变变量替换为稳定占位文本。
     */
    variableMode?: PromptVariableMode;
  },
): Promise<SystemModelMessage[]> {
  const nonEmptyPrompts = prompts.filter((item) => item.length > 0);
  return Promise.all(
    nonEmptyPrompts.map(async (item) => ({
      role: "system" as const,
      content: await replace_variables_in_prompts(item, options),
    })),
  );
}
