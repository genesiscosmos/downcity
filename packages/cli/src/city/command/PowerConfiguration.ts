/** Power 配置 CLI：普通配置与私密 stdin 分离，输出只包含字段和应用状态。 */
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import prompts from "../tui/Prompts.js";
import { PowerManagement } from "../process/power/PowerManagement.js";
import { power_options, parse_power_object, run_power_command, type PowerCommandOptions } from "./PowerCommandSupport.js";

/** 一个配置入口按 Power 管理身份路由，不要求用户了解底层存储。 */
export function register_power_configuration(power: Command): void {
  power_options(power.command("config <power_id>"), true)
    .option("--set <json>", "Replace the complete ordinary configuration JSON")
    .option("--configuration-file <path>", "Ordinary configuration JSON file")
    .option("--secrets-stdin", "Read requested secret fields as JSON from stdin")
    .action(async (power_id: string, options: PowerCommandOptions) => await run_power_command(options, async () => {
      if (options.set !== undefined && options.configurationFile) throw new Error("Choose --set or --configuration-file");
      const manager = new PowerManagement(options.root);
      const view = await manager.configuration(power_id);
      let configuration = view.config;
      const secrets: Record<string, string> = {};
      const writing = options.set !== undefined || Boolean(options.configurationFile) || options.secretsStdin === true;
      if (options.set !== undefined) configuration = parse_power_object(options.set, "Configuration");
      if (options.configurationFile) configuration = parse_power_object(await fs.readFile(options.configurationFile, "utf8"), "Configuration file");
      if (options.secretsStdin) {
        if (process.stdin.isTTY) throw new Error("--secrets-stdin requires piped JSON input");
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        const input = parse_power_object(Buffer.concat(chunks).toString("utf8"), "Secret stdin");
        for (const [name, value] of Object.entries(input)) {
          if (typeof value !== "string") throw new Error("Secret fields must contain string values");
          secrets[name] = value;
        }
      }
      const interactive = !writing && !options.json && process.stdin.isTTY && view.fields.length > 0;
      if (interactive) {
        configuration = { ...view.config };
        for (const field of view.fields) {
          const answer = await prompts({ type: field.secret ? "password" : "text", name: "value", message: `${field.name}: ${field.description}` });
          if (answer.value === undefined) throw new Error("Power configuration cancelled");
          if (field.secret) { if (typeof answer.value === "string" && answer.value) secrets[field.name] = answer.value; }
          else configuration[field.name] = answer.value;
        }
      }
      if (writing || interactive) {
        const saved = await manager.configure(power_id, configuration, secrets, options.operationId ?? randomUUID());
        // 单包配置返回安全摘要；代码配置返回带版本生命周期的管理视图。
        return saved && typeof saved === "object" && "kind" in saved ? { power: saved } : saved;
      }
      if (options.operationId) throw new Error("--operation-id requires configuration input");
      return { power_id, configured: Object.keys(view.config).length > 0 || view.configured_secrets.length > 0, fields: [...new Set([...Object.keys(view.config), ...view.fields.map((field) => field.name)])].sort(), requested_fields: view.fields, configured_secrets: view.configured_secrets, staged_version: view.staged_version, applied_version: view.applied_version };
    }));
}
