/**
 * Desktop 命令面板的内置命令。
 *
 * 按分组拆成 6 个 Hook，每组独立注册。新增一条命令只需在这里增加一个对象，
 * 面板组件与检索逻辑都不需要修改。
 *
 * 硬约束（PRD 7.5）：这里不允许注册不可逆命令。面板是低摩擦表面，
 * 删除 / 退出登录 / 清空配置必须走各自带有确认步骤的页面入口。
 */

import {
  TbArchive,
  TbArrowLeft,
  TbChevronRight,
  TbComponents,
  TbFolder,
  TbFolderPlus,
  TbHistory,
  TbLayoutSidebar,
  TbLayoutSidebarRight,
  TbMessageCircle,
  TbMoodNeutral,
  TbMoon,
  TbPalette,
  TbPlayerStop,
  TbPlugConnected,
  TbPlus,
  TbRefresh,
  TbSettings,
  TbSphere2,
  TbSun,
  TbUser,
  TbUsers,
} from "react-icons/tb";
import { use_desktop_selector } from "@/app/use_desktop";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { order_rail_powers } from "@/features/navigation/lib/sidebar_shortcut";
import { detect_shortcut_platform, resolve_command_shortcut } from "./shortcut_display.ts";
import type { ShellCommandEnvironment } from "./types.ts";
import { use_register_commands } from "./use_commands.ts";
import { use_translation } from "@/locales/i18n";
import { is_chat_busy, type DesktopController } from "@/types/DesktopView";

/** 内置命令提供者的属性。 */
interface CommandProvidersProps {
  /** Renderer 稳定控制器。 */
  controller: DesktopController;
  /** Shell 级状态与动作。 */
  shell: ShellCommandEnvironment;
}

/**
 * 注册全部内置命令。
 *
 * 不渲染任何内容；它的存在只是把命令的生命周期绑定到应用壳上。
 */
export function CommandProviders({ controller, shell }: CommandProvidersProps) {
  use_navigation_commands(controller, shell);
  use_goto_commands(controller);
  use_create_commands(controller, shell);
  use_session_commands(controller);
  use_appearance_commands(controller);
  use_account_commands(controller);
  return null;
}

