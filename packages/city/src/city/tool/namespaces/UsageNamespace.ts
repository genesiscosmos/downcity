/**
 * city tool `usage` namespace。
 *
 * 关键点（中文）
 * - 口径是 user 级 token 用量，属于 bureau 的能力；city tool 只做只读展示。
 * - 第一期 bureau 还没有暴露 user 级用量接口，因此统一返回 unsupported_action，不伪造数据。
 * - 只返回 token，不做额度与费用换算：那需要计价规则和账本，口径会随定价变化失效。
 */

import type {
  CityToolActionCall,
  CityToolNamespaceProvider,
} from "@/city/types/CityTool.js";
import { assert_known_args, read_optional_enum_arg } from "@/city/tool/CityToolArgs.js";
import {
  CityToolRuntimeError,
  unexpected_city_tool_action,
} from "@/city/tool/CityToolErrors.js";
import type { CityToolUsageScope } from "@/city/types/CityToolNamespaces.js";

/** `usage.get` 支持的查询范围。 */
const usage_scopes: readonly CityToolUsageScope[] = ["today", "month", "total"];

/** 说明当前缺失的依赖，帮助模型停止重试。 */
function unsupported_usage(): CityToolRuntimeError {
  return new CityToolRuntimeError({
    code: "unsupported_action",
    message:
      "User-level token usage is not available yet: this City tool reads it from bureau, "
      + "and bureau exposes no user usage API. Do not retry; tell the user usage is unavailable.",
    detail: { scope: usage_scopes },
  });
}

/** 创建 `usage` namespace provider。 */
export function create_usage_namespace(): CityToolNamespaceProvider {
  return {
    namespace: "usage",
    summary: "User-level token usage for this Downcity user.",
    actions: [
      {
        action: "get",
        summary: "Read the current user's token usage for a range.",
        args: [
          {
            name: "scope",
            type: "string",
            required: false,
            description: "Range to read: today, month or total. Defaults to today.",
          },
        ],
        returns: "scope, user_id, input_tokens, output_tokens, cached_tokens, total_tokens",
        capability: "read",
        sensitivity: "public",
      },
    ],
    handle: async (call: CityToolActionCall) => {
      switch (call.action) {
        case "get": {
          assert_known_args({ args: call.args, allowed: ["scope"], action: call.action });
          read_optional_enum_arg({
            args: call.args,
            name: "scope",
            allowed: usage_scopes,
            action: call.action,
          });
          throw unsupported_usage();
        }
        default:
          throw unexpected_city_tool_action({ namespace: "usage", action: call.action });
      }
    },
  };
}
