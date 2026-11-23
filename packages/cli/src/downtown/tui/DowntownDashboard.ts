/**
 * Downtown 顶层 TUI 仪表盘。
 *
 * 关键说明（中文）
 * - 这是 `downtown` / `downtown manage` 的默认交互入口。
 * - 首页直接展示已保存的 Downtown 列表，选中后进入对应 admin 工作区。
 * - 列表选择仅作用于本次工作区，不展示或保存全局操作目标。
 * - 内部使用 shared pi-tui runtime，和其它 CLI TUI 保持同一套框架。
 */

import { readFileSync } from "node:fs";
import { readConfig } from "@/downtown/core/session.js";
import { run_managed_dashboard_loop } from "@/shared/tui/ManagedTuiRuntime.js";
import { t } from "@/shared/CliLocale.js";
import type { DowntownAction } from "@/downtown/types/Interactive.js";
import type { tui_action_result, tui_list_item } from "@/downtown/types/Tui.js";

interface downtown_dashboard_options {
  /** 执行 Downtown 仪表盘动作。 */
  run_action: (action: DowntownAction) => Promise<tui_action_result>;
}

/**
 * 打开 Downtown 顶层仪表盘。
 */
export async function open_downtown_dashboard(
  options: downtown_dashboard_options,
): Promise<void> {
  await run_managed_dashboard_loop<DowntownAction>({
    runtime_title: "Downcity Downtown",
    build_state: build_downtown_dashboard_state,
    run_action: options.run_action,
  });
}

interface downtown_dashboard_state {
  /** dashboard 顶部标题。 */
  title: string;
  /** dashboard 顶部副标题。 */
  subtitle: string;
  /** dashboard 底部帮助文案。 */
  footer: string;
  /** dashboard 列表项。 */
  items: tui_list_item[];
}

function build_downtown_dashboard_state(): downtown_dashboard_state {
  const version = read_downtown_cli_version();
  const config = readConfig();
  const downtown_items = config.servers.map((server) => ({
    id: `open_downtown:${server.base_url}`,
    title: server.name,
    subtitle: [
      server.target ?? t({ zh: "手动连接", en: "manual" }),
      server.status ?? "unknown",
      server.port ? `:${server.port}` : "",
    ].filter(Boolean).join(" · "),
    detail: t({
      zh: `打开 ${server.name} 的管理工作区。\n\nURL: ${server.base_url}\n状态: ${server.status ?? "unknown"}\n目标: ${server.target ?? "manual"}\n源码: ${server.project_dir ?? "未登记"}\n日志: ${server.log_path ?? "无"}\n管理员: ${server.admin_id ?? "需要登录"}`,
      en: `Open management for ${server.name}.\n\nURL: ${server.base_url}\nStatus: ${server.status ?? "unknown"}\nTarget: ${server.target ?? "manual"}\nSource: ${server.project_dir ?? "not registered"}\nLog: ${server.log_path ?? "none"}\nAdministrator: ${server.admin_id ?? "login required"}`,
    }),
  }));

  const items: tui_list_item[] = [
    ...downtown_items,
    {
      id: "add_downtown",
      title: downtown_items.length === 0
        ? t({ zh: "添加第一个 Downtown", en: "Add First Downtown" })
        : t({ zh: "添加 Downtown", en: "Add Downtown" }),
      subtitle: t({ zh: "配置已部署 Downtown URL", en: "Configure a deployed Downtown URL" }),
      detail: downtown_items.length === 0
        ? t({
          zh: "当前没有已保存的 Downtown。先添加一个已经部署好的 Downtown 入口地址。",
          en: "No Downtown is saved yet. Add the URL of an already deployed Downtown first.",
        })
        : t({
          zh: "保存一个已经部署好的 Downtown 入口地址。保存后会出现在首页列表中，点击即可进入管理。",
          en: "Save the URL of an already deployed Downtown. It will appear in the home list, where selecting it opens management.",
        }),
    },
    {
      id: "create_downtown",
      title: t({ zh: "创建 Downtown", en: "Create Downtown" }),
      subtitle: t({ zh: "交互式创建 Downtown 项目骨架", en: "Interactively scaffold a Downtown project" }),
      detail: t({
        zh: "在当前目录创建默认 Local Node.js Downtown 项目。",
        en: "Create the default Local Node.js Downtown project in the current directory.",
      }),
    },
    {
      id: "deploy_downtown",
      title: t({ zh: "部署 Downtown", en: "Deploy Downtown" }),
      subtitle: t({ zh: "部署当前目录的 Downtown 项目", en: "Deploy the Downtown project in the current directory" }),
      detail: t({
        zh: "读取 downtown.toml，在本地或云端部署当前 Downtown。",
        en: "Read downtown.toml and deploy the current Downtown locally or remotely.",
      }),
    },
    {
      id: "more",
      title: t({ zh: "更多", en: "More" }),
      subtitle: t({ zh: "语言、升级等设置", en: "Language, upgrade, and more" }),
      detail: t({
        zh: "进入更多操作，查看语言切换和 CLI 升级等设置。",
        en: "Open more actions for language switching and CLI upgrade settings.",
      }),
    },
    {
      id: "quit",
      title: t({ zh: "退出", en: "Exit" }),
      subtitle: t({ zh: "关闭 downtown", en: "Close downtown" }),
      detail: t({
        zh: "退出当前 downtown TUI。",
        en: "Exit the current downtown TUI.",
      }),
    },
  ];

  return {
    title: `Downcity Downtown v${version}`,
    subtitle: t({
      zh: config.servers.length > 0
        ? "选择一个 Downtown 进入管理"
        : "先添加一个已部署 Downtown，或创建/部署新 Downtown",
      en: config.servers.length > 0
        ? "Choose a Downtown to manage"
        : "Add a deployed Downtown first, or create/deploy a new Downtown",
    }),
    footer: t({
      zh: "Enter 进入 · Esc / q 退出 · ↑↓ 切换",
      en: "Enter open · Esc / q quit · ↑↓ navigate",
    }),
    items,
  };
}

function read_downtown_cli_version(): string {
  try {
    // 文件位于 packages/cli/src/downtown/tui/DowntownDashboard.ts，
    // 构建后位于 packages/cli/bin/downtown/tui/DowntownDashboard.js，
    // 因此 ../../../package.json 始终指向 CLI 包根目录的 package.json。
    const package_json_path = new URL("../../../package.json", import.meta.url);
    const package_json = JSON.parse(readFileSync(package_json_path, "utf8")) as {
      version?: string;
    };
    return String(package_json.version ?? "unknown");
  } catch {
    return "unknown";
  }
}
