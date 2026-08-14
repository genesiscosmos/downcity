/**
 * City Env 交互式管理器。
 *
 * 可从 `city env` 或单 Agent 配置面板进入，所有修改统一经过 EnvService 持久化并广播。
 */

import prompts from "@/city/tui/Prompts.js";
import { t } from "@/shared/CliLocale.js";
import {
  delete_env_target_value,
  read_env_target,
  resolve_agent_env_target,
  resolve_global_env_target,
  set_env_target_value,
} from "@/city/env/EnvService.js";
import type { EnvMutationResult, EnvTarget } from "@/city/types/env/EnvTarget.js";

/** 打开 Env 管理器；传入 Agent ID 时直接管理对应 Workspace。 */
export async function run_interactive_env_manager(agent_id?: string): Promise<void> {
  const target = agent_id
    ? await resolve_agent_env_target(agent_id)
    : await prompt_env_target();
  if (!target) return;

  let last_message = "";
  while (true) {
    const env = await read_env_target(target);
    const response = (await prompts({
      type: "select",
      name: "action",
      message: target.scope === "global"
        ? t({ zh: "Global Env", en: "Global Env" })
        : t({ zh: `Workspace Env · ${target.agent_id}`, en: `Workspace Env · ${target.agent_id}` }),
      subtitle: last_message,
      choices: [
        {
          title: t({ zh: `已配置 ${Object.keys(env).length} 个 key`, en: `${Object.keys(env).length} keys configured` }),
          description: Object.keys(env).sort().join(", ") || t({ zh: "暂无配置", en: "No keys configured" }),
          disabled: true,
        },
        { title: t({ zh: "新增或更新", en: "Add or update" }), value: "set" },
        { title: t({ zh: "删除", en: "Delete" }), value: "delete", disabled: Object.keys(env).length === 0 },
        { title: t({ zh: "返回", en: "Back" }), value: "back" },
      ],
      initial: 1,
    })) as { action?: "set" | "delete" | "back" };
    if (!response.action || response.action === "back") return;

    try {
      if (response.action === "set") {
        const input = (await prompts([
          { type: "text", name: "key", message: t({ zh: "Env key", en: "Env key" }) },
          { type: "password", name: "value", message: t({ zh: "Env value", en: "Env value" }) },
        ])) as { key?: string; value?: string };
        if (!String(input.key || "").trim() || input.value === undefined) continue;
        last_message = format_mutation_result(
          await set_env_target_value(target, String(input.key), String(input.value)),
        );
        continue;
      }

      const keys = Object.keys(env).sort();
      const selected = (await prompts({
        type: "select",
        name: "key",
        message: t({ zh: "选择要删除的 key", en: "Select a key to delete" }),
        choices: keys.map((key) => ({ title: key, value: key })),
      })) as { key?: string };
      if (!selected.key) continue;
      last_message = format_mutation_result(await delete_env_target_value(target, selected.key));
    } catch (error) {
      last_message = error instanceof Error ? error.message : String(error);
    }
  }
}

/** 选择 Global 或某个 Agent Workspace。 */
async function prompt_env_target(): Promise<EnvTarget | null> {
  const response = (await prompts({
    type: "select",
    name: "scope",
    message: t({ zh: "选择 Env 作用域", en: "Select Env scope" }),
    choices: [
      { title: "Global", description: "~/.downcity/.env", value: "global" },
      { title: "Agent Workspace", description: t({ zh: "选择 Agent 并修改项目 .env", en: "Select an Agent and edit its project .env" }), value: "workspace" },
      { title: t({ zh: "返回", en: "Back" }), value: "back" },
    ],
  })) as { scope?: "global" | "workspace" | "back" };
  if (!response.scope || response.scope === "back") return null;
  return response.scope === "global"
    ? resolve_global_env_target()
    : await resolve_agent_env_target();
}

/** 把文件修改与在线同步结果压缩为 TUI 状态文本。 */
function format_mutation_result(result: EnvMutationResult): string {
  if (!result.changed) return t({ zh: `${result.key} 不存在`, en: `${result.key} does not exist` });
  const updated = result.broadcast.updated_agent_ids.length;
  const failed = result.broadcast.failed_agents.length;
  return failed > 0
    ? t({ zh: `${result.key} 已保存；${updated} 个 Agent 已更新，${failed} 个同步失败`, en: `${result.key} saved; ${updated} Agents updated, ${failed} failed` })
    : t({ zh: `${result.key} 已保存；${updated} 个 City runtime Agent 已更新`, en: `${result.key} saved; ${updated} City runtime Agents updated` });
}
