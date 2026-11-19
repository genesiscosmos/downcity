/**
 * CLI City 远程配置与连接码命令。配置不触发生命周期操作；连接码使用可信管理
 * 通道创建独立 Token，只输出封装后的凭据，不接受或复用历史 Token 明文。
 */
import type { Command } from "commander";
import { encode_city_connection } from "@downcity/city/browser";
import type { IssuedCityToken } from "@downcity/city/local";
import { ResourceClient } from "@/city/resources/ResourceClient.js";
import type { CityTokenCommandOptions } from "@/city/types/auth/CityTokenCommand.js";
import { collect_token_config, confirm_token_config, token_question } from "./TokenInteraction.js";
import { normalize_remote_url, normalize_remote_origin, read_city_remote_config, update_city_remote_config } from "@/city/shared/CityRemoteConfig.js";

import type { RemoteCommandOptions } from "@/city/types/CityRemoteCommand.js";

/** 将 Commander 选项转换为模块内字段。 */
function read_options(command: Command): RemoteCommandOptions {
  return {
    ...command.opts<CityTokenCommandOptions>(),
    public_url: command.getOptionValue("publicUrl"),
    allowed_origins: command.getOptionValue("allowedOrigins"),
    clear_public_url: command.getOptionValue("clearPublicUrl"),
    clear_allowed_origins: command.getOptionValue("clearAllowedOrigins"),
  };
}

/** 从命令明确指定的 root 创建资源客户端。 */
function create_client(command: Command): ResourceClient {
  return new ResourceClient({ root: command.getOptionValue("root") });
}

/** 收集并校验所有参数后一次写入，取消或任一无效字段都不会产生修改。 */
async function configure_remote(command: Command): Promise<void> {
  const options = read_options(command);
  if (options.public_url !== undefined && options.clear_public_url) throw new Error("--public-url and --clear-public-url are mutually exclusive");
  if (options.allowed_origins !== undefined && options.clear_allowed_origins) throw new Error("--allowed-origins and --clear-allowed-origins are mutually exclusive");
  const client = create_client(command);
  const update: Parameters<typeof update_city_remote_config>[1] = {};
  if (options.clear_public_url) update.public_url = null;
  if (options.public_url !== undefined) update.public_url = normalize_remote_url(options.public_url);
  if (options.clear_allowed_origins) update.allowed_origins = [];
  if (options.allowed_origins !== undefined) {
    const values = options.allowed_origins.split(",");
    if (values.some(value => !value.trim())) throw new Error("Use --clear-allowed-origins to clear origins");
    update.allowed_origins = values.map(normalize_remote_origin);
  }
  if (!Object.keys(update).length) {
    const current = read_city_remote_config(client.root_path);
    const url = String(await token_question({ type: "text", name: "value", message: "City 公开 URL（留空表示未配置）", initial: current.public_url ?? "" })).trim();
    const origins = String(await token_question({ type: "text", name: "value", message: "允许的浏览器 Origins（逗号分隔，留空清空）", initial: current.allowed_origins.join(",") })).trim();
    update.public_url = url ? normalize_remote_url(url) : null;
    update.allowed_origins = origins ? origins.split(",").map(normalize_remote_origin) : [];
  }
  const config = update_city_remote_config(client.root_path, update);
  console.log(JSON.stringify({ ...config, restart_required: true }, null, options.json ? 0 : 2));
  if (!options.json) console.log("配置已保存；需显式重启 CLI City 后生效（city off，然后 city on，重新提供所需的监听参数）。");
}

/** 地址先校验，再收集授权与签发；一次性明文只进入 SDK 编码，不另行输出。 */
async function create_remote_code(command: Command): Promise<void> {
  const options = read_options(command);
  const client = create_client(command);
  const candidate = options.public_url ?? read_city_remote_config(client.root_path).public_url;
  if (!candidate) throw new Error("Configure city remote configure --public-url <url> or provide city remote code --public-url <url>; no active binding is assumed");
  const public_url = normalize_remote_url(candidate);
  const complete = Boolean(options.name && (options.allAgents || options.agents !== undefined) && (options.neverExpires || options.expiresAt !== undefined));
  const config = await collect_token_config(options, undefined, client);
  if (!complete) await confirm_token_config(config);
  const issued = (await client.call("config.token.create", { config })).data as IssuedCityToken;
  const { token, ...summary } = issued;
  const code = encode_city_connection({ url: public_url, token });
  if (options.json) console.log(JSON.stringify({ code, url: public_url, ...summary }));
  else {
    console.log(code);
    console.log(`连接码包含访问凭据，只显示这一次；请安全保存。撤销：city token delete ${issued.token_id}`);
  }
}

/** 注册独立远程命令组；参数中从不提供 Token 明文入口。 */
export function register_city_remote_command(program: Command): void {
  const remote = program.command("remote").description("配置 City 公开地址、浏览器来源与独立连接码");
  const common = (command: Command): Command => command.option("--root <path>", "City 数据根目录").option("--json", "JSON 输出");
  common(remote.command("show").description("查看保存的发布配置（不代表运行中配置）"))
    .action((_options: unknown, command: Command) => console.log(JSON.stringify(read_city_remote_config(create_client(command).root_path), null, command.getOptionValue("json") ? 0 : 2)));
  common(remote.command("configure").description("保存发布配置，需显式重启 CLI City 生效"))
    .option("--public-url <url>", "客户端可连接的 HTTP/HTTPS 基础地址")
    .option("--allowed-origins <origins>", "逗号分隔的精确浏览器 Origins")
    .option("--clear-public-url", "移除保存的公开地址")
    .option("--clear-allowed-origins", "清空额外跨域来源")
    .action((_options: unknown, command: Command) => configure_remote(command));
  common(remote.command("code").description("签发独立 Token 并只输出连接码；缺少授权参数时交互补齐"))
    .option("--public-url <url>", "仅本次连接码使用的地址，不修改保存配置")
    .option("--name <name>", "连接凭据名称")
    .option("--agents <ids>", "逗号分隔的 Agent IDs")
    .option("--all-agents", "允许全部现有和未来 Agents")
    .option("--expires-at <iso>", "含时区的到期日期")
    .option("--never-expires", "永不过期")
    .action((_options: unknown, command: Command) => create_remote_code(command));
}
