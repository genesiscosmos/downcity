/**
 * Desktop 命令面板的公共类型。
 *
 * 本文件必须保持「只含类型 + 常量」：纯逻辑模块（registry / filter / shortcut_display）
 * 需要能被 `node --test` 直接加载，因此这里不允许出现任何运行时导入。
 */

import type { ReactNode } from "react";
import type { NavigationTarget, SidebarMode } from "@/types/DesktopView";

/** 命令分组；视觉顺序由 `command_group_order` 固定。 */
export type CommandGroupId = "navigation" | "goto" | "create" | "chat" | "appearance" | "account";

/** 命令 id 的命名空间前缀，与 CommandGroupId 一一对应。 */
export const command_group_order: readonly CommandGroupId[] = ["navigation", "goto", "create", "chat", "appearance", "account"];

/**
 * 命令 id 的命名空间前缀。
 *
 * 约定：`<group>.<name>`，且 group 必须是 CommandGroupId 之一。
 * 这保证生产构建下命令 id 冲突有规律可循，也让控制台报错可读。
 */
export const command_id_prefixes: Readonly<Record<CommandGroupId, string>> = {
  navigation: "nav.",
  goto: "goto.",
  create: "create.",
  chat: "chat.",
  appearance: "appearance.",
  account: "account.",
};

/** 面板当前页面；深度固定为 2，不实现多层栈。 */
export type CommandPage = "root" | "workspaces" | "agents" | "sessions" | "plugins";

/** 面板关闭时复位到的页面。 */
export const command_root_page: CommandPage = "root";

/** 子页面 → 进入该页面的命令 id；两侧必须保持一致。 */
export const command_page_entry_ids: Readonly<Record<Exclude<CommandPage, "root">, string>> = {
  workspaces: "goto.workspace",
  agents: "goto.agent",
  sessions: "goto.session",
  plugins: "nav.open-plugin-view",
};

/**
 * 命令 id → 子页面。
 *
 * 面板据此在调用 `run` **之前**决定「留在面板内」还是「先关闭再执行」：
 * 子页面入口必须先留在面板内，否则用户会看到面板闪烁。
 */
export const command_entry_pages: Readonly<Record<string, Exclude<CommandPage, "root">>> = {
  "goto.workspace": "workspaces",
  "goto.agent": "agents",
  "goto.session": "sessions",
  "nav.open-plugin-view": "plugins",
};

/** 子页面的搜索框占位文案 key 后缀。 */
export const command_page_placeholder_keys: Readonly<Record<CommandPage, string>> = {
  root: "command_palette.placeholder",
  workspaces: "command_palette.placeholder.workspaces",
  agents: "command_palette.placeholder.agents",
  sessions: "command_palette.placeholder.sessions",
  plugins: "command_palette.placeholder.plugins",
};

/** 子页面的空状态文案 key；`sessions` 另有加载态 key。 */
export const command_page_empty_keys: Readonly<Record<CommandPage, string>> = {
  root: "command_palette.empty",
  workspaces: "command_palette.empty.workspaces",
  agents: "command_palette.empty.agents",
  sessions: "command_palette.empty.sessions",
  plugins: "command_palette.empty.plugins",
};

/** `sessions` 子页面在导航索引尚未水合时使用的加载文案 key。 */
export const command_page_loading_key = "command_palette.empty.sessions_loading";

/** 分组标签文案 key。 */
export const command_group_label_keys: Readonly<Record<CommandGroupId, string>> = {
  navigation: "command_palette.group.navigation",
  goto: "command_palette.group.goto",
  create: "command_palette.group.create",
  chat: "command_palette.group.chat",
  appearance: "command_palette.group.appearance",
  account: "command_palette.group.account",
};

/**
 * 当前 Session 的只读投影。
 *
 * 由面板在构建 CommandContext 时一次性解析，命令不需要自己去猜「当前会话是谁」。
 */
export interface CommandActiveSession {
  /** Session 所属 Workspace。 */
  workspace_id: string;
  /** 执行该 Session 的 Agent。 */
  agent_id: string;
  /** Session 标识；Draft 页面下为 draft id。 */
  session_id: string;
  /** 是否为尚未持久化的 Draft。 */
  is_draft: boolean;
  /** 运行态是否仍占用执行槽（submitted / streaming / waiting_input）。 */
  is_busy: boolean;
  /** 是否仍有更早的历史 Segment 可加载。 */
  has_more_history: boolean;
}