/** 导航分组：一级入口、设置、侧栏。 */
function use_navigation_commands(controller: DesktopController, shell: ShellCommandEnvironment) {
  const translate = use_translation("common");
  const platform = detect_shortcut_platform();
  const power_count = use_desktop_selector(controller.stores.catalog, (state) => order_rail_powers(state.powers).length);
  const selection_kind = use_desktop_selector(controller.stores.navigation, (state) => state.selection?.kind ?? null);
  const actions = controller.actions;

  use_register_commands(
    () => [
      {
        id: "nav.open-chat",
        title: translate("command_palette.cmd.nav.open-chat"),
        group: "navigation",
        order: 0,
        icon: <TbMoodNeutral className="size-4" />,
        shortcut: resolve_command_shortcut("nav.open-chat", platform),
        keywords: ["chat", "agent", "conversation", "聊天", "对话", "智能体"],
        run: () => actions.set_sidebar_mode("chat"),
      },
      {
        id: "nav.open-workspace",
        title: translate("command_palette.cmd.nav.open-workspace"),
        group: "navigation",
        order: 1,
        icon: <TbFolder className="size-4" />,
        shortcut: resolve_command_shortcut("nav.open-workspace", platform),
        keywords: ["workspace", "folder", "files", "工作区", "空间", "目录", "文件"],
        run: () => actions.set_sidebar_mode("workspace"),
      },
      {
        id: "nav.open-powers",
        title: translate("command_palette.cmd.nav.open-powers"),
        group: "navigation",
        order: 2,
        icon: <TbComponents className="size-4" />,
        shortcut: resolve_command_shortcut("nav.open-powers", platform),
        keywords: ["power", "powers", "extension", "插件", "扩展"],
        run: () => actions.set_sidebar_mode("powers"),
      },
      {
        id: "nav.open-power-view",
        title: translate("command_palette.cmd.nav.open-power-view"),
        group: "navigation",
        order: 3,
        icon: <TbPlugConnected className="size-4" />,
        trailing: <TbChevronRight className="size-3.5 text-subtle-foreground" />,
        keywords: ["power", "powers", "extension", "插件", "扩展"],
        when: () => power_count > 0,
        // 子页面入口：面板在调用 run 之前已拦截并留在面板内，这里的返回值不会被使用。
        run: () => false,
      },
      {
        id: "nav.toggle-sidebar",
        title: translate(shell.sidebar_collapsed ? "command_palette.cmd.nav.toggle-sidebar-show" : "command_palette.cmd.nav.toggle-sidebar-hide"),
        group: "navigation",
        order: 4,
        icon: <TbLayoutSidebar className="size-4" />,
        shortcut: resolve_command_shortcut("nav.toggle-sidebar", platform),
        keywords: ["sidebar", "panel", "layout", "侧栏", "侧边栏", "面板"],
        run: () => shell.toggle_sidebar(),
      },
      {
        id: "nav.toggle-baybar",
        title: translate(shell.baybar_collapsed ? "command_palette.cmd.nav.toggle-baybar-show" : "command_palette.cmd.nav.toggle-baybar-hide"),
        group: "navigation",
        order: 5,
        icon: <TbLayoutSidebarRight className="size-4" />,
        shortcut: resolve_command_shortcut("nav.toggle-baybar", platform),
        keywords: ["baybar", "panel", "right", "tab", "右侧", "面板", "标签"],
        run: () => shell.toggle_baybar(),
      },
      {
        id: "nav.open-settings",
        title: translate("command_palette.cmd.nav.open-settings"),
        group: "navigation",
        order: 6,
        icon: <TbSettings className="size-4" />,
        shortcut: resolve_command_shortcut("nav.open-settings", platform),
        keywords: ["settings", "preferences", "config", "设置", "偏好", "配置"],
        run: () => actions.open_settings("user"),
      },
      {
        id: "nav.back-from-settings",
        title: translate("command_palette.cmd.nav.back-from-settings"),
        group: "navigation",
        order: 7,
        icon: <TbArrowLeft className="size-4" />,
        shortcut: resolve_command_shortcut("nav.back-from-settings", platform),
        keywords: ["back", "return", "close", "返回", "退出设置"],
        when: () => selection_kind === "settings",
        run: () => actions.close_settings(),
      },
    ],
    [actions, platform, power_count, selection_kind, shell.baybar_collapsed, shell.sidebar_collapsed, shell.toggle_baybar, shell.toggle_sidebar, translate],
  );
}

/** 跳转分组：数据驱动的子页面入口。 */
function use_goto_commands(controller: DesktopController) {
  const translate = use_translation("common");
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const active_workspace_id = use_desktop_selector(controller.stores.navigation, (state) => state.active_workspace_id);
  const has_workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces.length > 0);

  use_register_commands(
    () => [
      {
        id: "goto.workspace",
        title: translate("command_palette.cmd.goto.workspace"),
        group: "goto",
        order: 0,
        icon: <TbSphere2 className="size-4" />,
        trailing: <TbChevronRight className="size-3.5 text-subtle-foreground" />,
        keywords: ["workspace", "switch", "open", "工作区", "空间", "切换", "打开"],
        when: () => has_workspaces,
        // 子页面入口：面板在调用 run 之前已拦截并留在面板内，这里的返回值不会被使用。
        run: () => false,
      },
      {
        id: "goto.session",
        title: translate("command_palette.cmd.goto.session"),
        group: "goto",
        order: 1,
        icon: <TbMessageCircle className="size-4" />,
        trailing: <TbChevronRight className="size-3.5 text-subtle-foreground" />,
        keywords: ["session", "chat", "conversation", "history", "会话", "对话", "历史"],
        when: () => Boolean(active_workspace_id),
        run: () => false,
      },
      {
        id: "goto.agent",
        title: translate("command_palette.cmd.goto.agent"),
        group: "goto",
        order: 2,
        icon: <TbUser className="size-4" />,
        trailing: <TbChevronRight className="size-3.5 text-subtle-foreground" />,
        keywords: ["agent", "assistant", "bot", "智能体", "助手"],
        when: () => agents.length > 0,
        run: () => false,
      },
    ],
    [active_workspace_id, agents.length, has_workspaces, translate],
  );
}

