/**
 * City 全局命令装配模块。
 *
 * 关键点（中文）
 * - City 根命令只保留一次性全局初始化、配置、env、token 与 federation 管理能力。
 * - Agent 生命周期统一收敛到 `city agent ...`，不再提供 top-level `city start/stop/restart/status`。
 */

import { Command } from "commander";
import { registerEnvCommand } from "@/city/command/EnvCommand.js";
import { register_federation_command } from "@/city/command/FederationCommand.js";

/**
 * top-level city/gateway 命令注册参数。
 */
export interface GatewayCommandRegistrationContext {
  /** 当前 CLI 版本号。 */
  version: string;
  /** 当前 CLI 入口文件绝对路径。 */
  cliPath: string;
}

/**
 * 注册 top-level city 全局命令。
 *
 * 语义说明（中文）
 * - `city ...` 管一次性全局配置与 Federation 连接。
 * - 需要长期运行的是具体 Agent daemon，由 `city agent start/stop/restart/status` 管理。
 */
export function registerGatewayCommands(
  program: Command,
  _context: GatewayCommandRegistrationContext,
): void {
  registerEnvCommand(program);
  register_federation_command(program);
}
