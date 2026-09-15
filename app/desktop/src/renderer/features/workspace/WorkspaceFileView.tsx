/** Workspace 文本文件只读预览主视图。 */

import { useEffect, useState } from "react";
import { TbFile } from "react-icons/tb";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { use_translation } from "@/locales/i18n";
import { is_markdown_document } from "@/lib/workspace/workspace_file_preview";
import { WorkspaceFileMarkdownBody, WorkspaceFilePlaceholder, WorkspaceFileSourceBody, WorkspaceFileViewModeControl, use_workspace_text_file, type WorkspaceFileViewMode } from "./components/WorkspaceFilePreview";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Workspace 文件预览属性。 */
interface WorkspaceFileViewProps {
  /** 文件所属 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** Workspace 内的相对文件路径。 */
  relative_path: string;
  /** 链接携带的 1 基行号；提供时在源码视图中滚动并高亮该行。 */
  line?: number;
}

/** 加载并展示 UTF-8 文本文件；内容始终不可编辑。 */
export function WorkspaceFileView({ workspace, relative_path, line }: WorkspaceFileViewProps) {
  const translate_resources = use_translation("resources");
  const [markdown_view_mode, set_markdown_view_mode] = useState<WorkspaceFileViewMode>("preview");
  const { file, error } = use_workspace_text_file(workspace.workspace_id, relative_path);
  const markdown_document = is_markdown_document(relative_path);
  const show_source = !markdown_document || markdown_view_mode === "source";

  // 带行号的链接指向源码位置：Markdown 文档直接进入源码视图，否则定位后的行会被预览模式隐藏。
  useEffect(() => set_markdown_view_mode(line ? "source" : "preview"), [relative_path, line]);

  return <MainViewLayout><MainViewHeader title={<span className="flex min-w-0 items-center gap-2"><TbFile className="shrink-0 text-muted-foreground" /><span className="truncate">{relative_path}</span></span>} right_actions={<div className="flex items-center gap-3">{markdown_document ? <WorkspaceFileViewModeControl value={markdown_view_mode} on_value_change={set_markdown_view_mode} /> : null}<span className="text-xs text-muted-foreground">{workspace.name}</span></div>} /><MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">
    {!file ? <WorkspaceFilePlaceholder error={error} /> : show_source ? <WorkspaceFileSourceBody file={file} relative_path={relative_path} line={line} class_name="p-5" /> : <WorkspaceFileMarkdownBody content={file.content} />}
  </div></MainViewBody></MainViewLayout>;
}
