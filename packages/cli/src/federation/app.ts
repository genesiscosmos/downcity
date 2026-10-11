#!/usr/bin/env node

/**
 * Downcity Federation 交互入口。
 *
 * 关键说明（中文）
 * - `downfed` 只负责 Federation 与 admin 管理。
 * - 无参数时打开 Federation 管理 TUI。
 * - user 登录与本机 runtime 统一由 `downcity` 承担。
 */

import { isCancel, select } from "@/federation/tui/Prompts.js";
import { parseArgs } from "@/federation/core/env.js";
import { show, showError, showSuccess } from "@/federation/core/ui.js";
import { updateCli } from "@/federation/core/update.js";
import { getCliLocale, setCliLocale, t } from "@/shared/CliLocale.js";
import { type CliLocale } from "@/shared/types/CliLocale.js";
import { setActiveServer, writePersistedCliLocale } from "@/federation/core/session.js";
import { create_federation_project } from "@/federation/create/commands/create.js";
import { deploy_federation_project } from "@/federation/deploy/commands/deploy.js";
import { prompt_add_federation_server } from "@/federation/server/FederationServerManager.js";
import { open_federation_server_workspace } from "@/federation/server/FederationServerWorkspace.js";
import { open_federation_dashboard } from "@/federation/tui/FederationDashboard.js";
import type { FederationAction } from "@/federation/types/Interactive.js";
import type { tui_action_result } from "@/federation/types/Tui.js";

export async function runFederationApp(argv: string[] = []): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.command === "update") {
    await runSelfUpdate();
    return;
  }

  await open_federation_dashboard({
    run_action: run_federation_dashboard_action,
  });
}

async function run_federation_dashboard_action(
  action: FederationAction,
): Promise<tui_action_result> {
  if (action === "quit") {
    return "quit";
  }

  if (action === "create_federation") {
    await create_federation_project(".", { force: false });
    return "refresh";
  }

  if (action.startsWith("open_federation:")) {
    const base_url = action.slice("open_federation:".length);
    setActiveServer(base_url);
    const result = await open_federation_server_workspace(base_url);
    return result === "quit" ? "quit" : "refresh";
  }

  if (action === "add_federation") {
    await prompt_add_federation_server();
    return "refresh";
  }

  if (action === "deploy_federation") {
    await deploy_federation_project(".", {});
    return "refresh";
  }

  if (action === "more") {
    return await run_federation_more_action();
  }

  return "refresh";
}

async function run_federation_more_action(): Promise<tui_action_result> {
  const current_locale = getCliLocale();
  const selected_action = await select({
    message: t({
      zh: "更多",
      en: "More",
    }),
    options: [
      {
        label: t({
          zh: "切换语言",
          en: "Language",
        }),
        value: "set_language",
        hint: current_locale === "zh"
          ? t({ zh: "当前默认语言：中文", en: "Current default language: Chinese" })
          : t({ zh: "当前默认语言：英文", en: "Current default language: English" }),
      },
      {
        label: t({
          zh: "升级 CLI",
          en: "Upgrade CLI",
        }),
        value: "update",
        hint: t({
          zh: "刷新全局 downcity 命令",
          en: "Refresh the global downcity command",
        }),
      },
      {
        label: t({ zh: "返回", en: "Back" }),
        value: "back",
      },
    ],
  });

  if (!selected_action || isCancel(selected_action) || selected_action === "back") {
    return "refresh";
  }

  if (selected_action === "set_language") {
    await promptAndPersistCliLocale();
    return "refresh";
  }

  await runSelfUpdate();
  return "quit";
}

/**
 * 交互式切换并持久化 CLI 语言。
 */
async function promptAndPersistCliLocale(): Promise<void> {
  const current_locale = getCliLocale();
  const selected_locale = await select({
    message: t({
      zh: "选择 CLI 语言",
      en: "Choose the CLI language",
    }),
    options: [
      {
        label: "English",
        value: "en",
        hint: current_locale === "en"
          ? t({
            zh: "当前",
            en: "Current",
          })
          : undefined,
      },
      {
        label: "中文",
        value: "zh",
        hint: current_locale === "zh"
          ? t({
            zh: "当前",
            en: "Current",
          })
          : undefined,
      },
    ],
  });

  if (!selected_locale || isCancel(selected_locale)) {
    return;
  }

  const cli_locale = selected_locale as CliLocale;
  setCliLocale(cli_locale);
  writePersistedCliLocale(cli_locale);
  showSuccess(t({
    zh: cli_locale === "zh" ? "已切换为中文，并保存为默认语言" : "已切换为英文，并保存为默认语言",
    en: cli_locale === "zh"
      ? "Switched to Chinese and saved as the default language"
      : "Switched to English and saved as the default language",
  }));
 }

/**
 * 执行 CLI 自更新，并提示用户重新启动。
 */
async function runSelfUpdate(): Promise<void> {
  try {
    show(t({
      zh: "正在更新 downcity CLI...",
      en: "Updating downcity CLI...",
    }));
    const result = await updateCli();
    showSuccess(t({
      zh: `CLI 已通过 ${result.mode} 模式更新到 v${result.version}`,
      en: `CLI updated via ${result.mode} mode -> v${result.version}`,
    }));
    show(t({
      zh: "请重新运行 `downcity` 以使用更新后的 CLI。",
      en: "Please run `downcity` again to use the updated CLI.",
    }));
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}
