/** 独立登记 Workspace 的正式 Dialog。 */

import { useRef, useState, type FormEvent } from "react";
import { TbFolder, TbFolderOpen } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CreateWorkspaceFormValue } from "@/types/DesktopView";

/** 创建 Workspace 对话框属性。 */
interface CreateWorkspaceDialogProps {
  /** 关闭对话框。 */
  close_dialog(): void;
  /** 提交 Workspace。 */
  create_workspace(value: CreateWorkspaceFormValue): Promise<void>;
}

/** 选择本地目录并独立登记 Workspace。 */
export function CreateWorkspaceDialog({ close_dialog, create_workspace }: CreateWorkspaceDialogProps) {
  const [workspace_path, set_workspace_path] = useState("");
  const [name, set_name] = useState("");
  const [submitting, set_submitting] = useState(false);
  const [form_error, set_form_error] = useState("");
  const name_edited = useRef(false);

  const choose_directory = async () => {
    const next_path = await window.downcity.dialog.open_directory();
    if (!next_path) return;
    set_workspace_path(next_path);
    if (!name_edited.current) set_name(read_directory_name(next_path));
  };

  const submit_form = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace_path.trim()) {
      set_form_error("请选择 Workspace 目录");
      return;
    }
    set_submitting(true);
    set_form_error("");
    try {
      await create_workspace({ workspace_path: workspace_path.trim(), name: name.trim() });
      close_dialog();
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !submitting) close_dialog(); }}><DialogContent>
    <form onSubmit={(event) => void submit_form(event)}>
      <DialogHeader className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><TbFolder className="size-4.5" /></div><div><DialogTitle>添加 Workspace</DialogTitle><DialogDescription>Workspace 是对话的一级上下文；添加后再为它创建 Agent。</DialogDescription></div></DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <Field label="目录"><div className="flex gap-1"><input value={workspace_path} readOnly placeholder="选择一个本地目录" className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" /><Button type="button" size="icon" className="size-8" title="选择目录" onClick={() => void choose_directory()}><TbFolderOpen /></Button></div></Field>
        <Field label="名称"><input value={name} placeholder="默认使用目录名称" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" onChange={(event) => { name_edited.current = true; set_name(event.target.value); }} /></Field>
        {form_error ? <div className="text-[0.6875rem] text-destructive">{form_error}</div> : null}
      </DialogBody>
      <DialogFooter><Button type="button" disabled={submitting} onClick={close_dialog}>取消</Button><Button type="submit" variant="primary" disabled={submitting || !workspace_path}>{submitting ? "添加中…" : "添加 Workspace"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

/** Workspace 表单字段。 */
function Field({ label, children }: { /** 字段标签。 */ label: string; /** 字段控件。 */ children: React.ReactNode }) { return <label className="flex flex-col gap-1.5"><span className="text-[0.6875rem] font-medium text-foreground/75">{label}</span>{children}</label>; }

/** 从路径读取目录名称。 */
function read_directory_name(workspace_path: string): string { return workspace_path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Workspace"; }
