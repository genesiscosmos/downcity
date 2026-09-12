/** Workspace 身份、说明与本地资源位置的独立信息页。 */

import { useState } from "react";
import { TbCopy, TbDots, TbExternalLink, TbFolder, TbPencil } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { MainViewBody, MainViewHeader } from "@/layouts/MainViewLayout";
import { Markdown } from "@/components/markdown/Markdown";
import { use_baybar_open } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";
import type { DesktopActions } from "@/types/DesktopView";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Workspace 主视图属性。 */
interface WorkspaceViewProps {
  /** 当前打开的 Workspace。 */
  workspace: DesktopWorkspaceSummary;
}
/** Workspace 配置侧栏支持的分区。 */
export type WorkspaceEditorField = "identity" | "readme";

/** 一级域「Workspace」的稳定标识。 */
export const WORKSPACE_DOMAIN_ID = "workspace";

/** 展示 Workspace 自身信息，不投影 Agent 或 Session。 */
export function WorkspaceView({ workspace }: WorkspaceViewProps) {
  const translate_common = use_translation("common");
  const translate_resources = use_translation("resources");
  const [copied, set_copied] = useState(false);
  // 右侧编辑面板由 MainView 提供；这里只需按「域 + 分区」打开。
  const open_baybar = use_baybar_open();
  const copy_path = async () => {
    await navigator.clipboard.writeText(workspace.workspace_path);
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  return <>
    <MainViewHeader title={translate_resources("workspace.title")} />
    <MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><main className="mx-auto w-full max-w-4xl px-8 pb-12 pt-10">
      <header className="min-w-0 px-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><TbFolder className="size-4" /><span>{translate_resources("workspace.title")}</span></div>
        <div className="mt-3 flex min-w-0 items-center gap-2"><h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight text-foreground">{workspace.name}</h1><div className="ml-auto flex shrink-0 items-center gap-1.5"><Button size="icon" className="size-6" title={translate_resources("workspace.edit")} aria-label={translate_resources("workspace.edit")} onClick={() => open_baybar(WORKSPACE_DOMAIN_ID, "identity")}><TbPencil /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="size-6" title={translate_common("actions.more")} aria-label={translate_common("actions.more")}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={4}><DropdownMenuItem onClick={() => void copy_path()}><TbCopy /><span>{translate_resources(copied ? "workspace.copied" : "workspace.copy_path")}</span></DropdownMenuItem><DropdownMenuItem onClick={() => void window.downcity.system.open_local_file(workspace.workspace_path)}><TbExternalLink /><span>{translate_resources("workspace.open_finder")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
        <div className="mt-2 min-w-0"><p className="truncate font-mono text-[11px] text-muted-foreground/70" title={workspace.workspace_path}>{workspace.workspace_path}</p></div>
      </header>
      <section className="mt-8" aria-labelledby="workspace-readme-title"><div className="mb-2 px-1"><h2 id="workspace-readme-title" className="text-xs text-muted-foreground">README.md</h2></div><article className="min-h-32 rounded-xl bg-surface-subtle px-6 py-5 text-[0.875rem] leading-[1.7] text-foreground/90">{workspace.readme ? <Markdown text={workspace.readme} mode="static" /> : <div className="flex min-h-24 items-center justify-center text-xs text-muted-foreground/65">{translate_resources("workspace.no_readme")}</div>}</article></section>
    </main></div></MainViewBody>
  </>;
}

/** Workspace 配置分区，作为域内的二级分区。 */
export const WORKSPACE_EDITOR_SECTIONS: readonly { id: WorkspaceEditorField; label_key: string | null; label?: string }[] = [
  { id: "identity", label_key: "workspace.identity" },
  { id: "readme", label_key: null, label: "README.md" },
];

/** Workspace 单个分区的编辑内容；容器与分区导航由 BayBar 负责。 */
export function WorkspaceEditorPanel({ workspace, controller, section }: {
  /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary;
  /** Renderer 稳定操作集合。 */ controller: DesktopActions;
  /** 当前编辑分区。 */ section: WorkspaceEditorField;
}) {
  const content = <>
    {section === "identity" ? <WorkspaceIdentityEditor workspace={workspace} update_workspace_name={controller.update_workspace_name} /> : null}
    {section === "readme" ? <WorkspaceReadmeEditor workspace={workspace} write_workspace_readme={controller.write_workspace_readme} /> : null}
  </>;
  return <div className="h-full min-h-0 w-full p-2">{content}</div>;
}



/** 编辑 Workspace 的显示名称。 */
function WorkspaceIdentityEditor({ workspace, update_workspace_name }: {
  /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary;
  /** 保存 Workspace 名称。 */ update_workspace_name(workspace_id: string, name: string): Promise<void>;
}) {
  const translate_common = use_translation("common");
  const translate_resources = use_translation("resources");
  const [value, set_value] = useState(workspace.name);
  const [submitting, set_submitting] = useState(false);
  const [form_error, set_form_error] = useState("");
  const dirty = value !== workspace.name;
  const submit = async () => {
    const normalized_value = value.trim();
    if (!normalized_value) return set_form_error(translate_resources("workspace.name_required"));
    set_submitting(true);
    set_form_error("");
    try {
      await update_workspace_name(workspace.workspace_id, normalized_value);
      set_value(normalized_value);
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };
  return <div className="flex h-full min-h-0 flex-col gap-2 p-3"><label className="flex flex-col gap-1.5"><span className="text-xs text-muted-foreground">{translate_resources("workspace.name")}</span><input autoFocus value={value} onChange={(event) => set_value(event.target.value)} aria-label={translate_resources("workspace.name_label")} className="h-9 rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:border-foreground/25 focus:ring-2 focus:ring-ring/20" /></label>{form_error ? <p className="text-xs text-destructive" role="status">{form_error}</p> : null}<div className="mt-auto flex justify-end pt-1"><Button variant="primary" disabled={submitting || !dirty || !value.trim()} onClick={() => void submit()}>{translate_common(submitting ? "actions.saving" : "actions.save")}</Button></div></div>;
}

/** 编辑 Workspace 根目录的 README.md。 */
function WorkspaceReadmeEditor({ workspace, write_workspace_readme }: {
  /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary;
  /** 写入 Workspace README.md。 */ write_workspace_readme(workspace_id: string, content: string): Promise<void>;
}) {
  const translate_common = use_translation("common");
  const translate_resources = use_translation("resources");
  const [value, set_value] = useState(workspace.readme);
  const [submitting, set_submitting] = useState(false);
  const [form_error, set_form_error] = useState("");
  const dirty = value !== workspace.readme;
  const submit = async () => {
    set_submitting(true);
    set_form_error("");
    try {
      await write_workspace_readme(workspace.workspace_id, value);
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };
  return <div className="flex h-full min-h-0 flex-col gap-2 p-3"><textarea autoFocus value={value} onChange={(event) => set_value(event.target.value)} aria-label={translate_resources("workspace.readme_label")} placeholder="README.md" className="min-h-0 flex-1 resize-none bg-transparent font-mono text-xs leading-6 text-foreground outline-none placeholder:text-muted-foreground/55" />{form_error ? <p className="text-xs text-destructive" role="status">{form_error}</p> : null}<div className="mt-auto flex justify-end pt-1"><Button variant="primary" disabled={submitting || !dirty} onClick={() => void submit()}>{translate_common(submitting ? "actions.saving" : "actions.save")}</Button></div></div>;
}