/**
 * 命令求值时可见的导航上下文。
 *
 * 只含只读投影，不携带 store 与 actions：命令在注册时通过闭包捕获 actions，
 * 因此本对象可被纯函数化，也让 filter / 命令判定可在 Node 中直接测试。
 */
export interface CommandContext {
  /** 当前一级侧栏。 */
  sidebar_mode: SidebarMode;
  /** 当前主视图使用的 Workspace；为空表示尚未选择。 */
  active_workspace_id: string;
  /** 当前导航目标的判别字段；无目标时为 null。 */
  selection_kind: NavigationTarget["kind"] | null;
  /** 当前 Agent / Group 会话投影；不在会话上下文时为 null。 */
  active_session: CommandActiveSession | null;
  /** 当前可见的一级 Plugin 入口数量，用于判断是否需要展示 Plugin 子页面入口。 */
  visible_plugin_count: number;
}

/** 一条可注册命令。 */
export interface CommandDefinition {
  /** 全局唯一标识；命名空间为 `<group>.<name>`，冲突在开发构建下直接抛错。 */
  id: string;
  /** 用户可见标题；必须来自 i18n，不允许写中英文字面量。 */
  title: string;
  /** 所属分组。 */
  group: CommandGroupId;
  /** 检索关键词；必须同时包含中英文别名与能力同义词。 */
  keywords?: readonly string[];
  /** 分组内排序；数字小的靠前，缺省为 0。 */
  order?: number;
  /** 左侧图标；渲染层统一约束为 16px。 */
  icon?: ReactNode;
  /** 右侧键位展示文本；由 format_shortcut 生成，或写死为 "Esc"。 */
  shortcut?: string;
  /** 右侧尾部装饰；子页面入口使用 TbChevronRight。 */
  trailing?: ReactNode;
  /** 返回 false 时整条命令不出现在列表中。 */
  when?: (context: CommandContext) => boolean;
  /** 返回 false 时命令保留但置灰。 */
  enabled?: (context: CommandContext) => boolean;
  /** 置灰原因；展示在行内并提供给屏幕阅读器。 */
  disabled_reason?: string;
  /**
   * 执行命令。
   *
   * 返回 false 表示留在面板内（由面板在进入子页面前自行处理）；
   * 其余返回值（含 undefined）都表示命令已受理，面板关闭后执行。
   */
  run: (context: CommandContext) => boolean | void | Promise<boolean | void>;
}

/** 一次求值的结果：命令 + 当前可用性。 */
export interface RankedCommand extends CommandDefinition {
  /** 当前上下文下是否可执行。 */
  is_enabled: boolean;
}

/**
 * 子页面中的一行。
 *
 * 与命令共用同一套行渲染，因此只需提供「标题 + 副标题 + 选中态 + 行为」。
 */
export interface CommandPageItem {
  /** 稳定标识；同时作为 `aria-activedescendant` 的 id 片段。 */
  id: string;
  /** 行主文案。 */
  title: string;
  /** 行副文案；可为空。 */
  subtitle?: string;
  /** 左侧图标。 */
  icon?: ReactNode;
  /** 是否为当前项；展示对勾并设置 aria-current。 */
  is_current?: boolean;
  /** 选中行为。 */
  run: () => void | Promise<void>;
}

/**
 * Shell 向命令面板提供的、不属于任何 domain store 的能力。
 *
 * 只含 Shell 自己拥有的状态与动作：侧栏折叠、新建 Workspace 对话框、
 * 以及从现有 ⌘R 分支提炼出的「在当前上下文新建对话」。
 */
export interface ShellCommandEnvironment {
  /** 左侧侧栏是否折叠。 */
  sidebar_collapsed: boolean;
  /** 切换左侧侧栏。 */
  toggle_sidebar(): void;
  /** 右侧 BayBar 是否收起；用于命令标题在展开/收起之间切换。 */
  baybar_collapsed: boolean;
  /** 切换右侧 BayBar。 */
  toggle_baybar(): void;
  /** 打开新建 Workspace 对话框。 */
  open_create_workspace(): void;
  /** 按当前导航目标新建对话；键位与命令共用同一实现。 */
  create_conversation_in_context(): void;
}

/** 判断命令 id 是否遵循分组命名空间约定。 */
export function is_command_id_in_group(id: string, group: CommandGroupId): boolean {
  return id.startsWith(command_id_prefixes[group]);
}
