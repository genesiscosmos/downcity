/**
 * `city federation` 命令装配模块。
 *
 * 关键点（中文）
 * - 所有 commander 注册逻辑统一放在 `src/command/`。
 * - Federation 成员资格、登录和状态读写由 `shared/FederationConnection` 提供。
 * - `downfed` CLI 负责 Federation 基础设施管理；`city federation` 只负责让本机 City 加入/登录 Federation。
 */

import type { Command } from "commander";
import { parseBoolean } from "@/shared/IndexSupport.js";
import { DEFAULT_BUREAU_ID } from "@/city/shared/CityStateStore.js";
import {
  emit_federation_status,
  emitCityUserWhoami,
  emit_federation_list,
  run_federation_join_command,
  run_federation_leave_command,
  run_federation_login_command,
  run_federation_logout_command,
  run_federation_use_command,
  run_interactive_federation_manager,
} from "@/city/shared/FederationConnection.js";
import { helpText, t } from "@/shared/CliLocale.js";

/**
 * 注册 `city federation` 命令组。
 */
export function register_federation_command(program: Command): void {
  const federation = program
    .command("federation")
    .description(t({
      zh: "管理 City 终端连接的 Federation、Bureau 与账号登录态",
      en: "manage the City terminal's Federation, Bureau, and account login state",
    }))
    .helpOption("--help", helpText())
    .action(async () => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        federation.outputHelp();
        return;
      }
      await run_interactive_federation_manager();
    });

  federation
    .command("status")
    .description(t({
      zh: "查看 City 当前 Federation 成员资格状态",
      en: "show the current City Federation membership status",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action((options: { json?: boolean }) => {
      emit_federation_status({ as_json: options.json === true });
    });

  federation
    .command("list")
    .description(t({
      zh: "列出 City 可选择的 Federation",
      en: "list Federations available to City",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action((options: { json?: boolean }) => {
      emit_federation_list({ as_json: options.json === true });
    });

  federation
    .command("whoami")
    .description(t({
      zh: "查看 City 当前实际使用的 Federation 账号",
      en: "show the current Federation account resolved by City",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action(async (options: { json?: boolean }) => {
      await emitCityUserWhoami({ as_json: options.json === true });
    });

  federation
    .command("join [url]")
    .description(t({
      zh: "加入并选择一个 Federation（默认 base.downcity.ai）",
      en: "join and select a Federation (default: base.downcity.ai)",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action(async (url: string | undefined, options: { json?: boolean }) => {
      await run_federation_join_command({
        url,
        as_json: options.json === true,
      });
    });

  federation
    .command("use [federation]")
    .description(t({
      zh: "选择一个 Federation；可使用 City 本地或 downfed admin 已保存 Federation",
      en: "select a Federation from City-local or downfed-admin saved Federations",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action(async (server: string | undefined, options: { json?: boolean }) => {
      await run_federation_use_command({
        server,
        as_json: options.json === true,
      });
    });

  federation
    .command("login [url]")
    .description(t({
      zh: "登录当前或指定 Federation",
      en: "sign in to the current or specified Federation",
    }))
    .option("--city-id <cityId>", t({
      zh: "当前 City 在该 Federation 中的 bureau_id",
      en: "bureau_id of the current City within this Federation",
    }), DEFAULT_BUREAU_ID)
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action(async (
      url: string | undefined,
      options: { cityId?: string; json?: boolean },
    ) => {
      await run_federation_login_command({
        url,
        bureau_id: options.cityId,
        as_json: options.json === true,
      });
    });

  federation
    .command("logout")
    .description(t({
      zh: "清除当前 Federation 的登录态",
      en: "clear the session for the current Federation",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action((options: { json?: boolean }) => {
      run_federation_logout_command({ as_json: options.json === true });
    });

  federation
    .command("leave")
    .description(t({
      zh: "离开当前 Federation 并回到默认 Federation",
      en: "leave the current Federation and fall back to the default Federation",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .action((options: { json?: boolean }) => {
      run_federation_leave_command({ as_json: options.json === true });
    });
}
