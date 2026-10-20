/** City 级 Token 命令及交互式管理；列表不展示凭据，签发时只展示一次明文。 */
import type { Command } from "commander";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import { collect_token_config, confirm_token_config, select_token, token_question } from "./TokenInteraction.js";
import type { CityTokenCommandOptions } from "@/city/types/auth/CityTokenCommand.js";
import type { CityTokenSummary, IssuedCityToken } from "@downcity/city/local";

/** 人类和脚本共用的摘要输出；只有 create 路径允许携带一次性 token。 */
function display(value: CityTokenSummary | IssuedCityToken | CityTokenSummary[] | { /** 删除记录 ID。 */ deleted: string }, json = false): void {
  console.log(JSON.stringify(value, null, json ? 0 : 2));
  if (!Array.isArray(value) && "token" in value && !json) console.log("Bearer Token 只显示这一次，请立即安全保存。");
}

async function create_token(options: CityTokenCommandOptions): Promise<void> {
  const complete = Boolean(options.name && (options.allAgents || options.agents !== undefined) && (options.neverExpires || options.expiresAt !== undefined));
  const config = await collect_token_config(options);
  if (!complete) await confirm_token_config(config);
  display(with_cli_local_data((data) => data.city_tokens.create(config)), options.json);
}

async function update_token(id: string | undefined, options: CityTokenCommandOptions): Promise<void> {
  const previous = await select_token(id);
  const config = await collect_token_config(options, previous);
  if (!id || (!options.name && options.agents === undefined && !options.allAgents && !options.expiresAt && !options.neverExpires)) await confirm_token_config(config);
  display(with_cli_local_data((data) => data.city_tokens.update(previous.token_id, config)), options.json);
}

async function delete_token(id?: string, json = false): Promise<void> {
  const previous = await select_token(id);
  if (!id && !await token_question({ type: "confirm", name: "value", message: `撤销 ${previous.name}？连接将失去授权。`, initial: false })) return;
  with_cli_local_data((data) => data.city_tokens.remove(previous.token_id));
  display({ deleted: previous.token_id }, json);
}

/** 根入口管理循环；所有取消都在写入之前结束。 */
async function manage_tokens(): Promise<void> {
  while (true) {
    const action = await token_question({ type: "select", name: "value", message: "City Token 管理", choices: [
      { title: "创建 Token", value: "create" }, { title: "查看 Token", value: "list" },
      { title: "修改名称、授权范围和有效期", value: "update" }, { title: "撤销 Token", value: "delete" }, { title: "返回", value: "exit" },
    ] });
    if (action === "exit") return;
    // 输出后退出全屏交互，避免下一次菜单清屏吞掉唯一一次明文或操作结果。
    if (action === "create") { await create_token({}); return; }
    if (action === "list") { display(with_cli_local_data((data) => data.city_tokens.list())); return; }
    if (action === "update") { await update_token(undefined, {}); return; }
    if (action === "delete") { await delete_token(); return; }
  }
}

/** 注册在 city 根命令，不再挂在 Agent 下。 */
export function register_city_token_command(program: Command): void {
  const token = program.command("token").description("管理 City 访问凭据与 Agent 授权范围").action(manage_tokens);
  const configure = (command: Command) => command
    .option("--name <name>", "凭据名称")
    .option("--agents <ids>", "逗号分隔的 Agent IDs")
    .option("--all-agents", "允许全部现有和未来 Agents")
    .option("--expires-at <iso>", "含时区的到期日期")
    .option("--never-expires", "永不过期")
    .option("--json", "JSON 输出");
  configure(token.command("create").description("创建 City Token，缺少参数时交互补齐")).action(create_token);
  token.command("list").option("--json", "JSON 输出").action((options: CityTokenCommandOptions) => display(with_cli_local_data((data) => data.city_tokens.list()), options.json));
  configure(token.command("update [token_id]").description("修改授权或有效期")).action(update_token);
  token.command("delete [token_id]").description("撤销 City Token").option("--json", "JSON 输出").action((id: string | undefined, options: CityTokenCommandOptions) => delete_token(id, options.json));
}
