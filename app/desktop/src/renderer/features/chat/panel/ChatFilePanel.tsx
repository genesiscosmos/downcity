/**
 * Chat 侧栏的「文件」域。
 *
 * 对话里的文件链接此前会切走整个主视图到 Workspace 页；现在改为就地打开：
 * 点击链接只把文件放进这一域，对话保持在原位，右侧面板自动展开到该文件。
 *
 * 两个边界：
 * 1. **打开动作必须在 MainView 的 children 内部提供。** 展开与切换域需要
 *    `use_baybar_open()`，它只有 MainView 子树内才有实现；状态本身仍由
 *    MainView 的父级持有（与「本轮」域同一套做法），这样域内容与动作共享同一份状态。
 * 2. **面板只服务当前 Workspace。** 指向其它 Workspace 的文件链接不由这里处理，
 *    仍交给 Shell 的路由，避免在 A 工作区的对话里预览 B 工作区的文件。
 *
 * ## 绝对路径为什么要一路带进来
 *
 * 文件操作菜单里的「复制链接」与「用系统默认应用打开」都需要 Workspace 的绝对路径，
 * 而标签页内容必须**自解析**（不能依赖构造它的那个视图的临时状态，否则切走视图后
 * 已打开的标签页会渲染成空）。因此路径不是从当前视图现取，而是在打开文件时
 * 随标签页一起捕获，与 `view_key` / `workspace_id` 同路。
 */

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { TbFile } from "react-icons/tb";
import { use_baybar_open, baybar_tab_id, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";
import { is_markdown_document } from "@/lib/workspace/workspace_file_preview";
import { WorkspaceFileActionsMenu } from "@/features/workspace/components/WorkspaceFileActionsMenu";
import { WorkspaceFileMarkdownBody, WorkspaceFilePlaceholder, WorkspaceFileSourceBody, use_workspace_file_view_mode, use_workspace_text_file } from "@/features/workspace/components/WorkspaceFilePreview";
import { chat_file_panel_storage_key, format_chat_panel_file, parse_chat_panel_file, type ChatPanelFile } from "./chat_file_panel_state";

/** 「文件」tab 的种类标识；完整 id 还需拼上具体的 Chat 标识。 */
export const FILE_TAB_KIND = "files";

/** 「文件」域唯一分区的稳定标识。 */
export const FILE_SECTION_ID = "preview";

/** 在 Chat 侧栏打开一个文件。 */
export type ChatFilePanelOpen = (relative_path: string, line?: number) => void;

const ChatFilePanelContext = createContext<ChatFilePanelOpen | undefined>(undefined);

/** 读取 Chat 侧栏的文件打开动作；不在 Chat 表面内时为空。 */
export function use_chat_file_panel(): ChatFilePanelOpen | undefined {
  return useContext(ChatFilePanelContext);
}

/**
 * 各 Chat 当前打开的文件。
 *
 * 必须是**模块级共享状态**而不是某个组件的 useState：
 * 写入方是正文（点击文件链接），读取方是面板里的「文件」tab，
 * 两者不在同一棵子树里（面板在壳层，会被不同的会话复用），
 * 所以它们必须订阅同一份数据；否则面板永远看不到刚刚点开的那个文件。
 * localStorage 仍然是落盘来源（按 view_key 隔离，重启后恢复）。
 */
const panel_file_by_view = new Map<string, ChatPanelFile | undefined>();
const panel_file_listeners = new Set<() => void>();

/** 订阅所有 Chat 文件面板变化；写入频率极低（用户点文件），不需要按 view_key 细分。 */
function subscribe_panel_file(listener: () => void): () => void {
  panel_file_listeners.add(listener);
  return () => { panel_file_listeners.delete(listener); };
}

/** 读取某个 Chat 当前打开的文件；首次访问时从 localStorage 惰性恢复。 */
function read_panel_file(view_key: string): ChatPanelFile | undefined {
  if (!panel_file_by_view.has(view_key)) {
    panel_file_by_view.set(view_key, parse_chat_panel_file(localStorage.getItem(chat_file_panel_storage_key(view_key))));
  }
  return panel_file_by_view.get(view_key);
}

/** 写入某个 Chat 当前打开的文件，并通知所有订阅者。 */
function write_panel_file(view_key: string, file: ChatPanelFile): void {
  panel_file_by_view.set(view_key, file);
  localStorage.setItem(chat_file_panel_storage_key(view_key), format_chat_panel_file(file));
  for (const listener of panel_file_listeners) listener();
}

/** 按 Chat 视图订阅当前打开的文件。 */
export function use_chat_panel_file(view_key: string): ChatPanelFile | undefined {
  return useSyncExternalStore(
    subscribe_panel_file,
    () => read_panel_file(view_key),
    () => read_panel_file(view_key),
  );
}

/**
 * 向 Chat 正文提供「在侧栏打开文件」的动作。
 *
 * 必须渲染在 MainView 的 children 内部：展开面板与切换域都依赖 BayBar 的打开动作。
 */
export function ChatFilePanelProvider({ view_key, workspace_id, workspace_path, children }: {
  /** 当前 Chat 的稳定标识；文件按它隔离。 */
  view_key: string;
  /** 当前对话所属 Workspace；决定能预览哪个工作区的文件。 */
  workspace_id: string;
  /** 当前 Workspace 的绝对路径；用于「复制链接」与「用系统默认应用打开」。 */
  workspace_path?: string;
  /** Chat 正文。 */
  children: ReactNode;
}) {
  const translate_chat = use_translation("chat");
  const open_baybar = use_baybar_open();
  const open_file = useCallback<ChatFilePanelOpen>((relative_path, line) => {
    write_panel_file(view_key, { relative_path, ...(line ? { line } : {}) });
    // 标题取当前文件的名字，所以点另一个文件时标签页标题会跟着换。
    open_baybar(files_tab(view_key, workspace_id, workspace_path, relative_path, translate_chat), FILE_SECTION_ID);
  }, [open_baybar, translate_chat, view_key, workspace_id, workspace_path]);
  return <ChatFilePanelContext.Provider value={open_file}>{children}</ChatFilePanelContext.Provider>;
}

/**
 * 构造「文件」标签页。
 *
 * 在点开文件链接时调用；内容自解析（只带 view_key 与 workspace_id），
 * 所以切换会话后已打开的标签页依旧显示它自己那个会话的文件。
 *
 * 标题是**这个文件的名字**（路径最后一段），而不是「文件」这类固定文案：
 * 点另一个文件会以同一个 id 重新打开，store 会刷新标题，标签行上跟着换成新文件名。
 */
export function files_tab(view_key: string, workspace_id: string, workspace_path: string | undefined, relative_path: string, t_chat: BayBarTranslate): BayBarTab {
  return {
    id: baybar_tab_id(FILE_TAB_KIND, view_key),
    label: file_display_name(relative_path),
    // 图标保持通用文件图标：标签行里只有 14px，语言图标在这个尺寸下分辨不出来。
    icon: <TbFile />,
    sections: [{
      id: FILE_SECTION_ID,
      label: t_chat("file_panel.domain"),
      content: <ChatFilesTab view_key={view_key} workspace_id={workspace_id} workspace_path={workspace_path} />,
    }],
  };
}

/**
 * 取文件路径的显示名：最后一段。
 *
 * 同时兼容 Windows 分隔符（后端上报的路径可能是反斜杠）。
 */
function file_display_name(relative_path: string): string {
  return relative_path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? relative_path;
}

/**
 * 「文件」tab 的自解析内容。
 *
 * 只依赖 view_key 与 workspace_id：正文是否还在渲染都不影响它，
 * 所以切换会话后，已打开的「文件」tab 依旧显示它自己那个会话的文件。
 */
export function ChatFilesTab({ view_key, workspace_id, workspace_path }: {
  /** 所属 Chat 的稳定标识。 */
  view_key: string;
  /** 文件所属 Workspace；决定能预览哪个工作区的文件。 */
  workspace_id: string;
  /** 文件所属 Workspace 的绝对路径；用于文件操作菜单。 */
  workspace_path?: string;
}) {
  const file = use_chat_panel_file(view_key);
  return <ChatFilePanelContent workspace_id={workspace_id} workspace_path={workspace_path} file={file} />;
}

/** 「文件」域内容：当前打开文件的只读预览，未打开时为引导空态。 */
export function ChatFilePanelContent({ workspace_id, workspace_path, file }: {
  /** 当前对话所属 Workspace。 */
  workspace_id: string;
  /** 当前 Workspace 的绝对路径；未登记时为空。 */
  workspace_path?: string;
  /** 当前打开的文件；为空时展示空态。 */
  file?: ChatPanelFile;
}) {
  const translate_chat = use_translation("chat");
  const relative_path = file?.relative_path ?? "";
  const line = file?.line;
  const [view_mode, set_view_mode] = use_workspace_file_view_mode(relative_path, line);
  const { file: text_file, error } = use_workspace_text_file(workspace_id, relative_path);
  const markdown_document = is_markdown_document(relative_path);
  if (!file) return <div className="px-4 py-6 text-xs leading-5 text-muted-foreground">{translate_chat("file_panel.empty")}</div>;
  const show_source = !markdown_document || view_mode === "source";
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-2 border-b border-divider px-4 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground" title={relative_path}>{relative_path}</span>
      {/* 文件未读到时不给操作菜单：「复制全文」此时只能复制空字符串。 */}
      {text_file ? <WorkspaceFileActionsMenu relative_path={relative_path} workspace_path={workspace_path} line={line} markdown_document={markdown_document} view_mode={view_mode} on_view_mode_change={set_view_mode} content={text_file.content} /> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      {!text_file ? <WorkspaceFilePlaceholder error={error} /> : show_source ? <WorkspaceFileSourceBody file={text_file} relative_path={relative_path} line={line} class_name="px-4 py-3" /> : <WorkspaceFileMarkdownBody content={text_file.content} class_name="px-4 py-4" />}
    </div>
  </div>;
}
