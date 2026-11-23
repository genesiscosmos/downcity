/**
 * Downtown 单次操作目标解析。
 *
 * ID 与名称只做精确匹配；没有目标或名称重名时，交互终端选择本次对象。
 * 解析不会保存选中状态，也不会根据当前目录、历史连接或唯一候选自动推断。
 */
import { readConfig, type ServerProfile } from "@/downtown/core/session.js";
import { isCancel, select } from "@/downtown/tui/Prompts.js";
import { CliError } from "@/shared/CliError.js";
import { t } from "@/shared/CliLocale.js";

/** 每次操作接受的互斥目标参数。 */
export interface DowntownTargetOptions {
  /** 精确匹配项目声明的 fed_id；同一 ID 有多个部署记录时需本次选择。 */
  id?: string;
  /** 精确匹配登记名称；重名时需本次选择，脚本应改用唯一 ID。 */
  name?: string;
}

/** 解析本次目标；取消返回 undefined，缺失或歧义的非交互输入直接报错。 */
export async function resolve_downtown_target(
  options: DowntownTargetOptions = {},
): Promise<ServerProfile | undefined> {
  if (options.id !== undefined && options.name !== undefined) {
    throw new CliError({ title: "--id and --name are mutually exclusive" });
  }
  const id = options.id?.trim();
  const name = options.name?.trim();
  if ((options.id !== undefined && !id) || (options.name !== undefined && !name)) {
    throw new CliError({ title: "--id and --name must not be empty" });
  }
  const servers = readConfig().servers;
  const candidates = id ? servers.filter((server) => server.fed_id === id)
    : name ? servers.filter((server) => server.name === name) : servers;
  if (!candidates.length) {
    throw new CliError({
      title: t({ zh: "未找到匹配的 Downtown。", en: "No matching Downtown found." }),
      note: id ? `id: ${id}` : name ? `name: ${name}` : undefined,
      fix: "fed server add",
    });
  }
  if ((id || name) && candidates.length === 1) return candidates[0];
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({
      title: id || name ? "Downtown target is ambiguous" : "Downtown target is required",
      note: candidates.map((server) => `${server.name} | ${server.fed_id ?? "no id"} | ${server.base_url}`).join("\n"),
      fix: "Pass --id <id> or a unique --name <name>.",
    });
  }
  const selected_url = await select({
    message: t({ zh: "选择本次操作的 Downtown", en: "Select a Downtown for this operation" }),
    options: candidates.map((server) => ({
      value: server.base_url,
      label: server.name,
      hint: `${server.fed_id ?? "no id"} · ${server.target ?? "remote"} · ${server.base_url} · ${server.status ?? "unknown"}`,
    })),
  });
  if (isCancel(selected_url)) return undefined;
  return candidates.find((server) => server.base_url === selected_url);
}
