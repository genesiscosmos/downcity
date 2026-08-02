/**
 * City 顶层全屏 TUI 仪表盘。
 *
 * 关键点（中文）
 * - 这是裸 `city` 的默认入口。
 * - City 根入口没有独立启动态，只汇总 Agent、Federation、Plugin 与设置。
 * - 单栏列表承载动作菜单，底部展示当前动作的轻量说明。
 * - 动作结束后返回仪表盘，形成统一终端操作台体验。
 */

import { readFileSync } from "node:fs";
import { read_federation_membership_state } from "@/city/shared/FederationConnection.js";
import { getCliLocale, t } from "@/shared/CliLocale.js";
import { resolveRunningManagedAgents } from "@/city/shared/CityAgentRuntime.js";
import type { FederationMembershipState } from "@/city/types/FederationMembership.js";
import type { tui_action_result, tui_list_item } from "@/city/types/Tui.js";
import { run_managed_dashboard_loop } from "@/shared/tui/ManagedTuiRuntime.js";

type city_home_action =
  | "federation"
  | "agent"
  | "plugin"
  | "language"
  | "help"
  | "exit";

interface city_dashboard_options {
  /** 执行顶层动作。 */
  run_action: (action: city_home_action) => Promise<tui_action_result>;
}

interface city_dashboard_state {
  title: string;
  subtitle: string;
  footer: string;
  items: tui_list_item[];
}

/**
 * 打开 City 顶层仪表盘。
 */
export async function open_city_dashboard(
  options: city_dashboard_options,
): Promise<void> {
  await run_managed_dashboard_loop<city_home_action>({
    runtime_title: "Downcity City",
    build_state: build_city_dashboard_state,
    run_action: options.run_action,
  });
}

async function build_city_dashboard_state(): Promise<city_dashboard_state> {
  const version = read_city_cli_version();
  const locale = getCliLocale();
  const city_state = read_federation_membership_state();
  const managed_agents = await safe_count_running_agents();

  const items: tui_list_item[] = [
    section_item("management", t({ zh: "管理", en: "Management" })),
    {
      id: "agent",
      title: t({ zh: "Agent 管理", en: "Agent management" }),
      subtitle: t({
        zh: `${managed_agents} 个运行中 agent`,
        en: `${managed_agents} running agents`,
      }),
      detail: t({
        zh: "进入 Agent 列表。点进某个 Agent 后可启动、停止、重启、聊天或修改配置。",
        en: "Open the Agent list. Select an agent to start, stop, restart, chat, or edit settings.",
      }),
    },
    {
      id: "federation",
      title: t({ zh: "Federation", en: "Federation" }),
      subtitle: build_federation_subtitle(city_state),
      detail: build_federation_detail(city_state),
    },
    {
      id: "plugin",
      title: t({ zh: "Plugin 能力", en: "Plugin capabilities" }),
      subtitle: t({
        zh: "查看 plugin 目录、Chat 共享资源与能力边界",
        en: "inspect plugins, Chat shared resources, and capability boundaries",
      }),
      detail: t({
        zh: "进入 Plugin 能力管理器。Chat 共享资源已归入这里；这里也展示当前已注册的 plugin、actions、system 能力和运行边界。",
        en: "Open the Plugin capability manager. Chat shared resources now live here, alongside registered plugins, actions, system capabilities, and runtime boundaries.",
      }),
    },
    section_item("settings", t({ zh: "设置", en: "Settings" })),
    {
      id: "language",
      title: t({ zh: "切换语言", en: "Language" }),
      subtitle: locale === "zh"
        ? t({ zh: "当前默认语言：中文", en: "Current default language: Chinese" })
        : t({ zh: "当前默认语言：英文", en: "Current default language: English" }),
      detail: t({
        zh: "切换 City CLI 的默认语言，并保存到本地状态里。",
        en: "Switch the default City CLI language and persist it into local state.",
      }),
    },
    {
      id: "help",
      title: t({ zh: "查看帮助", en: "Show help" }),
      subtitle: t({ zh: "输出 `city --help`", en: "print `city --help`" }),
      detail: t({
        zh: "输出当前 City 根命令帮助，适合查阅脚本化子命令。",
        en: "Print the current City root help, useful when looking up scriptable subcommands.",
      }),
    },
    section_item("actions", t({ zh: "操作", en: "Actions" })),
    {
      id: "exit",
      title: t({ zh: "退出", en: "Exit" }),
      subtitle: t({ zh: "关闭当前界面", en: "Close this view" }),
      detail: t({
        zh: "退出当前 City CLI。",
        en: "Exit the current City CLI.",
      }),
    },
  ];

  return {
    title: `City v${version}`,
    subtitle: t({
      zh: `Federation：${build_federation_subtitle(city_state)} · agent：${managed_agents}`,
      en: `Federation: ${build_federation_subtitle(city_state)} · agents: ${managed_agents}`,
    }),
    footer: t({
      zh: "Enter 进入动作 · Esc / q 退出 · ↑↓ 切换 · 当前入口：全屏 TUI",
      en: "Enter run action · Esc / q quit · ↑↓ navigate · current entry: full-screen TUI",
    }),
    items,
  };
}

async function safe_count_running_agents(): Promise<number> {
  try {
    return (await resolveRunningManagedAgents({ syncRegistry: false })).length;
  } catch {
    return 0;
  }
}

function build_federation_subtitle(city_state: FederationMembershipState): string {
  if (city_state.has_user_token) {
    return t({
      zh: `${city_state.federation_url} · 已登录`,
      en: `${city_state.federation_url} · signed in`,
    });
  }

  return t({
    zh: `${city_state.federation_url} · 未登录`,
    en: `${city_state.federation_url} · not signed in`,
  });
}

function build_federation_detail(city_state: FederationMembershipState): string {
  return t({
    zh: [
      `{bold}当前 City 连接{/bold}`,
      `base：${city_state.federation_url}`,
      `source：${city_state.source}`,
      `city id：${city_state.bureau_id}`,
      `user token：${configured_state_text(city_state.has_user_token)}`,
      city_state.user_id ? `user id：${city_state.user_id}` : "",
      "",
      "选择后进入 `city federation` 交互管理器，继续 join / use / login / recharge 等流程。",
    ].filter(Boolean).join("\n"),
    en: [
      `{bold}Current City connection{/bold}`,
      `base: ${city_state.federation_url}`,
      `source: ${city_state.source}`,
      `city id: ${city_state.bureau_id}`,
      `user token: ${configured_state_text(city_state.has_user_token)}`,
      city_state.user_id ? `user id: ${city_state.user_id}` : "",
      "",
      "Selecting this opens the `city federation` interactive manager for join, use, login, recharge, and related flows.",
    ].filter(Boolean).join("\n"),
  });
}

/**
 * 配置状态显示文案。
 */
function configured_state_text(configured: boolean): string {
  return configured
    ? t({ zh: "已配置", en: "configured" })
    : t({ zh: "缺失", en: "missing" });
}

function section_item(id: string, title: string): tui_list_item {
  return {
    id: `section:${id}`,
    title,
    subtitle: "",
    detail: "",
    disabled: true,
  };
}


function read_city_cli_version(): string {
  try {
    // 文件位于 packages/cli/src/city/tui/CityDashboard.ts，
    // 构建后位于 packages/cli/bin/city/tui/CityDashboard.js，
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