/** 新建分组。 */
function use_create_commands(controller: DesktopController, shell: ShellCommandEnvironment) {
  const translate = use_translation("common");
  const platform = detect_shortcut_platform();
  const selection_kind = use_desktop_selector(controller.stores.navigation, (state) => state.selection?.kind ?? null);
  const actions = controller.actions;

  use_register_commands(
    () => [
      {
        id: "create.conversation",
        title: translate("command_palette.cmd.create.conversation"),
        group: "create",
        order: 0,
        icon: <TbPlus className="size-4" />,
        shortcut: resolve_command_shortcut("create.conversation", platform),
        keywords: ["new", "chat", "session", "conversation", "新建", "对话", "会话"],
        // 与 ⌘R 共用同一实现，避免面板与键盘分支产生两套语义。
        when: () => selection_kind !== null,
        run: () => shell.create_conversation_in_context(),      },
      {
        id: "create.agent",
        title: translate("command_palette.cmd.create.agent"),
        group: "create",
        order: 1,
        icon: <TbUser className="size-4" />,
        keywords: ["new", "agent", "assistant", "新建", "智能体", "助手"],
        run: () => actions.open_create_agent(),
      },
      {
        id: "create.group",
        title: translate("command_palette.cmd.create.group"),
        group: "create",
        order: 2,
        icon: <TbUsers className="size-4" />,
        keywords: ["new", "group", "team", "新建", "群组", "团队"],
        run: () => actions.open_create_group(),
      },
      {
        id: "create.workspace",
        title: translate("command_palette.cmd.create.workspace"),
        group: "create",
        order: 3,
        icon: <TbFolderPlus className="size-4" />,
        keywords: ["new", "workspace", "folder", "新建", "工作区", "空间", "目录"],
        run: () => shell.open_create_workspace(),
      },
    ],
    [actions, platform, selection_kind, shell.create_conversation_in_context, shell.open_create_workspace, translate],
  );
}

/** 当前会话分组；只在与会话相关的页面上出现。 */
function use_session_commands(controller: DesktopController) {
  const translate = use_translation("common");
  const active_workspace_id = use_desktop_selector(controller.stores.navigation, (state) => state.active_workspace_id);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const actions = controller.actions;

  const session = selection?.kind === "session" ? selection : null;
  // 只订阅当前 Session 的运行态与历史游标切片，而不是整个 chat_stream，避免流式输出触发命令重新注册。
  const runtime = use_desktop_selector(controller.stores.chat_stream, (state) =>
    session ? state.chat_runtime_by_session[get_session_key(session.workspace_id, session.agent_id, session.session_id)] : undefined,
  );
  const has_more_history = use_desktop_selector(controller.stores.chat_stream, (state) =>
    session ? Boolean(state.history_by_session[get_session_key(session.workspace_id, session.agent_id, session.session_id)]?.has_more) : false,
  );
  const is_busy = is_chat_busy(runtime);

  use_register_commands(
    () => [
      {
        id: "chat.stop",
        title: translate("command_palette.cmd.chat.stop"),
        group: "chat",
        order: 0,
        icon: <TbPlayerStop className="size-4" />,
        keywords: ["stop", "cancel", "abort", "interrupt", "停止", "取消", "中断"],
        when: () => session !== null,
        enabled: () => is_busy,
        disabled_reason: translate("command_palette.disabled.chat-stop"),
        run: () => {
          if (!session) return;
          return actions.stop_session(session.workspace_id, session.agent_id, session.session_id);
        },
      },
      {
        id: "chat.archive",
        title: translate("command_palette.cmd.chat.archive"),
        group: "chat",
        order: 1,
        icon: <TbArchive className="size-4" />,
        keywords: ["archive", "hide", "cleanup", "归档", "收起", "整理"],
        when: () => session !== null,
        run: () => {
          if (!session) return;
          return actions.archive_session(session.workspace_id, session.agent_id, session.session_id);
        },
      },
      {
        id: "chat.load-earlier",
        title: translate("command_palette.cmd.chat.load-earlier"),
        group: "chat",
        order: 2,
        icon: <TbHistory className="size-4" />,
        keywords: ["history", "earlier", "older", "load", "历史", "更早", "加载"],
        when: () => session !== null,
        // 没有更早历史时置灰，而不是让命令静默无效。
        enabled: () => has_more_history,
        disabled_reason: translate("command_palette.disabled.chat-history"),
        run: () => {
          if (!session || !active_workspace_id) return;
          return actions.load_earlier_history(session.workspace_id, session.agent_id, session.session_id);
        },
      },
    ],
    [actions, active_workspace_id, has_more_history, is_busy, session, translate],
  );
}

