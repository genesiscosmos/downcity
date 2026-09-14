/** Workspace 文本文件只读预览主视图。 */

import { useEffect, useState } from "react";
import { TbFile, TbLoader2 } from "react-icons/tb";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { Markdown } from "@/components/markdown/Markdown";
import { use_translation } from "@/locales/i18n";
import { is_markdown_document } from "@/lib/workspace/workspace_file_preview";
import type { DesktopWorkspaceSummary, DesktopWorkspaceTextFile } from "@common/types/DesktopApi";

/** Workspace 文件预览属性。 */
interface WorkspaceFileViewProps {
  /** 文件所属 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** Workspace 内的相对文件路径。 */
  relative_path: string;
}

/** Markdown 文档支持的阅读模式。 */
type MarkdownViewMode = "preview" | "source";

/** 加载并展示 UTF-8 文本文件；内容始终不可编辑。 */
export function WorkspaceFileView({ workspace, relative_path }: WorkspaceFileViewProps) {
  const translate_resources = use_translation("resources");
  const [file, set_file] = useState<DesktopWorkspaceTextFile>();
  const [error, set_error] = useState("");
  const [markdown_view_mode, set_markdown_view_mode] = useState<MarkdownViewMode>("preview");
  const markdown_document = is_markdown_document(relative_path);
  const markdown_view_options: readonly SegmentedControlOption<MarkdownViewMode>[] = [
    { value: "preview", label: translate_resources("workspace.preview") },
    { value: "source", label: translate_resources("workspace.source") },
  ];
  useEffect(() => {
    let active = true;
    set_file(undefined);
    set_error("");
    void window.downcity.workspace.read_text_file(workspace.workspace_id, relative_path)
      .then((value) => { if (active) set_file(value); })
      .catch((reason: unknown) => { if (active) set_error(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [workspace.workspace_id, relative_path]);

  useEffect(() => set_markdown_view_mode("preview"), [relative_path]);

  return <MainViewLayout><MainViewHeader title={<span className="flex min-w-0 items-center gap-2"><TbFile className="shrink-0 text-muted-foreground" /><span className="truncate">{relative_path}</span></span>} right_actions={<div className="flex items-center gap-3">{markdown_document ? <SegmentedControl<MarkdownViewMode> value={markdown_view_mode} options={markdown_view_options} on_value_change={set_markdown_view_mode} aria_label={translate_resources("workspace.document_view_mode")} class_name="h-7" /> : null}<span className="text-xs text-muted-foreground">{workspace.name}</span></div>} /><MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">
    {!file && !error ? <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><TbLoader2 className="animate-spin" />{translate_resources("workspace.reading_file")}</div> : null}
    {error ? <div className="mx-auto mt-20 max-w-lg rounded-lg bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">{error}</div> : null}
    {file && markdown_document && markdown_view_mode === "preview" ? <article className="min-h-full w-full px-5 py-5 text-[0.875rem] leading-[1.7] text-foreground md:px-6 md:py-6"><Markdown text={file.content} mode="static" /></article> : null}
    {file && (!markdown_document || markdown_view_mode === "source") ? <pre className="min-h-full w-full whitespace-pre-wrap break-words p-5 font-mono text-xs leading-5 text-foreground selection:bg-primary/20"><code>{file.content}</code></pre> : null}
  </div></MainViewBody></MainViewLayout>;
}
