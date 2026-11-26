/** City Downtown 命令：显式连接、独立登录、按来源聚合，不设置全局当前服务。 */
import type { Command } from "commander";
import type { TownConnection } from "@downcity/city/local";
import type { UserSessionCredentials } from "@downcity/downtown";
import { call_cli_town } from "../resources/TownClient.js";
import { register_downtown_service_commands } from "./DowntownServiceCommand.js";
import { perform_downtown_user_login } from "../shared/DowntownUserLogin.js";

import { create_downtown_id } from "@downcity/city";
import type { DowntownOptions } from "../types/DowntownCommand.js";

/** 将完整 CLI 子命令装配到 City 根。 */
export function register_downtown_command(program: Command): void {
  const downtown = program.command("towns").description("Manage independent Downtown connections and resources");
  register_downtown_service_commands(downtown);
  const common = (command: Command) => command.option("--root <path>", "City data root").option("--json", "Output JSON");
  common(downtown.command("add <url>").description("Add a persistent service connection"))
    .option("--name <name>", "Display name")
    .action((url: string, options: DowntownOptions) => run(options, () => call_cli_town("town.connection.add", { url, name: options.name }, options.root)));
  common(downtown.command("list").description("List registered Downtown addresses"))
    .option("--all", "Include removed connections")
    .action((options: DowntownOptions) => run(options, () => call_cli_town("town.connection.list", { include_removed: options.all }, options.root)));
  common(downtown.command("login <url>").description("Sign in to this connection"))
    .action((url: string, options: DowntownOptions) => run(options, async () => {
      const downtown_id = create_downtown_id(url);
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive sign in requires a terminal");
      const connection = await call_cli_town("town.connection.get", { downtown_id }, options.root) as TownConnection;
      if (connection.status !== "active") throw new Error("Restore this connection before signing in");
      let credentials: UserSessionCredentials | undefined;
      const session = await perform_downtown_user_login({ downtown_url: connection.url, accept_credentials: (value) => { credentials = value; } });
      if (!session || !credentials) return { status: "cancelled", downtown_id };
      return await call_cli_town("town.connection.login", { downtown_id, url: connection.url, revision: connection.revision, credentials }, options.root);
    }));
  for (const action of ["whoami", "logout", "remove", "restore", "accounts"] as const) {
    common(downtown.command(`${action} <url>`).description(`${action} for one explicit connection`))
      .action((url: string, options: DowntownOptions) => run(options, () => call_cli_town(`town.connection.${action}`, { downtown_id: create_downtown_id(url) }, options.root)));
  }
  common(downtown.command("rename <url> <name>").description("Rename a service connection"))
    .action((url: string, name: string, options: DowntownOptions) => run(options, () => call_cli_town("town.connection.rename", { downtown_id: create_downtown_id(url), name }, options.root)));
  common(downtown.command("models").description("List models and their Downtown sources"))
    .option("--downtown <url>", "Filter one source")
    .action((options: DowntownOptions) => run(options, () => call_cli_town("town.models", { downtown_id: options.downtown ? create_downtown_id(options.downtown) : undefined }, options.root)));
  common(downtown.command("services").description("List services from all connections with isolated source status"))
    .option("--downtown <url>", "Filter one source")
    .action((options: DowntownOptions) => run(options, () => call_cli_town("town.services", { downtown_id: options.downtown ? create_downtown_id(options.downtown) : undefined }, options.root)));
}

/** 普通命令输出只显示用户资料；完整内部引用留在显式 JSON 协议中。 */
const display_internal_fields = new Set(["downtown_id", "source_id", "auth_scope_id", "binding_id", "account_id", "session_id", "revision", "model"]);

/** 不回显凭据、服务端正文或异常堆栈；失败不会变成成功退出。 */
async function run(options: DowntownOptions, operation: () => Promise<unknown>): Promise<void> {
  try { process.stdout.write(JSON.stringify(await operation(), options.json ? undefined : (key, value) => display_internal_fields.has(key) ? undefined : value, options.json ? undefined : 2) + "\n"); }
  catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error && "exit_code" in error ? error.message : "Downtown command failed; check the connection, login and owner availability";
    process.stderr.write(options.json ? JSON.stringify({ success: false, error: message }) + "\n" : message + "\n");
  }
}
