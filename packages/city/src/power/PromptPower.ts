/**
 * 将本地 City 已拥有的 Power 导出为请求级能力。
 * 执行仍经过提供方 Power runtime，不复制 City 上下文到远端或跳过宿主装配。
 */
import { z } from "zod";
import type { PromptPower, PromptPowerCallContext } from "@downcity/type";
import type { PowerDefinition } from "./types/PowerRuntime.js";
import type { PowerRuntimeHost, PowerCallSite } from "./types/PowerCallSite.js";

/**
 * 显式导出已有 Power；resolve_site 由调用方把远端身份映射到本地主体与资源权限。
 * instruction 是本轮使用指令，不自动执行 Power 的 City system hook。
 */
export function export_prompt_power(
  power: PowerDefinition,
  host: PowerRuntimeHost,
  resolve_site: (context: PromptPowerCallContext) => PowerCallSite,
  instruction?: string,
): PromptPower {
  return {
    name: power.name, title: power.title, description: power.description, instruction,
    actions: Object.fromEntries(Object.entries(power.actions ?? {}).map(([name, action]) => [name, {
      description: action.description, returns: action.returns, access: action.access, examples: action.examples,
      input_schema: action.input_schema?.json_schema
        ?? (action.input_schema?.zod ? z.toJSONSchema(action.input_schema.zod) : { type: "object", properties: {}, additionalProperties: false }),
      timeout_ms: action.timeout_ms,
      execute: async (input, context) => {
        if (host.get_power(power.name) !== power) throw new Error("Exported Power is no longer registered in its host");
        const site = resolve_site(context);
        const result = await host.run_action({ power: power.name, action: name, payload: input, site: { ...site, abort_signal: context.abort_signal } });
        if (!result.success) throw new Error(result.error || result.message || "Power Action failed");
        if (result.messages?.length) throw new Error("Request-level Powers do not support cross-host messages");
        return result.data ?? null;
      },
    }])),
  };
}
