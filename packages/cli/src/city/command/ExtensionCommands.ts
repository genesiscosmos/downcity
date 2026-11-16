/** 扩展项目 CLI，只解析参数与输出共享协议；JSON 模式不提示、不混入进度或配置内容。 */
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { ExtensionFailure, ResourceError, type ExtensionResult, type ExtensionConfigurationView } from "@downcity/city/local";
import prompts from "../tui/Prompts.js";
import { ExtensionClient } from "../resources/ExtensionClient.js";

import type { ExtensionCommandOptions } from "../types/ExtensionCommand.js";

/** 为 extension 树注册完整项目操作；所有操作都不会启动 City。 */
export function register_extension_commands(program: Command): void {
  const extension = program.command("extension").description("Manage code extension projects without starting City");
  const options = (command: Command) => command.option("--root <path>", "Downcity data root").option("--json", "Print one final JSON result").option("--operation-id <id>", "Resume an accepted operation");
  options(extension.command("add <source>").option("--ref <ref>", "Git branch, tag or commit"))
    .action(async (source: string, opts: ExtensionCommandOptions) => await execute("extension.add", opts, { source, cwd: process.cwd(), ...(opts.ref ? { ref: opts.ref } : {}) }));
  for (const method of ["definitions", "connections"] as const) options(extension.command(method)).action(async (opts: ExtensionCommandOptions) => await execute(`extension.${method}`, opts));
  options(extension.command("select-connection <entry_id>").description("Explicitly bind a connection; use none to disconnect")).action(async (entry_id: string, opts: ExtensionCommandOptions) => await execute("extension.select_connection", opts, { entry_id: entry_id === "none" ? null : entry_id }));
  options(extension.command("list")).action(async (opts: ExtensionCommandOptions) => await execute("extension.list", opts));
  for (const method of ["show", "reload", "remove"] as const) {
    options(extension.command(`${method} <extension_id>`)).action(async (extension_id: string, opts: ExtensionCommandOptions) => await execute(`extension.${method}`, opts, { extension_id }));
  }
  options(extension.command("configure <extension_id>").option("--configuration-file <path>", "Ordinary configuration JSON; reload explicitly to apply").option("--secrets-stdin", "Read requested secret fields as JSON from stdin"))
    .action(async (extension_id: string, opts: ExtensionCommandOptions) => await execute("extension.configure", opts, { extension_id }));
  options(extension.command("operation <operation_id>")).action(async (operation_id: string, opts: ExtensionCommandOptions) => await execute("extension.operation", opts, { operation_id }));
}

/** 输出错误只使用共享安全字段，绝不打印普通配置或私密文件内容。 */
async function execute(method: string, options: ExtensionCommandOptions, input: Record<string, unknown> = {}): Promise<void> {
  try {
    const client = new ExtensionClient(options.root);
    if (method === "extension.configure") {
      const view = await client.call("extension.configuration", input) as ExtensionConfigurationView;
      input.configuration = view.config;
      if (options.secretsStdin) {
        if (process.stdin.isTTY) throw new ExtensionFailure("input_invalid", "--secrets-stdin requires piped JSON input", "source", 2);
        try { const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); input.secrets = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { throw new ExtensionFailure("input_invalid", "Secret stdin must contain a JSON object", "source", 2); }
      } else if (!options.configurationFile && !options.json && process.stdin.isTTY) {
        const configuration = { ...view.config };
        const secrets: Record<string, string> = {};
        for (const field of view.fields) {
          const answer = await prompts({ type: field.secret ? "password" : "text", name: "value", message: `${field.name}: ${field.description}` });
          if (answer.value === undefined) throw new ExtensionFailure("cancelled", "Configuration cancelled", "source", 1);
          if (field.secret) { if (typeof answer.value === "string" && answer.value) secrets[field.name] = answer.value; }
          else configuration[field.name] = answer.value;
        }
        input.configuration = configuration;
        input.secrets = secrets;
      } else if (!options.configurationFile && !options.secretsStdin) {
        process.stdout.write(`${JSON.stringify({ status: "needs_configuration", extension_id: input.extension_id, fields: view.fields })}\n`);
        process.exitCode = 3;
        return;
      }
    }
    if (options.configurationFile) {
      try { input.configuration = JSON.parse(await fs.readFile(options.configurationFile, "utf8")); }
      catch { throw new ExtensionFailure("input_invalid", "Configuration file must contain valid JSON", "source", 2); }
    }
    if (!["extension.list", "extension.show", "extension.operation"].includes(method)) input.operation_id = options.operationId ?? randomUUID();
    const result = await client.call(method, input);
    process.stdout.write(`${options.json ? JSON.stringify(result) : format_result(result)}\n`);
    if (result && typeof result === "object" && "error" in result && result.error) {
      const error = (result as ExtensionResult).error!;
      process.exitCode = error.code === "configuration_required" ? 3 : error.code === "project_busy" ? 4 : error.stage === "source" && /invalid|missing|conflict/u.test(error.code) ? 2 : 1;
    }
  } catch (error) {
    const known = error instanceof ExtensionFailure || error instanceof ResourceError;
    const failure = { error: { code: known ? error.code : "extension_failed", message: known ? error.message : "Extension operation failed" } };
    (options.json ? process.stdout : process.stderr).write(`${options.json ? JSON.stringify(failure) : failure.error.message}\n`);
    process.exitCode = known ? error.exit_code : 1;
  }
}

/** 人类输出也明确 pending，不能把未执行项目写成可用。 */
function format_result(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => format_result(item)).join("\n") || "No extension projects";
  if (value && typeof value === "object" && "extension_id" in value && "status" in value) {
    const result = value as ExtensionResult;
    return `${result.extension_id}  ${result.name}  ${result.status}${result.error ? `\n${result.error.code}: ${result.error.message}` : ""}${result.warnings?.length ? `\n${result.warnings.map((warning) => `${warning.code}: ${warning.message}`).join("\n")}` : ""}`;
  }
  return JSON.stringify(value, null, 2);
}
