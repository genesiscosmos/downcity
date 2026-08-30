/** Workspace 文本文件只读预览主视图。 */

import { useEffect, useState } from "react";
import { TbFile, TbLoader2 } from "react-icons/tb";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopWorkspaceSummary, DesktopWorkspaceTextFile } from "@common/types/DesktopApi";

/** Workspace 文件预览属性。 */
interface WorkspaceFileViewProps {
  /** 文件所属 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** Workspace 内的相对文件路径。 */
  relative_path: string;
}

/** 加载并展示 UTF-8 文本文件；内容始终不可编辑。 */
export function WorkspaceFileView({ workspace, relative_path }: WorkspaceFileViewProps) {
  const [file, set_file] = useState<DesktopWorkspaceTextFile>();
  const [error, set_error] = useState("");
  useEffect(() => {
    let active = true;
    set_file(undefined);
    set_error("");
    void window.downcity.workspace.read_text_file(workspace.workspace_id, relative_path)
      .then((value) => { if (active) set_file(value); })
      .catch((reason: unknown) => { if (active) set_error(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [workspace.workspace_id, relative_path]);

  return <MainViewLayout><MainViewHeader title={<span className="flex min-w-0 items-center gap-2"><TbFile className="shrink-0 text-muted-foreground" /><span className="truncate">{relative_path}</span></span>} right_actions={<span className="text-xs text-muted-foreground">{workspace.name}</span>} /><MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">
    {!file && !error ? <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><TbLoader2 className="animate-spin" />正在读取文件</div> : null}
    {error ? <div className="mx-auto mt-20 max-w-lg rounded-lg bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">{error}</div> : null}
    {file ? <pre className="min-h-full min-w-max p-5 font-mono text-xs leading-5 text-foreground selection:bg-primary/20"><code>{file.content}</code></pre> : null}
  </div></MainViewBody></MainViewLayout>;
}
