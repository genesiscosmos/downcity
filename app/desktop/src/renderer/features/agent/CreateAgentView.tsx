/** Agent 的 AI 辅助与手动创建 MainView。 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TbArrowLeft, TbGhost3, TbSparkles } from "react-icons/tb";
import { ModelSelector } from "@/components/model/ModelSelector";
import { Button } from "@/components/ui/button";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import type { CreateAgentFormValue } from "@/types/DesktopView";
import type { DesktopModelSummary } from "@common/types/DesktopApi";
import { use_translation } from "@/locales/i18n";

/** Agent 创建页面属性。 */
interface CreateAgentViewProps {
  /** 当前模型目录。 */ models: DesktopModelSummary[];
  /** 模型目录是否正在加载。 */ models_loading: boolean;
  /** 系统默认文本模型。 */ default_model_id: string;
  /** 提交最终 Agent 配置。 */ create_agent(value: CreateAgentFormValue): Promise<void>;
}

/** 用户在同一页面中选择 AI 起草或手动配置 Agent。 */
export function CreateAgentView({ models, models_loading, default_model_id, create_agent }: CreateAgentViewProps) {
  const translate = use_translation("resources");
  const common_translate = use_translation();
  const text_models = useMemo(() => models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality))), [models]);
  const initial_model_id = text_models.some((model) => model.model_id === default_model_id) ? default_model_id : text_models[0]?.model_id || "";
  const [editing, set_editing] = useState(false);
  const [prompt, set_prompt] = useState("");
  const [name, set_name] = useState("");
  const [description, set_description] = useState("");
  const [instruction, set_instruction] = useState("");
  const [generation_model_id, set_generation_model_id] = useState(initial_model_id);
  const [model_id, set_model_id] = useState(initial_model_id);
  const [generating, set_generating] = useState(false);
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState("");

  useEffect(() => {
    if (!generation_model_id && initial_model_id) set_generation_model_id(initial_model_id);
    if (!model_id && initial_model_id) set_model_id(initial_model_id);
  }, [generation_model_id, initial_model_id, model_id]);

  const generate_draft = async () => {
    if (!prompt.trim() || !generation_model_id) return;
    set_generating(true);
    set_error("");
    try {
      const draft = await window.downcity.agent.generate_draft({
        prompt: prompt.trim(),
        model_id: generation_model_id,
      });
      set_name(draft.name);
      set_description(draft.description);
      set_instruction(draft.instruction);
      set_model_id(generation_model_id);
      set_editing(true);
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_generating(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !model_id) return;
    set_submitting(true);
    set_error("");
    try {
      await create_agent({ name: name.trim(), description: description.trim(), instruction: instruction.trim(), model_id });
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
      set_submitting(false);
    }
  };

  return <MainViewLayout><MainViewHeader title={translate("agent.create")} /><MainViewBody><main className="min-h-0 flex-1 overflow-y-auto bg-background">
    {!editing ? <section className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-10 py-16"><div className="mb-8"><div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-surface-brand text-primary"><TbGhost3 className="size-6" /></div><h1 className="text-2xl font-semibold tracking-tight">{translate("agent.question")}</h1><p className="mt-2 text-base text-muted-foreground">{translate("agent.question_description")}</p></div><textarea autoFocus value={prompt} rows={6} placeholder={translate("agent.prompt_placeholder")} className="w-full resize-none rounded-2xl bg-control-surface px-5 py-4 text-lg leading-7 outline-none focus:bg-control-hover" onChange={(event) => set_prompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void generate_draft(); }} /><div className="mt-4 flex items-center gap-3"><span className="shrink-0 text-xs text-muted-foreground">{translate("creation.generation_model")}</span><ModelSelector current_model_id={generation_model_id} models={text_models} loading={models_loading} trigger_label={translate("creation.select_generation_model")} class_name="h-9 min-w-52 justify-start rounded-xl bg-control-surface px-3" on_select_model={set_generation_model_id} /></div>{error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}<div className="mt-5 flex items-center gap-3"><Button variant="primary" disabled={!prompt.trim() || !generation_model_id || generating} onClick={() => void generate_draft()}><TbSparkles />{generating ? translate("creation.generating") : translate("creation.generate")}</Button><Button disabled={generating} onClick={() => { set_model_id(initial_model_id); set_editing(true); }}>{translate("creation.manual")}</Button><span className="ml-auto text-xs text-muted-foreground">{translate("creation.shortcut")}</span></div></section> : <form onSubmit={(event) => void submit(event)} className="mx-auto w-full max-w-3xl px-10 py-12"><button type="button" className="mb-8 flex items-center gap-2 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => set_editing(false)}><TbArrowLeft />{translate("creation.back_to_prompt")}</button><div className="space-y-8"><Field label={translate("agent.name")}><input autoFocus value={name} placeholder={translate("agent.name_placeholder")} className="h-11 w-full rounded-xl bg-control-surface px-4 text-base outline-none focus:bg-control-hover" onChange={(event) => set_name(event.target.value)} /></Field><Field label={translate("agent.description")}><input value={description} placeholder={translate("agent.description_placeholder")} className="h-11 w-full rounded-xl bg-control-surface px-4 text-base outline-none focus:bg-control-hover" onChange={(event) => set_description(event.target.value)} /></Field><Field label={translate("agent.instruction")}><textarea value={instruction} rows={10} placeholder={translate("agent.instruction_placeholder")} className="w-full resize-y rounded-xl bg-control-surface px-4 py-3 text-base leading-6 outline-none focus:bg-control-hover" onChange={(event) => set_instruction(event.target.value)} /></Field><Field label={translate("agent.model")}><ModelSelector current_model_id={model_id} models={text_models} loading={models_loading} trigger_label={translate("creation.select_model")} class_name="h-11 w-full max-w-none justify-start rounded-xl bg-control-surface px-4" on_select_model={set_model_id} /></Field></div>{error ? <p className="mt-6 text-xs text-destructive">{error}</p> : null}<div className="mt-10 flex justify-end"><Button type="submit" variant="primary" disabled={!name.trim() || !model_id || submitting}>{submitting ? common_translate("state.creating") : translate("agent.create")}</Button></div></form>}
  </main></MainViewBody></MainViewLayout>;
}

/** 创建页中的无装饰字段分组。 */
function Field({ label, children }: { /** 字段名称。 */ label: string; /** 字段内容。 */ children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-medium text-foreground">{label}</span>{children}</label>;
}
