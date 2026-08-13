/**
 * `city agent token` 命令树。
 *
 * 关键点（中文）：Token 只属于一个 Agent，对该 Agent HTTP API 拥有完整访问能力。
 */

import type { Command } from "commander";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { helpText, t } from "@/shared/CliLocale.js";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";

/** 在 `city agent` 下注册 Token 管理命令。 */
export function registerAgentTokenCommand(agent_command: Command): void {
  const token = agent_command
    .command("token")
    .description(t({
      zh: "管理单 Agent Bearer Token",
      en: "manage Bearer tokens for one Agent",
    }))
    .helpOption("--help", helpText());

  token
    .command("list [agent_id]")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (agent_id: string | undefined, options: { json?: boolean }) => {
      const target = await resolve_cli_agent_target(agent_id);
      const tokens = with_cli_local_data((data) =>
        new AuthService({ agent_id: target.agent_id, repository: data.agent_tokens }).list_tokens()
      );
      if (options.json) {
        printResult({
          asJson: true,
          success: true,
          title: "agent tokens",
          payload: { agent_id: target.agent_id, tokens },
        });
        return;
      }
      emitCliList({
        tone: "accent",
        title: `Agent tokens · ${target.agent_id}`,
        summary: `${tokens.length} token(s)`,
        items: tokens.map((item) => ({
          title: item.name,
          facts: [
            { label: "ID", value: item.token_id },
            { label: "Expires", value: item.expires_at ?? "never" },
          ],
        })),
      });
    });

  token
    .command("create [agent_id]")
    .requiredOption("--name <name>", t({ zh: "Token 名称", en: "token name" }))
    .option("--expires-at <iso>", t({ zh: "ISO 过期时间", en: "ISO expiration time" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      agent_id: string | undefined,
      options: { name: string; expires_at?: string; json?: boolean },
    ) => {
      const target = await resolve_cli_agent_target(agent_id);
      const issued = with_cli_local_data((data) =>
        new AuthService({ agent_id: target.agent_id, repository: data.agent_tokens }).create_token({
          name: options.name,
          expires_at: options.expires_at,
        })
      );
      if (options.json) {
        printResult({
          asJson: true,
          success: true,
          title: "agent token created",
          payload: { ...issued },
        });
        return;
      }
      emitCliBlock({
        tone: "success",
        title: "Agent token created",
        summary: issued.name,
        facts: [
          { label: "Agent", value: issued.agent_id },
          { label: "Token ID", value: issued.token_id },
          { label: "Bearer Token", value: issued.token },
        ],
        note: "Bearer Token 只显示这一次，请立即安全保存。",
      });
    });

  token
    .command("delete <token_id> [agent_id]")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      token_id: string,
      agent_id: string | undefined,
      options: { json?: boolean },
    ) => {
      const target = await resolve_cli_agent_target(agent_id);
      with_cli_local_data((data) =>
        new AuthService({ agent_id: target.agent_id, repository: data.agent_tokens }).delete_token(token_id)
      );
      if (options.json) {
        printResult({
          asJson: true,
          success: true,
          title: "agent token deleted",
          payload: { agent_id: target.agent_id, token_id },
        });
        return;
      }
      emitCliBlock({
        tone: "success",
        title: "Agent token deleted",
        facts: [
          { label: "Agent", value: target.agent_id },
          { label: "Token ID", value: token_id },
        ],
      });
    });
}
