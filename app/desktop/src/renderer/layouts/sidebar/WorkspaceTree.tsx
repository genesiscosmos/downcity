/** Sidebar 中以 Workspace 为根节点的本地目录树。 */

import { useState } from "react";
import { TbChevronRight, TbFile, TbFolder, TbFolderPlus, TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { DesktopWorkspaceEntry, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { SidebarContent } from "./SidebarPanel";
import { WorkspaceRowMenu } from "./WorkspaceRowMenu";

/** Workspace 目录树属性。 */
interface WorkspaceTreeProps {
  /** 已登记的 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前 MainView 打开的 Workspace。 */
  selected_workspace_id?: string;
  /** Catalog 是否仍在加载。 */
  loading: boolean;
  /** 打开 Workspace MainView。 */
  select_workspace(workspace_id: string): void;
  /** 打开 Workspace 文件。 */
  select_file(workspace_id: string, relative_path: string): void;
  /** 从 Registry 移除 Workspace。 */
  remove_workspace(workspace_id: string): Promise<void>;
  /** 打开添加 Workspace 对话框。 */
  open_create_workspace(): void;
}

/** 持有目录展开状态和懒加载缓存，并渲染完整 Workspace 树。 */
export function WorkspaceTree(props: WorkspaceTreeProps) {
  const translate = use_translation("resources");
  const [expanded_keys, set_expanded_keys] = useState<Set<string>>(new Set());
  const [entries_by_key, set_entries_by_key] = useState<Record<string, DesktopWorkspaceEntry[]>>({});
  const [loading_keys, set_loading_keys] = useState<Set<string>>(new Set());
  const toggle_directory = async (workspace_id: string, relative_path: string) => {
    const key = directory_key(workspace_id, relative_path);
    if (expanded_keys.has(key)) {
      set_expanded_keys((current) => without_key(current, key));
      return;
    }
    set_expanded_keys((current) => new Set(current).add(key));
    if (entries_by_key[key] || loading_keys.has(key)) return;
    set_loading_keys((current) => new Set(current).add(key));
    try {
      const entries = await window.downcity.workspace.list_entries(workspace_id, relative_path);
      set_entries_by_key((current) => ({ ...current, [key]: entries }));
    } finally {
      set_loading_keys((current) => without_key(current, key));
    }
  };

  return <SidebarContent>
    {props.workspaces.map((workspace) => {
      const key = directory_key(workspace.workspace_id, "");
      const expanded = expanded_keys.has(key);
      return <section key={workspace.workspace_id} className="mb-0.5"><div className={cn("group flex min-h-8 items-center gap-1 rounded-lg px-1 py-0.5", props.selected_workspace_id === workspace.workspace_id ? "bg-primary/[0.1]" : "hover:bg-foreground/[0.07]")}>
        <button type="button" aria-label={translate(expanded ? "workspace.collapse" : "workspace.expand")} title={translate(expanded ? "workspace.collapse" : "workspace.expand")} className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => void toggle_directory(workspace.workspace_id, "")}><TbChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} /></button>
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center text-left" onClick={() => props.select_workspace(workspace.workspace_id)} onDoubleClick={() => void toggle_directory(workspace.workspace_id, "")}><span className="min-w-0 flex-1 truncate text-xs font-medium">{workspace.name}</span></button>
        <WorkspaceRowMenu workspace={workspace} on_remove={props.remove_workspace} />
      </div>{expanded ? <DirectoryChildren workspace_id={workspace.workspace_id} relative_path="" depth={1} entries_by_key={entries_by_key} expanded_keys={expanded_keys} loading_keys={loading_keys} toggle_directory={toggle_directory} select_file={props.select_file} /> : null}</section>;
    })}
    {!props.loading && props.workspaces.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbFolderPlus className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">{translate("workspace.create")}</div><Button className="mt-3" variant="primary" onClick={props.open_create_workspace}>{translate("workspace.create")}</Button></div> : null}
  </SidebarContent>;
}

/** 渲染一个已展开目录的直接子节点。 */
function DirectoryChildren({ workspace_id, relative_path, depth, entries_by_key, expanded_keys, loading_keys, toggle_directory, select_file }: { /** Workspace 标识。 */ workspace_id: string; /** 当前目录相对路径。 */ relative_path: string; /** 当前缩进深度。 */ depth: number; /** 已加载目录缓存。 */ entries_by_key: Record<string, DesktopWorkspaceEntry[]>; /** 展开节点集合。 */ expanded_keys: Set<string>; /** 正在加载节点集合。 */ loading_keys: Set<string>; /** 切换目录。 */ toggle_directory(workspace_id: string, relative_path: string): Promise<void>; /** 打开文件预览。 */ select_file(workspace_id: string, relative_path: string): void }) {
  const translate = use_translation("resources");
  const key = directory_key(workspace_id, relative_path);
  if (loading_keys.has(key)) return <div className="flex min-h-8 items-center gap-1.5 text-[0.6875rem] text-muted-foreground" style={{ paddingLeft: depth * 12 }}><TbLoader2 className="size-3 animate-spin" />{translate("workspace.reading")}</div>;
  const entries = entries_by_key[key] ?? [];
  return <div className="flex flex-col gap-0.5">{entries.map((entry) => {
    const entry_key = directory_key(workspace_id, entry.relative_path);
    const expanded = expanded_keys.has(entry_key);
    if (entry.kind === "directory") return <div key={entry.relative_path} style={{ paddingLeft: depth * 12 }}><div className="flex min-h-8 items-center gap-1 rounded-lg px-1 py-0.5 text-left text-xs hover:bg-foreground/[0.07]"><button type="button" aria-label={translate(expanded ? "workspace.collapse_directory" : "workspace.expand_directory")} title={translate(expanded ? "workspace.collapse_directory" : "workspace.expand_directory")} className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => void toggle_directory(workspace_id, entry.relative_path)}><TbChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} /></button><button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left" onClick={() => void toggle_directory(workspace_id, entry.relative_path)}><TbFolder className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{entry.name}</span></button></div>{expanded ? <DirectoryChildren workspace_id={workspace_id} relative_path={entry.relative_path} depth={depth + 1} entries_by_key={entries_by_key} expanded_keys={expanded_keys} loading_keys={loading_keys} toggle_directory={toggle_directory} select_file={select_file} /> : null}</div>;
    return <div key={entry.relative_path} style={{ paddingLeft: depth * 12 }}><button type="button" className="flex min-h-8 w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-xs hover:bg-foreground/[0.07]" onClick={() => select_file(workspace_id, entry.relative_path)}><TbFile className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{entry.name}</span></button></div>;
  })}{entries.length === 0 ? <div className="min-h-8 p-0.5 text-[0.6875rem] leading-7 text-muted-foreground/60" style={{ marginLeft: depth * 12 }}>{translate("workspace.empty_directory")}</div> : null}</div>;
}

/** 构造不同 Workspace 间不会冲突的目录缓存键。 */
function directory_key(workspace_id: string, relative_path: string): string { return `${workspace_id}:${relative_path}`; }

/** 返回移除指定键的新 Set。 */
function without_key(current: Set<string>, key: string): Set<string> { const next = new Set(current); next.delete(key); return next; }
