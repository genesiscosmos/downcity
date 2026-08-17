/** 使用目录选择器和真实模型目录创建 Agent。 */

import { useState, type FormEvent } from "react";
import { TbGhost3 } from "react-icons/tb";
import { ModelSelector } from "@/components/model/ModelSelector";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CreateAgentFormValue } from "@/types/DesktopView";
import type { DesktopModelSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** 创建 Agent 对话框属性。 */
interface CreateAgentDialogProps {
  /** 关闭对话框。 */ close_dialog(): void;
  /** 提交创建。 */ create_agent(value: CreateAgentFormValue): Promise<void>;
  /** 当前 Federation 模型目录。 */ models: DesktopModelSummary[];
  /** 模型目录是否加载中。 */ models_loading: boolean;
  /** 默认文本模型。 */ default_model_id: string;
  /** 已打开的 Workspace；存在时固定使用其目录。 */ workspace?: DesktopWorkspaceSummary;
}

/** 正式的 Agent 创建流程。 */
export function CreateAgentDialog({ close_dialog, create_agent, models, models_loading, default_model_id, workspace }: CreateAgentDialogProps) {
  const text_models = models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)));
  const [agent_id, set_agent_id] = useState(() => workspace ? to_agent_id(workspace.workspace_path) : "");
  const [model_id, set_model_id] = useState(default_model_id || text_models[0]?.model_id || "");
  const [submitting, set_submitting] = useState(false);
  const [form_error, set_form_error] = useState("");
  const submit_form = async (event: FormEvent) => {
    event.preventDefault();
    if (!agent_id.trim() || !model_id.trim()) {
      set_form_error("请填写 Agent ID 并选择模型");
      return;
    }
    set_submitting(true);
    set_form_error("");
    try {
      await create_agent({ agent_id: agent_id.trim(), model_id: model_id.trim() });
      close_dialog();
    } catch (reason) {
      set_form_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !submitting) close_dialog(); }}><DialogContent>
    <form onSubmit={(event) => void submit_form(event)}>
      <DialogHeader className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><TbGhost3 className="size-4.5" /></div><div><DialogTitle>创建 Agent</DialogTitle><DialogDescription>Agent 可在多个 Workspace 中执行；Workspace 在开始对话时选择。</DialogDescription></div></DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <Field label="Agent ID"><input autoFocus value={agent_id} placeholder="research-agent" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" onChange={(event) => set_agent_id(event.target.value)} /></Field>
        <Field label="默认模型"><ModelSelector current_model_id={model_id} models={text_models} loading={models_loading} trigger_label="选择模型" class_name="h-8 w-full max-w-none justify-start rounded-lg border border-input px-2.5" on_select_model={set_model_id} /></Field>
        {form_error ? <div className="text-[0.6875rem] text-destructive">{form_error}</div> : null}
      </DialogBody>
      <DialogFooter><Button type="button" onClick={close_dialog} disabled={submitting}>取消</Button><Button type="submit" variant="primary" disabled={submitting || !agent_id.trim() || !model_id}>{submitting ? "创建中…" : "创建 Agent"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

/** 创建表单字段。 */
function Field({ label, children }: { /** 字段标签。 */ label: string; /** 字段控件。 */ children: React.ReactNode }) { return <label className="flex flex-col gap-1.5"><span className="text-[0.6875rem] font-medium text-foreground/75">{label}</span>{children}</label>; }

/** 从 Workspace 最后一段生成 Agent ID 建议值。 */
function to_agent_id(workspace_path: string): string {
  const name = workspace_path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "agent";
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}
