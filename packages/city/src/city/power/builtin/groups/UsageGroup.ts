/**
 * city power `usage` 动作组。
 *
 * 关键点（中文）
 * - 口径是 user 级 token 用量，属于 bureau 的能力；city power 只做只读展示。
 * - 第一期 bureau 还没有暴露 user 级用量接口，因此统一返回 unsupported_action，不伪造数据。
 * - 只返回 token，不做额度与费用换算：那需要计价规则和账本，口径会随定价变化失效。
 */

import type { CityToolUsageScope } from "@/city/types/CityPowerData.js";
import { CityAction, CityActionError } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { z } from "zod";

/** `usage.get` 支持的查询范围。 */
const usage_scopes = ["today", "month", "total"] as const satisfies readonly CityToolUsageScope[];

/** `usage.get` 的输入。 */
const get_usage_input = z.strictObject({
  /** Range to read: today, month or total. Defaults to today. */
  scope: z
    .enum(usage_scopes)
    .optional()
    .describe("Range to read: today, month or total. Defaults to today."),
});

/** 读取当前用户的 token 用量。 */
class GetUsageAction extends CityAction<z.infer<typeof get_usage_input>> {
  readonly action = "get";
  readonly description = "Read the current user's token usage for a range.";
  readonly returns = "scope, user_id, input_tokens, output_tokens, cached_tokens, total_tokens";
  readonly args_schema = get_usage_input;

  protected async run(): Promise<never> {
    throw new CityActionError({
      code: "unsupported_action",
      message:
        "User-level token usage is not available yet: this City power reads it from bureau, "
        + "and bureau exposes no user usage API. Do not retry; tell the user usage is unavailable.",
      detail: { scope: usage_scopes },
    });
  }
}

/** `usage` 动作组。 */
export class UsageGroup extends CityActionGroup {
  readonly group = "usage";
  readonly summary = "User-level token usage for this Downcity user.";
  protected readonly actions = [new GetUsageAction()];
}
