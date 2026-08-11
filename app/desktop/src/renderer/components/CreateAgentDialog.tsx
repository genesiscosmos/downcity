/** 使用 Duobox Dialog 视觉结构创建共享 Registry Agent。 */

import { useState, type FormEvent } from "react";
import { TbCpu } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import type { CreateAgentFormValue } from "@/types/DesktopView";

/** 创建 Agent 对话框属性。 */
interface CreateAgentDialogProps {
  /** 关闭对话框。 */
  close_dialog(): void;
  /** 提交创建表单。 */
  create_agent(value: CreateAgentFormValue): Promise<void>;
}

/** Duobox 风格创建 Agent 表单。 */
export function CreateAgentDialog({ close_dialog, create_agent }: CreateAgentDialogProps) {
  const [agent_id, set_agent_id] = useState("");
  const [workspace_path, set_workspace_path] = useState("");
  const [model_id, set_model_id] = useState("");
  const [submitting, set_submitting] = useState(false);
  const [form_error, set_form_error] = useState("");

  const submit_form = async (event: FormEvent) => {
    event.preventDefault();
    if (!agent_id.trim() || !workspace_path.trim() || !model_id.trim()) {
      set_form_error("请填写全部字段");
      return;
    }
    set_submitting(true);
    set_form_error("");
    try {
      await create_agent({ agent_id: agent_id.trim(), workspace_path: workspace_path.trim(), model_id: model_id.trim() });
      close_dialog();
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/15 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) close_dialog(); }}>
    <form className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl" onSubmit={(event) => void submit_form(event)}>
      <div className="flex items-start gap-3 px-5 pb-3 pt-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><TbCpu className="size-4.5" /></div>
        <div><h2 className="text-sm font-semibold text-foreground">创建 Agent</h2><p className="mt-1 text-[0.6875rem] leading-4 text-muted-foreground">Agent 将写入与 Downcity CLI 共用的注册表。</p></div>
      </div>
      <div className="flex flex-col gap-3 px-5 py-3">
        <Field label="Agent ID" value={agent_id} placeholder="research-agent" auto_focus on_change={set_agent_id} />
        <Field label="Workspace 绝对路径" value={workspace_path} placeholder="/Users/name/project" on_change={set_workspace_path} />
        <Field label="Model ID" value={model_id} placeholder="provider/model" on_change={set_model_id} />
        {form_error ? <div className="text-[0.6875rem] text-destructive">{form_error}</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border/60 bg-muted/35 px-5 py-3"><Button type="button" onClick={close_dialog}>取消</Button><Button type="submit" variant="primary" disabled={submitting}>{submitting ? "创建中…" : "创建 Agent"}</Button></div>
    </form>
  </div>;
}

/** 创建表单的标准输入字段。 */
function Field({ label, value, placeholder, auto_focus = false, on_change }: { /** 字段标签。 */ label: string; /** 当前字段值。 */ value: string; /** 空值提示。 */ placeholder: string; /** 是否初始聚焦。 */ auto_focus?: boolean; /** 字段变化回调。 */ on_change(value: string): void }) {
  return <label className="flex flex-col gap-1.5"><span className="text-[0.6875rem] font-medium text-foreground/75">{label}</span><input autoFocus={auto_focus} value={value} placeholder={placeholder} className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/45 focus:border-ring" onChange={(event) => on_change(event.target.value)} /></label>;
}
