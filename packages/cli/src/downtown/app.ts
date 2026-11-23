#!/usr/bin/env node

/**
 * Downcity Downtown 交互入口。
 *
 * 关键说明（中文）
 * - `downtown` 只负责 Downtown 与 admin 管理。
 * - 无参数时打开 Downtown 管理 TUI，所选实例仅传入本次工作区。
 * - user 登录与本机 runtime 统一由 `downcity` 承担。
 */

import { isCancel, select } from "@/downtown/tui/Prompts.js";
import { parseArgs } from "@/downtown/core/env.js";
import { show, showError, showSuccess } from "@/downtown/core/ui.js";
import { updateCli } from "@/downtown/core/update.js";
import { getCliLocale, setCliLocale, t } from "@/shared/CliLocale.js";
import { type CliLocale } from "@/shared/types/CliLocale.js";
import { writePersistedCliLocale } from "@/downtown/core/session.js";
import { create_downtown_project } from "@/downtown/create/commands/create.js";
import { deploy_downtown_project } from "@/downtown/deploy/commands/deploy.js";
import { prompt_add_downtown_server } from "@/downtown/server/DowntownServerManager.js";
import { open_downtown_server_workspace } from "@/downtown/server/DowntownServerWorkspace.js";
import { open_downtown_dashboard } from "@/downtown/tui/DowntownDashboard.js";
import type { DowntownAction } from "@/downtown/types/Interactive.js";
import type { tui_action_result } from "@/downtown/types/Tui.js";

export async function runDowntownApp(argv: string[] = []): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.command === "update") {
    await runSelfUpdate();
    return;
  }

  await open_downtown_dashboard({
    run_action: run_downtown_dashboard_action,
  });
}

async function run_downtown_dashboard_action(
  action: DowntownAction,
): Promise<tui_action_result> {
  if (action === "quit") {
    return "quit";
  }

  if (action === "create_downtown") {
    await create_downtown_project(".", { force: false });
    return "refresh";
  }

  if (action.startsWith("open_downtown:")) {
    const base_url = action.slice("open_downtown:".length);
    const result = await open_downtown_server_workspace(base_url);
    return result === "quit" ? "quit" : "refresh";
  }

  if (action === "add_downtown") {
    await prompt_add_downtown_server();
    return "refresh";
  }

  if (action === "deploy_downtown") {
    await deploy_downtown_project(".", {});
    return "refresh";
  }

  if (action === "more") {
    return await run_downtown_more_action();
  }

  return "refresh";
}

async function run_downtown_more_action(): Promise<tui_action_result> {
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
