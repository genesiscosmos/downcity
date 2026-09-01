/** Workspace 身份、说明与本地资源位置的独立信息页。 */

import { useState } from "react";
import { TbCheck, TbChevronRight, TbCopy, TbExternalLink, TbFileDescription, TbFolder, TbTag } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { SettingActionItem, SettingGroup, SettingItem, SettingSection, SettingsContainer, SettingsMainContent } from "@/components/settings/SettingComponents";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Workspace 主视图属性。 */
interface WorkspaceViewProps {
  /** 当前打开的 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** 在当前 MainView 的右侧边栏打开字段编辑器。 */
  open_editor(field: WorkspaceEditorField): void;
}

/** Workspace 右侧边栏支持编辑的字段。 */
export type WorkspaceEditorField = "name" | "description";

/** 展示 Workspace 自身信息，不投影 Agent 或 Session。 */
export function WorkspaceView({ workspace, open_editor }: WorkspaceViewProps) {
  const [copied, set_copied] = useState(false);
  const copy_path = async () => {
    await navigator.clipboard.writeText(workspace.workspace_path);
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  return <MainViewLayout>
    <MainViewHeader title="Workspace" />
    <MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"><SettingsMainContent><SettingsContainer>
      <header className="min-w-0 px-2 py-1"><h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{workspace.name}</h1><p className="mt-1 max-w-2xl whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{workspace.readme || "还没有 README.md。"}</p></header>
      <SettingSection title="Workspace" description="管理工作空间自身的信息"><SettingGroup><SettingActionItem icon={<TbTag />} label="名称" description="Workspace 的显示名称" trailing={<><span className="max-w-48 truncate">{workspace.name}</span><TbChevronRight /></>} on_select={() => open_editor("name")} /><SettingActionItem icon={<TbFileDescription />} label="Description" description="编辑 Workspace 根目录的 README.md" trailing={<><span className="max-w-48 truncate">{workspace.readme || "未设置"}</span><TbChevronRight /></>} on_select={() => open_editor("description")} /></SettingGroup></SettingSection>
      <SettingSection title="本地资源" description="Workspace 当前关联的本地目录"><SettingGroup><SettingItem leading={<TbFolder />} label="路径" description={workspace.workspace_path}><div className="flex items-center gap-1"><Button size="icon" title={copied ? "已复制" : "复制路径"} aria-label={copied ? "已复制路径" : "复制路径"} onClick={() => void copy_path()}>{copied ? <TbCheck /> : <TbCopy />}</Button><Button size="icon" title="在 Finder 中打开" aria-label="在 Finder 中打开" onClick={() => void window.downcity.system.open_local_file(workspace.workspace_path)}><TbExternalLink /></Button></div></SettingItem></SettingGroup></SettingSection>
      <SettingSection title="详情"><SettingGroup><SettingItem label="Workspace ID"><MetadataValue value={workspace.workspace_id} /></SettingItem><SettingItem label="创建时间"><MetadataValue value={format_time(workspace.created_at)} /></SettingItem><SettingItem label="更新时间"><MetadataValue value={format_time(workspace.updated_at)} /></SettingItem></SettingGroup></SettingSection>
    </SettingsContainer></SettingsMainContent></div></MainViewBody>
  </MainViewLayout>;
}

/** Settings 行尾的只读 Workspace 元数据。 */
function MetadataValue({ value }: { /** 要展示的元数据。 */ value: string }) { return <span className="max-w-80 truncate font-mono text-xs text-muted-foreground" title={value}>{value}</span>; }

/** 在右侧面板中编辑一个独立的 Workspace 字段。 */
export function WorkspaceIdentityEditor({ field, workspace, update_workspace_name, write_workspace_readme }: { /** 当前编辑字段。 */ field: WorkspaceEditorField; /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** 保存 Workspace 名称。 */ update_workspace_name(workspace_id: string, name: string): Promise<void>; /** 写入 Workspace README.md。 */ write_workspace_readme(workspace_id: string, content: string): Promise<void> }) {
  const initial_value = field === "name" ? workspace.name : workspace.readme;
  const [value, set_value] = useState(initial_value);
  const [submitting, set_submitting] = useState(false);
  const [form_error, set_form_error] = useState("");
  const dirty = value !== initial_value;
  const submit = async () => {
    const normalized_value = value.trim();
    if (field === "name" && !normalized_value) return set_form_error("名称不能为空");
    set_submitting(true);
    set_form_error("");
    try {
      if (field === "name") {
        await update_workspace_name(workspace.workspace_id, normalized_value);
        set_value(normalized_value);
      } else {
        await write_workspace_readme(workspace.workspace_id, value);
      }
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };
  return <div className="flex h-full min-h-0 flex-col gap-2 p-3">{field === "name" ? <input autoFocus value={value} onChange={(event) => set_value(event.target.value)} aria-label="Workspace 名称" className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:border-foreground/25 focus:ring-2 focus:ring-ring/20" /> : <textarea autoFocus value={value} onChange={(event) => set_value(event.target.value)} aria-label="Workspace README" placeholder="README.md" className="min-h-0 flex-1 resize-none bg-transparent font-mono text-xs leading-6 text-foreground outline-none placeholder:text-muted-foreground/55" />}{form_error ? <p className="text-xs text-destructive" role="status">{form_error}</p> : null}<div className="mt-auto flex justify-end pt-1"><Button variant="primary" disabled={submitting || !dirty || (field === "name" && !value.trim())} onClick={() => void submit()}>{submitting ? "保存中…" : "保存"}</Button></div></div>;
}

/** 将 ISO 时间格式化为当前系统区域时间。 */
function format_time(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
