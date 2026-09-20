/** Workspace 文本文件只读预览主视图。 */

import { TbFile } from "react-icons/tb";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { is_markdown_document } from "@/lib/workspace/workspace_file_preview";
import { WorkspaceFileActionsMenu } from "./components/WorkspaceFileActionsMenu";
import { WorkspaceFileMarkdownBody, WorkspaceFilePlaceholder, WorkspaceFileSourceBody, use_workspace_file_view_mode, use_workspace_text_file } from "./components/WorkspaceFilePreview";
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

/**
 * 加载并展示 UTF-8 文本文件；内容始终不可编辑。
 *
 * 顶栏只有三样东西：文件图标、路径、操作菜单。没有「预览 / 源码」分段控件——
 * 源码模式是操作菜单里的一项开关（理由见 `WorkspaceFileActionsMenu` 的模块注释）。
 * 菜单放在路径右侧而不是顶栏最右端：它与路径描述的是同一个对象，紧邻才读得出从属关系。
 */
export function WorkspaceFileView({ workspace, relative_path, line }: WorkspaceFileViewProps) {
  const [view_mode, set_view_mode] = use_workspace_file_view_mode(relative_path, line);
  const { file, error } = use_workspace_text_file(workspace.workspace_id, relative_path);
  const markdown_document = is_markdown_document(relative_path);
  const show_source = !markdown_document || view_mode === "source";

  return <MainViewLayout>
    <MainViewHeader
      title={<span className="flex min-w-0 items-center gap-2">
        <TbFile className="shrink-0 text-muted-foreground" />
        {/*
          路径可被压缩（`min-w-0`）并在过长时截断，而菜单按钮是 `flex-none`（Button 自带），
          所以窄窗口下先牺牲路径、按钮始终完整可点。
          这里刻意不写 `flex-1`：外层 title 是内容宽度（它后面才是拖动区），
          在内容宽度的容器里用 `flex-1`（basis 0）会把路径压成零宽。
        */}
        <span className="min-w-0 truncate">{relative_path}</span>
        {/* 文件未读到时不给操作菜单：「复制全文」此时只能复制空字符串。 */}
        {file ? <WorkspaceFileActionsMenu relative_path={relative_path} workspace_path={workspace.workspace_path} line={line} markdown_document={markdown_document} view_mode={view_mode} on_view_mode_change={set_view_mode} content={file.content} /> : null}
      </span>}
      right_actions={<span className="text-xs text-muted-foreground">{workspace.name}</span>}
    />
    <MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">
      {!file ? <WorkspaceFilePlaceholder error={error} /> : show_source ? <WorkspaceFileSourceBody file={file} relative_path={relative_path} line={line} class_name="p-5" /> : <WorkspaceFileMarkdownBody content={file.content} class_name="px-5 py-5 md:px-6 md:py-6" />}
    </div></MainViewBody>
  </MainViewLayout>;
}
