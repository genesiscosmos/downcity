/**
 * city tool `usage` namespace。
 *
 * 关键点（中文）
 * - 口径是 user 级 token 用量，属于 bureau 的能力；city tool 只做只读展示。
 * - 第一期 bureau 还没有暴露 user 级用量接口，因此统一返回 unsupported_action，不伪造数据。
 * - 只返回 token，不做额度与费用换算：那需要计价规则和账本，口径会随定价变化失效。
 */

import type { CityToolUsageScope } from "@/city/types/CityToolNamespaces.js";
import { CityAction, string_arg, type CityToolArgs } from "@/city/tool/namespaces/CityAction.js";
import { CityNamespace } from "@/city/tool/namespaces/CityNamespace.js";
import { CityToolRuntimeError } from "@/city/tool/CityToolResult.js";

/** `usage.get` 支持的查询范围。 */
const usage_scopes: readonly CityToolUsageScope[] = ["today", "month", "total"];

/** 读取当前用户的 token 用量。 */
class GetUsageAction extends CityAction {
  readonly action = "get";
  readonly summary = "Read the current user's token usage for a range.";
  readonly returns = "scope, user_id, input_tokens, output_tokens, cached_tokens, total_tokens";
  readonly args = [
    string_arg("scope", "Range to read: today, month or total. Defaults to today.", false),
  ];

  protected async run(args: CityToolArgs): Promise<never> {
    this.optional_enum(args, "scope", usage_scopes);
    throw new CityToolRuntimeError({
      code: "unsupported_action",
      message:
        "User-level token usage is not available yet: this City tool reads it from bureau, "
        + "and bureau exposes no user usage API. Do not retry; tell the user usage is unavailable.",
      detail: { scope: usage_scopes },
    });
  }
}

/** `usage` namespace。 */
export class UsageNamespace extends CityNamespace {
  readonly namespace = "usage";
  readonly summary = "User-level token usage for this Downcity user.";
  protected readonly actions = [new GetUsageAction()];
}
