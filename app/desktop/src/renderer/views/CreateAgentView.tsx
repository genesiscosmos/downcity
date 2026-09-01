/** Agent 的 AI 辅助与手动创建 MainView。 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TbArrowLeft, TbGhost3, TbSparkles } from "react-icons/tb";
import { ModelSelector } from "@/components/model/ModelSelector";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import type { CreateAgentFormValue } from "@/types/DesktopView";
import type { DesktopAgentPluginReference, DesktopModelSummary, DesktopPluginSummary } from "@common/types/DesktopApi";

/** Agent 创建页面属性。 */
interface CreateAgentViewProps {
  /** 当前模型目录。 */ models: DesktopModelSummary[];
  /** 模型目录是否正在加载。 */ models_loading: boolean;
  /** 系统默认文本模型。 */ default_model_id: string;
  /** 当前 Plugin catalog。 */ plugins: DesktopPluginSummary[];
  /** 提交最终 Agent 配置。 */ create_agent(value: CreateAgentFormValue): Promise<void>;
}

/** 用户在同一页面中选择 AI 起草或手动配置 Agent。 */
export function CreateAgentView({ models, models_loading, default_model_id, plugins, create_agent }: CreateAgentViewProps) {
  const text_models = useMemo(() => models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality))), [models]);
  const available_plugins = useMemo(() => plugins.filter((plugin) => plugin.has_agent), [plugins]);
  const initial_model_id = text_models.some((model) => model.model_id === default_model_id) ? default_model_id : text_models[0]?.model_id || "";
  const [editing, set_editing] = useState(false);
  const [prompt, set_prompt] = useState("");
  const [name, set_name] = useState("");
  const [description, set_description] = useState("");
  const [instruction, set_instruction] = useState("");
  const [generation_model_id, set_generation_model_id] = useState(initial_model_id);
  const [model_id, set_model_id] = useState(initial_model_id);
  const [plugin_references, set_plugin_references] = useState<Record<string, DesktopAgentPluginReference>>({});
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
        plugins: available_plugins.map(({ plugin_id, title, description: plugin_description }) => ({ plugin_id, title, description: plugin_description })),
      });
      set_name(draft.name);
      set_description(draft.description);
      set_instruction(draft.instruction);
      set_plugin_references(Object.fromEntries(draft.plugin_ids.map((plugin_id) => [plugin_id, {}])));
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
      await create_agent({ name: name.trim(), description: description.trim(), instruction: instruction.trim(), model_id, plugins: plugin_references });
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
      set_submitting(false);
    }
  };

  return <MainViewLayout><MainViewHeader title="创建 Agent" /><MainViewBody><main className="min-h-0 flex-1 overflow-y-auto bg-background">
    {!editing ? <section className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-10 py-16"><div className="mb-8"><div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><TbGhost3 className="size-6" /></div><h1 className="text-2xl font-semibold tracking-tight">你想创建一个什么角色？</h1><p className="mt-2 text-sm text-muted-foreground">描述它要做什么、擅长什么，AI 会为你准备名称、简介、指令和 Plugins。</p></div><textarea autoFocus value={prompt} rows={6} placeholder="例如：创建一个产品研究助手，能够搜索资料、分析竞品，并输出结构清晰的中文报告。" className="w-full resize-none rounded-2xl bg-muted/40 px-5 py-4 text-base leading-7 outline-none placeholder:text-muted-foreground/60 focus:bg-muted/55" onChange={(event) => set_prompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void generate_draft(); }} /><div className="mt-4 flex items-center gap-3"><span className="shrink-0 text-xs text-muted-foreground">生成模型</span><ModelSelector current_model_id={generation_model_id} models={text_models} loading={models_loading} trigger_label="选择生成模型" class_name="h-9 min-w-52 justify-start rounded-xl bg-muted/40 px-3" on_select_model={set_generation_model_id} /></div>{error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}<div className="mt-5 flex items-center gap-3"><Button variant="primary" disabled={!prompt.trim() || !generation_model_id || generating} onClick={() => void generate_draft()}><TbSparkles />{generating ? "正在生成…" : "AI 生成"}</Button><Button disabled={generating} onClick={() => { set_model_id(initial_model_id); set_editing(true); }}>手动配置</Button><span className="ml-auto text-xs text-muted-foreground">⌘ Enter 生成</span></div></section> : <form onSubmit={(event) => void submit(event)} className="mx-auto w-full max-w-3xl px-10 py-12"><button type="button" className="mb-8 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => set_editing(false)}><TbArrowLeft />返回描述</button><div className="space-y-8"><Field label="名称"><input autoFocus value={name} placeholder="Agent 名称" className="h-11 w-full rounded-xl bg-muted/40 px-4 text-sm outline-none focus:bg-muted/55" onChange={(event) => set_name(event.target.value)} /></Field><Field label="简介"><input value={description} placeholder="一句话介绍这个 Agent" className="h-11 w-full rounded-xl bg-muted/40 px-4 text-sm outline-none focus:bg-muted/55" onChange={(event) => set_description(event.target.value)} /></Field><Field label="角色指令"><textarea value={instruction} rows={10} placeholder="定义角色、目标、工作原则和输出要求" className="w-full resize-y rounded-xl bg-muted/40 px-4 py-3 text-sm leading-6 outline-none focus:bg-muted/55" onChange={(event) => set_instruction(event.target.value)} /></Field><Field label="默认模型"><ModelSelector current_model_id={model_id} models={text_models} loading={models_loading} trigger_label="选择模型" class_name="h-11 w-full max-w-none justify-start rounded-xl bg-muted/40 px-4" on_select_model={set_model_id} /></Field>{available_plugins.length > 0 ? <Field label="Plugins"><div className="space-y-1">{available_plugins.map((plugin) => <div key={plugin.plugin_id} className="flex items-center gap-4 rounded-xl px-3 py-2.5 hover:bg-muted/30"><div className="min-w-0 flex-1"><div className="text-sm font-medium">{plugin.title}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{plugin.description}</div></div><Switch checked={Boolean(plugin_references[plugin.plugin_id])} onCheckedChange={(enabled) => set_plugin_references((current) => { const next = { ...current }; if (enabled) next[plugin.plugin_id] = {}; else delete next[plugin.plugin_id]; return next; })} /></div>)}</div></Field> : null}</div>{error ? <p className="mt-6 text-xs text-destructive">{error}</p> : null}<div className="mt-10 flex justify-end"><Button type="submit" variant="primary" disabled={!name.trim() || !model_id || submitting}>{submitting ? "创建中…" : "创建 Agent"}</Button></div></form>}
  </main></MainViewBody></MainViewLayout>;
}

/** 创建页中的无装饰字段分组。 */
function Field({ label, children }: { /** 字段名称。 */ label: string; /** 字段内容。 */ children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-medium text-foreground">{label}</span>{children}</label>;
}
