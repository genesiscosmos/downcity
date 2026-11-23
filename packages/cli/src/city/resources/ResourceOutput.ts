/** 新资源命令的单对象 JSON/退出码协议；不复用面向展示的 CliOutput envelope。 */
import { resolve_platform_model_selection } from "../runtime/city-model/ExecutionModelBinding.js";
import { inspect } from "node:util";
import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import fs from "node:fs/promises";
import { as_resource_error, ResourceError } from "@downcity/city/local";
import { ResourceClient } from "./ResourceClient.js";

/** 所有资源操作的公共选项，JSON 模式始终非交互。 */
export function resource_options(command: Command): Command {
  return command.option("--root <path>", "City data root").option("--json", "Emit one JSON envelope").option("--timeout <seconds>", "Operation timeout in seconds");
}

/** Commander 字段只在展示适配边界转为公共 snake_case 输入。 */
export function resource_input(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => [key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`), value]));
}

/** 读取消息/指令文件属于 CLI 输入，不把本机文件路径交给在线宿主任意读取。 */
export async function prepare_resource_input(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (input.instruction_file !== undefined) {
    input.instruction = await fs.readFile(String(input.instruction_file), "utf8");
    delete input.instruction_file;
  }
  if (input.message_file !== undefined) {
    if (input.message !== undefined) throw new ResourceError("usage_error", "message and message-file are mutually exclusive", 2);
    if (input.message_file === "-") {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      input.message = Buffer.concat(chunks).toString("utf8");
    } else input.message = await fs.readFile(String(input.message_file), "utf8");
    delete input.message_file;
  }
  return input;
}

/** 业务只返回结果，stderr/JSON/确认全部由该 CLI 适配处理。 */
export async function execute_resource_command(command: string, options: Record<string, unknown>, input: Record<string, unknown> = {}): Promise<void> {
  const normalized = resource_input(options);
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  const client = new ResourceClient({ abort_signal: controller.signal, root: typeof normalized.root === "string" ? normalized.root : undefined, ...(normalized.timeout !== undefined ? { timeout_ms: Number(normalized.timeout) * 1000 } : {}) });
  const json = normalized.json === true;
  let request_id: string | undefined;
  let meta: unknown = { root_path: client.root_path, host: null, source: "local", observed_at: new Date().toISOString() };
  try {
    if (normalized.timeout !== undefined && !(Number.isFinite(Number(normalized.timeout)) && Number(normalized.timeout) > 0)) throw new ResourceError("usage_error", "timeout must be a positive finite number", 2);
    const parameters = await prepare_resource_input({ ...normalized, ...input });
    if (["agent.create", "agent.update"].includes(command) && typeof parameters.model === "string") {
      parameters.model = await resolve_platform_model_selection(parameters.model, client.root_path);
    }
    if (["agent.delete", "workspace.remove"].includes(command) && parameters.yes !== true) {
      if (json || !process.stdin.isTTY || !process.stdout.isTTY) throw new ResourceError("usage_error", "Non-interactive deletion/removal requires --yes", 2);
      const { default: prompts } = await import("../tui/Prompts.js");
      const answer = await prompts({ type: "confirm", name: "confirmed", message: command === "agent.delete" ? `Permanently delete Agent ${parameters.id}, including Sessions, archives, attachments, skills, logs and owned Power data?` : `Remove Workspace ${parameters.id} registration and release idle resources? Project files and history are retained.`, initial: false });
      if (answer.confirmed !== true) throw new ResourceError("cancelled", "Cancelled", 130);
    }
    if (command === "session.send") {
      request_id = typeof parameters.request_id === "string" ? parameters.request_id : randomUUID();
      parameters.request_id = request_id;
      if (normalized.timeout !== undefined) parameters.wait_timeout_ms = Number(normalized.timeout) * 1000;
    }
    const result = await client.call(command, parameters);
    meta = result.meta;
    if (json) process.stdout.write(`${JSON.stringify({ schema_version: 1, success: true, command, data: result.data, error: null, meta })}\n`);
    else process.stdout.write(`${inspect(result.data, { colors: process.stdout.isTTY, depth: 8, compact: false })}\n`);
  } catch (error) {
    const failure = as_resource_error(error);
    meta = client.get_meta();
    process.exitCode = failure.exit_code;
    const envelope = { schema_version: 1, success: false, command, data: null, error: { code: failure.code, message: failure.message, retryable: failure.retryable, details: { ...(request_id ? { request_id } : {}), ...failure.details } }, meta };
    if (json) process.stdout.write(`${JSON.stringify(envelope)}\n`);
    else process.stderr.write(`${failure.code}: ${failure.message}\n`);
  } finally { process.off("SIGINT", interrupt); }
}