/** 外观分组。 */
function use_appearance_commands(controller: DesktopController) {
  const translate = use_translation("common");
  const appearance_mode = use_desktop_selector(controller.stores.settings, (state) => state.settings.appearance_mode);
  const is_dark = appearance_mode === "dark";
  const actions = controller.actions;

  use_register_commands(
    () => [
      {
        id: "appearance.toggle-mode",
        title: translate(is_dark ? "command_palette.cmd.appearance.toggle-light" : "command_palette.cmd.appearance.toggle-dark"),
        group: "appearance",
        order: 0,
        icon: is_dark ? <TbSun className="size-4" /> : <TbMoon className="size-4" />,
        keywords: ["theme", "appearance", "dark", "light", "mode", "主题", "外观", "深色", "浅色", "明暗"],
        run: () => actions.update_settings({ appearance_mode: is_dark ? "light" : "dark" }),
      },
      {
        id: "appearance.open",
        title: translate("command_palette.cmd.appearance.open"),
        group: "appearance",
        order: 1,
        icon: <TbPalette className="size-4" />,
        keywords: ["appearance", "theme", "color", "scale", "外观", "主题", "配色", "缩放"],
        run: () => actions.open_settings("appearance"),
      },
    ],
    [actions, is_dark, translate],
  );
}

/** 账户与模型分组。 */
function use_account_commands(controller: DesktopController) {
  const translate = use_translation("common");
  const authenticated = use_desktop_selector(controller.stores.settings, (state) => state.user.authenticated);
  const models_loading = use_desktop_selector(controller.stores.catalog, (state) => state.models_loading);
  const actions = controller.actions;

  use_register_commands(
    () => [
      {
        id: "account.refresh-models",
        title: translate("command_palette.cmd.account.refresh-models"),
        group: "account",
        order: 0,
        icon: <TbRefresh className="size-4" />,
        keywords: ["model", "refresh", "reload", "catalog", "模型", "刷新", "目录"],
        when: () => authenticated,
        enabled: () => !models_loading,
        disabled_reason: translate("state.loading"),
        run: () => actions.refresh_models(),
      },
      {
        id: "account.open-models",
        title: translate("command_palette.cmd.account.open-models"),
        group: "account",
        order: 1,
        icon: <TbComponents className="size-4" />,
        keywords: ["model", "models", "pricing", "模型", "价格", "计费"],
        run: () => actions.open_settings("models"),
      },
      {
        id: "account.open-user",
        title: translate("command_palette.cmd.account.open-user"),
        group: "account",
        order: 2,
        icon: <TbUser className="size-4" />,
        keywords: ["account", "credits", "usage", "billing", "账户", "余额", "用量", "账单"],
        run: () => actions.open_settings("user"),
      },
    ],
    [actions, authenticated, models_loading, translate],
  );
}
