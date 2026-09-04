/** 孤儿 Session 的 Workspace 绑定 Dialog：让用户显式选择或新建 Workspace 后再进入。 */

import { useEffect, useState, type FormEvent } from "react";
import { TbFolder, TbFolderOpen, TbPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { CreateWorkspaceFormValue } from "@/types/DesktopView";

/** 孤儿 Session Workspace 绑定 Dialog 属性。 */
interface AttachSessionWorkspaceDialogProps {
  /** 当前待绑定 Session；为空时不渲染。 */
  request: { agent_id: string; session_id: string; workspace_id: string } | null;
  /** 当前已登记的全部 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 关闭 Dialog。 */
  close_dialog(): void;
  /** 绑定到已有 Workspace。 */
  rebind_session_workspace(agent_id: string, session_id: string, workspace_id: string): Promise<void>;
  /** 新建 Workspace 并立即绑定孤儿 Session，然后进入该 Session。 */
  create_workspace_for_session(value: CreateWorkspaceFormValue, agent_id: string, session_id: string): Promise<void>;
}

/** 弹出让用户选择 Workspace 绑定孤儿 Session 的 Dialog。 */
export function AttachSessionWorkspaceDialog({ request, workspaces, close_dialog, rebind_session_workspace, create_workspace_for_session }: AttachSessionWorkspaceDialogProps) {
  const [selected_workspace_id, set_selected_workspace_id] = useState("");
  const [submitting, set_submitting] = useState(false);
  const [form_error, set_form_error] = useState("");
  const [creating, set_creating] = useState(false);
  const [create_path, set_create_path] = useState("");
  const [create_name, set_create_name] = useState("");
  const [create_name_edited, set_create_name_edited] = useState(false);

  // 每次打开时默认选中第一个可用 Workspace，并重置表单状态。
  useEffect(() => {
    if (!request) return;
    set_selected_workspace_id(workspaces[0]?.workspace_id ?? "");
    set_form_error("");
    set_submitting(false);
    set_creating(false);
    set_create_path("");
    set_create_name("");
    set_create_name_edited(false);
  }, [request, workspaces]);

  if (!request) return null;

  const submit_rebind = async () => {
    if (!selected_workspace_id) {
      set_form_error("请选择一个 Workspace");
      return;
    }
    set_submitting(true);
    set_form_error("");
    try {
      await rebind_session_workspace(request.agent_id, request.session_id, selected_workspace_id);
      close_dialog();
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };

  const submit_create = async (event: FormEvent) => {
    event.preventDefault();
    set_submitting(true);
    set_form_error("");
    try {
      await create_workspace_for_session({ workspace_path: create_path, name: create_name }, request.agent_id, request.session_id);
      close_dialog();
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };

  const choose_directory = async () => {
    const next_path = await window.downcity.dialog.open_directory();
    if (!next_path) return;
    set_create_path(next_path);
    if (!create_name_edited) set_create_name(read_directory_name(next_path));
  };

  return <Dialog open={Boolean(request)} onOpenChange={(next_open) => { if (!next_open && !submitting) close_dialog(); }} onOpenChangeComplete={(next_open) => { if (!next_open) { set_creating(false); set_form_error(""); } }}><DialogContent>
    {creating ? (
      <form onSubmit={(event) => void submit_create(event)}>
        <DialogHeader className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><TbPlus className="size-4.5" /></div><div><DialogTitle>创建 Workspace</DialogTitle><DialogDescription>为孤儿 Session 新建一个本地目录作为执行环境。</DialogDescription></div></DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5"><span className="text-[0.6875rem] font-medium text-foreground/75">目录</span><div className="flex gap-1"><input value={create_path} readOnly placeholder="选择一个本地目录" className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" /><Button type="button" size="icon" className="size-8" title="选择目录" onClick={() => void choose_directory()}><TbFolderOpen /></Button></div></label>
          <label className="flex flex-col gap-1.5"><span className="text-[0.6875rem] font-medium text-foreground/75">名称</span><input value={create_name} placeholder="默认使用目录名称" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" onChange={(event) => { set_create_name_edited(true); set_create_name(event.target.value); }} /></label>
          {form_error ? <div className="text-[0.6875rem] text-destructive">{form_error}</div> : null}
        </DialogBody>
        <DialogFooter><Button type="button" disabled={submitting} onClick={() => { set_creating(false); set_form_error(""); }}>返回</Button><Button type="submit" variant="primary" disabled={submitting || !create_path}>{submitting ? "创建中…" : "创建并绑定"}</Button></DialogFooter>
      </form>
    ) : (
      <>
        <DialogHeader className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><TbFolder className="size-4.5" /></div><div><DialogTitle>选择 Workspace</DialogTitle><DialogDescription>这个对话原所属 Workspace 已不在列表中，请选择一个 Workspace 继续。</DialogDescription></div></DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {workspaces.length > 0 ? workspaces.map((workspace) => <button key={workspace.workspace_id} type="button" onClick={() => set_selected_workspace_id(workspace.workspace_id)} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${selected_workspace_id === workspace.workspace_id ? "border-primary bg-primary/[0.08]" : "border-input hover:bg-foreground/[0.05]"}`}><TbFolder className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{workspace.name}</span><span className="truncate text-[0.625rem] text-muted-foreground/60">{workspace.workspace_path}</span></button>) : <div className="px-2 py-5 text-center text-[10px] text-muted-foreground/55">暂无 Workspace，请新建一个</div>}
          {form_error ? <div className="text-[0.6875rem] text-destructive">{form_error}</div> : null}
        </DialogBody>
        <DialogFooter><Button type="button" disabled={submitting} onClick={close_dialog}>取消</Button><Button variant="primary" disabled={submitting || !selected_workspace_id} onClick={() => void submit_rebind()}>{submitting ? "绑定中…" : "绑定并打开"}</Button><Button type="button" disabled={submitting} onClick={() => { set_creating(true); set_form_error(""); }}><TbPlus /><span>新建</span></Button></DialogFooter>
      </>
    )}
  </DialogContent></Dialog>;
}

/** 从路径读取目录名称。 */
function read_directory_name(workspace_path: string): string { return workspace_path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Workspace"; }
