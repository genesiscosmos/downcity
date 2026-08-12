/**
 * City 全局命令装配模块。
 *
 * 关键点（中文）
 * - City 根命令拥有 CLI City daemon 的 on/off/restart/status 生命周期。
 * - Agent 子命令只管理 Agent 配置与调用，不表达 started/stopped 状态。
 */

import { Command } from "commander";
import { registerEnvCommand } from "@/city/command/EnvCommand.js";
import { register_federation_command } from "@/city/command/FederationCommand.js";
import { city_off, city_on, city_restart, city_status } from "@/city/agent/CityLifecycle.js";
import { parseBoolean, parsePort } from "@/shared/IndexSupport.js";
import { createVersionBanner } from "@/shared/IndexSupport.js";
import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";

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
 * - `city ...` 管 CLI City 生命周期、全局配置与 Federation 连接。
 */
export function registerGatewayCommands(
  program: Command,
  context: GatewayCommandRegistrationContext,
): void {
  const add_city_options = (command: Command): Command => command
    .option("--host <host>", "City HTTP listen host", "127.0.0.1")
    .option("--port <port>", "City HTTP port", parsePort, 5314)
    .option("--rpc-port <port>", "City RPC port", parsePort, 15314);
  add_city_options(program.command("on").description("启动 CLI City 宿主"))
    .option("--foreground [enabled]", "在当前终端前台运行", parseBoolean)
    .action(createVersionBanner(context.version, async (options: {
      host?: string;
      port?: number;
      rpcPort?: number;
      foreground?: boolean;
    }) => await city_on(to_city_options(options))));
  program.command("off").description("停止 CLI City 宿主")
    .action(createVersionBanner(context.version, city_off));
  add_city_options(program.command("restart").description("重启 CLI City 宿主"))
    .action(createVersionBanner(context.version, async (options: {
      host?: string;
      port?: number;
      rpcPort?: number;
    }) => await city_restart(to_city_options(options))));
  program.command("status").description("查看 CLI City 宿主状态")
    .option("--fix [enabled]", "清理过期的 daemon 状态文件", parseBoolean)
    .action(createVersionBanner(context.version, city_status));
  registerEnvCommand(program);
  register_federation_command(program);
}

/** 把 Commander 选项转换为 City daemon 类型。 */
function to_city_options(options: {
  host?: string;
  port?: number;
  rpcPort?: number;
  foreground?: boolean;
}): CityDaemonOptions {
  return {
    host: options.host,
    http_port: options.port,
    rpc_port: options.rpcPort,
    foreground: options.foreground,
  };
}
