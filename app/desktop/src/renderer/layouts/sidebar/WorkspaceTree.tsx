/**
 * Sidebar 中以 Workspace 为根节点的本地目录树。
 *
 * ## 树行就是 `default` 行，只是行首多了箭头与图标
 *
 * ```text
 * Workspace   [▶ 24]─8─名称                根：有箭头、无图标
 *   └ 📁 src  [▶ 24]─8─[📁 16]─4─名称      目录：箭头 + 图标
 *   └ 📄 a.ts [   24]─8─[📄 16]─4─名称      文件：箭头位留同宽空位
 * ```
 *
 * 没有第四种行壳：行高、内边距、圆角、文字档位与**会话行完全相同**（`default` 变体），
 * 箭头是一个 `size-6` 的小按钮（与重构前同一样式），图标是名字前的 16px 图标。
 * 调用点只填数据（层数、图标、是否展开），结构与几何由 `SidebarItem` 决定。
 *
 * ## 占位只有一个：箭头位
 *
 * 文件行必须占**箭头位**——它和目录在同一层，两者的图标要同列。
 * 而**图标位一个都不要占**：这一列里每个节点都有图标（除了根），
 * 根本没有“空图标位”的场合。曾经给根节点留过图标空位，结果箭头与名字之间空出 20px；
 * Skill / Task 的树也一样（它们整列都没有图标，却被适配层默认占了位）。
 *
 * ## 缩进只作用于子节点
 *
 * 每层 12（`depth * 12`，与重构前一致），根节点不缩进。缩进是树表达层级的**唯一**手段：
 * 行高不随层数变，字号也不变。
 *
 * ## 副文本对齐到文字线
 *
 * 「正在读取」「空目录」不是行，但要对齐到同层行的**文字**（越过箭头与图标两列）——
 * 对齐到行盒左边看起来会像「这句话缩进得不够」，而它恰恰是那个目录的说明。
 */

import { useState } from "react";
import { TbFile, TbFolder, TbFolderPlus, TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_translation } from "@/locales/i18n";
import type { DesktopWorkspaceEntry, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { SidebarContent } from "./SidebarPanel";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarItem, SidebarSubText } from "./SidebarItem";
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
  const translate_common = use_translation();
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

  // 加载中就只显示「正在加载」：先把「还没有 Workspace」摆出来再换成列表，
  // 是把「还没读到」说成了「没有」——两句话的含义完全相反。
  if (props.loading && props.workspaces.length === 0) {
    return <SidebarContent>
      <SidebarEmptyState icon={<TbLoader2 className="animate-spin" />} title={translate_common("state.loading")} />
    </SidebarContent>;
  }

  return <SidebarContent class_name="space-y-1">
    {props.workspaces.map((workspace) => {
      const key = directory_key(workspace.workspace_id, "");
      const expanded = expanded_keys.has(key);
      const toggle = () => void toggle_directory(workspace.workspace_id, "");
      return <section key={workspace.workspace_id} className="space-y-0.5">
        <SidebarItem
          variant="default"
          active={props.selected_workspace_id === workspace.workspace_id}
          title={workspace.name}
          titleClassName="font-medium"
          // 根节点没有图标：它是这一列的标题性节点，图标留给它下面的文件系统条目。
          // 也不占图标位——整行没有图标时，空位会在箭头与名字之间留出一段空白。
          tree={{
            disclosure: { expanded, label: translate(expanded ? "workspace.collapse" : "workspace.expand"), onToggle: toggle },
          }}
          menu={<WorkspaceRowMenu workspace={workspace} on_remove={props.remove_workspace} />}
          // 双击标题才折叠/展开：挂在整行上的话，双击箭头会先切换一次、
          // 再冒泡上来切回原状，看起来像“双击没反应”。
          onDoubleClick={toggle}
          onSelect={() => props.select_workspace(workspace.workspace_id)}
        />
        {expanded ? <DirectoryChildren workspace_id={workspace.workspace_id} relative_path="" depth={1} entries_by_key={entries_by_key} expanded_keys={expanded_keys} loading_keys={loading_keys} toggle_directory={toggle_directory} select_file={props.select_file} /> : null}
      </section>;
    })}
    {!props.loading && props.workspaces.length === 0 ? <SidebarEmptyState
      icon={<TbFolderPlus />}
      title={translate("workspace.empty")}
      action={<Button variant="primary" onClick={props.open_create_workspace}>{translate("workspace.create")}</Button>}
    /> : null}
  </SidebarContent>;
}

/** 渲染一个已展开目录的直接子节点。 */
function DirectoryChildren({ workspace_id, relative_path, depth, entries_by_key, expanded_keys, loading_keys, toggle_directory, select_file }: { /** Workspace 标识。 */ workspace_id: string; /** 当前目录相对路径。 */ relative_path: string; /** 当前缩进深度。 */ depth: number; /** 已加载目录缓存。 */ entries_by_key: Record<string, DesktopWorkspaceEntry[]>; /** 展开节点集合。 */ expanded_keys: Set<string>; /** 正在加载节点集合。 */ loading_keys: Set<string>; /** 切换目录。 */ toggle_directory(workspace_id: string, relative_path: string): Promise<void>; /** 打开文件预览。 */ select_file(workspace_id: string, relative_path: string): void }) {
  const translate = use_translation("resources");
  const key = directory_key(workspace_id, relative_path);
  if (loading_keys.has(key)) return <SidebarSubText indent={depth}><TbLoader2 className="size-3 animate-spin" />{translate("workspace.reading")}</SidebarSubText>;
  const entries = entries_by_key[key] ?? [];
  return <div className="space-y-0.5">{entries.map((entry) => {
    const entry_key = directory_key(workspace_id, entry.relative_path);
    const expanded = expanded_keys.has(entry_key);
    const is_directory = entry.kind === "directory";
    const toggle = () => void toggle_directory(workspace_id, entry.relative_path);
    return <div key={entry.relative_path} className="space-y-0.5">
      <SidebarItem
        variant="default"
        title={entry.name}
        tree={{
          indent: depth,
          icon: is_directory
            ? <TbFolder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            : <TbFile className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
          // 文件行不给箭头 → 箭头位自动留一个同宽空位，图标与同级文件夹同列。
          disclosure: is_directory
            ? { expanded, label: translate(expanded ? "workspace.collapse_directory" : "workspace.expand_directory"), onToggle: toggle }
            : undefined,
        }}
        onSelect={is_directory ? toggle : () => select_file(workspace_id, entry.relative_path)}
      />
      {is_directory && expanded ? <DirectoryChildren workspace_id={workspace_id} relative_path={entry.relative_path} depth={depth + 1} entries_by_key={entries_by_key} expanded_keys={expanded_keys} loading_keys={loading_keys} toggle_directory={toggle_directory} select_file={select_file} /> : null}
    </div>;
  })}{entries.length === 0 ? <SidebarSubText indent={depth}>{translate("workspace.empty_directory")}</SidebarSubText> : null}</div>;
}

/** 构造不同 Workspace 间不会冲突的目录缓存键。 */
function directory_key(workspace_id: string, relative_path: string): string { return `${workspace_id}:${relative_path}`; }

/** 返回移除指定键的新 Set。 */
function without_key(current: Set<string>, key: string): Set<string> { const next = new Set(current); next.delete(key); return next; }
