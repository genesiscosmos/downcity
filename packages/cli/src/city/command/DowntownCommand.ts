/** City Downtown 命令：显式连接、独立登录、按来源聚合，不设置全局当前服务。 */
import type { Command } from "commander";
import type { TownConnection } from "@downcity/city/local";
import type { UserSessionCredentials } from "@downcity/downtown";
import { call_cli_town } from "../resources/TownClient.js";
import { register_downtown_service_commands } from "./DowntownServiceCommand.js";
import { perform_federation_user_login } from "../shared/FederationUserLogin.js";

/** 命令通用输出和数据根选择。 */
interface DowntownOptions {
  /** 显式本地数据根；省略时使用 City 默认根。 */
  root?: string;
  /** 输出结构化 JSON，默认用可读 JSON 展示目录来源。 */
  json?: boolean;
  /** 添加连接时的展示名称。 */
  name?: string;
  /** 包含保留历史的已移除连接。 */
  all?: boolean;
  /** 聚合目录的显式连接筛选。 */
  connection?: string;
}

/** 将完整 CLI 子命令装配到 City 根。 */
export function register_downtown_command(program: Command): void {
  const downtown = program.command("downtown").description("Manage independent Downtown connections and resources");
  register_downtown_service_commands(downtown);
  const common = (command: Command) => command.option("--root <path>", "City data root").option("--json", "Output JSON");
  common(downtown.command("add <url>").description("Add a persistent service connection"))
    .option("--name <name>", "Display name")
    .action((url: string, options: DowntownOptions) => run(options, () => call_cli_town("town.connection.add", { url, name: options.name }, options.root)));
  common(downtown.command("list").description("List independent connections and current source identities"))
    .option("--all", "Include removed connections")
    .action((options: DowntownOptions) => run(options, () => call_cli_town("town.connection.list", { include_removed: options.all }, options.root)));
  common(downtown.command("login <connection_id>").description("Sign in to this connection"))
    .action((connection_id: string, options: DowntownOptions) => run(options, async () => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive sign in requires a terminal");
      const connection = await call_cli_town("town.connection.get", { connection_id }, options.root) as TownConnection;
      if (connection.status !== "active") throw new Error("Restore this connection before signing in");
      let credentials: UserSessionCredentials | undefined;
      const session = await perform_federation_user_login({ federation_url: connection.url, accept_credentials: (value) => { credentials = value; } });
      if (!session || !credentials) return { status: "cancelled", connection_id };
      return await call_cli_town("town.connection.login", { connection_id, url: connection.url, revision: connection.revision, credentials }, options.root);
    }));
  for (const action of ["whoami", "logout", "remove", "restore", "accounts"] as const) {
    common(downtown.command(`${action} <connection_id>`).description(`${action} for one explicit connection`))
      .action((connection_id: string, options: DowntownOptions) => run(options, () => call_cli_town(`town.connection.${action}`, { connection_id }, options.root)));
  }
  common(downtown.command("rename <connection_id> <name>").description("Rename a service connection"))
    .action((connection_id: string, name: string, options: DowntownOptions) => run(options, () => call_cli_town("town.connection.rename", { connection_id, name }, options.root)));
  common(downtown.command("models").description("List models with source IDs and identity bindings"))
    .option("--connection <connection_id>", "Filter one source")
    .action((options: DowntownOptions) => run(options, () => call_cli_town("town.models", { connection_id: options.connection }, options.root)));
  common(downtown.command("services").description("List services from all connections with isolated source status"))
    .option("--connection <connection_id>", "Filter one source")
    .action((options: DowntownOptions) => run(options, () => call_cli_town("town.services", { connection_id: options.connection }, options.root)));
}

/** 不回显凭据、服务端正文或异常堆栈；失败不会变成成功退出。 */
async function run(options: DowntownOptions, operation: () => Promise<unknown>): Promise<void> {
  try { process.stdout.write(JSON.stringify(await operation(), null, options.json ? undefined : 2) + "\n"); }
  catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error && "exit_code" in error ? error.message : "Downtown command failed; check the connection, login and owner availability";
    process.stderr.write(options.json ? JSON.stringify({ success: false, error: message }) + "\n" : message + "\n");
  }
}
