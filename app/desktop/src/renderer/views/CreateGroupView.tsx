/** Group 的 AI 辅助与手动创建 MainView。 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TbArrowLeft, TbSparkles, TbUsers } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ModelSelector } from "@/components/model/ModelSelector";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopAgentSummary, DesktopCreateGroupInput, DesktopModelSummary } from "@common/types/DesktopApi";

/** Group 创建页面属性。 */
interface CreateGroupViewProps {
  /** 当前 Agent 列表。 */ agents: DesktopAgentSummary[];
  /** 当前模型目录。 */ models: DesktopModelSummary[];
  /** 模型目录是否正在加载。 */ models_loading: boolean;
  /** 系统默认文本模型。 */ default_model_id: string;
  /** 提交最终 Group 配置。 */ create_group(input: DesktopCreateGroupInput): Promise<void>;
}

/** 用户在同一页面中选择 AI 起草或手动配置 Group。 */
export function CreateGroupView({ agents, models, models_loading, default_model_id, create_group }: CreateGroupViewProps) {
  const text_models = useMemo(() => models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality))), [models]);
  const initial_model_id = text_models.some((model) => model.model_id === default_model_id) ? default_model_id : text_models[0]?.model_id || "";
  const [editing, set_editing] = useState(false);
  const [prompt, set_prompt] = useState("");
  const [name, set_name] = useState("");
  const [instruction, set_instruction] = useState("");
  const [generation_model_id, set_generation_model_id] = useState(initial_model_id);
  const [model_id, set_model_id] = useState(initial_model_id);
  const [member_agent_ids, set_member_agent_ids] = useState<string[]>([]);
  const [generating, set_generating] = useState(false);
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState("");

  useEffect(() => {
    if (!generation_model_id && initial_model_id) set_generation_model_id(initial_model_id);
    if (!model_id && initial_model_id) set_model_id(initial_model_id);
  }, [generation_model_id, initial_model_id, model_id]);

  const generate_draft = async () => {
    if (!prompt.trim() || !generation_model_id || agents.length === 0) return;
    set_generating(true);
    set_error("");
    try {
      const draft = await window.downcity.group.generate_draft({ prompt: prompt.trim(), model_id: generation_model_id, agents: agents.map(({ agent_id, name: agent_name, description }) => ({ agent_id, name: agent_name, description })) });
      set_name(draft.name);
      set_instruction(draft.instruction);
      set_member_agent_ids(draft.member_agent_ids);
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
    if (!name.trim() || !model_id || member_agent_ids.length === 0) return;
    set_submitting(true);
    set_error("");
    try { await create_group({ name: name.trim(), instruction: instruction.trim(), model_id, member_agent_ids }); }
    catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); set_submitting(false); }
  };

  return <MainViewLayout><MainViewHeader title="创建 Group" /><MainViewBody><main className="min-h-0 flex-1 overflow-y-auto bg-background">
    {!editing ? <section className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-10 py-16"><div className="mb-8"><div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><TbUsers className="size-6" /></div><h1 className="text-2xl font-semibold tracking-tight">你想组建一个怎样的团队？</h1><p className="mt-2 text-sm text-muted-foreground">描述协作目标和分工，AI 会从已有 Agent 中推荐成员并生成协作方案。</p></div><textarea autoFocus value={prompt} rows={6} placeholder="例如：创建一个产品研究小组，负责收集市场资料、分析竞品，并共同输出研究报告。" className="w-full resize-none rounded-2xl bg-muted/40 px-5 py-4 text-base leading-7 outline-none placeholder:text-muted-foreground/60 focus:bg-muted/55" onChange={(event) => set_prompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void generate_draft(); }} /><div className="mt-4 flex items-center gap-3"><span className="shrink-0 text-xs text-muted-foreground">生成模型</span><ModelSelector current_model_id={generation_model_id} models={text_models} loading={models_loading} trigger_label="选择生成模型" class_name="h-9 min-w-52 justify-start rounded-xl bg-muted/40 px-3" on_select_model={set_generation_model_id} /></div>{agents.length === 0 ? <p className="mt-3 text-xs text-destructive">请先创建至少一个 Agent</p> : null}{error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}<div className="mt-5 flex items-center gap-3"><Button variant="primary" disabled={!prompt.trim() || !generation_model_id || agents.length === 0 || generating} onClick={() => void generate_draft()}><TbSparkles />{generating ? "正在生成…" : "AI 生成"}</Button><Button disabled={generating || agents.length === 0} onClick={() => { set_model_id(initial_model_id); set_editing(true); }}>手动配置</Button><span className="ml-auto text-xs text-muted-foreground">⌘ Enter 生成</span></div></section> : <form onSubmit={(event) => void submit(event)} className="mx-auto w-full max-w-3xl px-10 py-12"><button type="button" className="mb-8 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => set_editing(false)}><TbArrowLeft />返回描述</button><div className="space-y-8"><Field label="名称"><input autoFocus value={name} placeholder="Group 名称" className="h-11 w-full rounded-xl bg-muted/40 px-4 text-sm outline-none focus:bg-muted/55" onChange={(event) => set_name(event.target.value)} /></Field><Field label="协作目标"><textarea value={instruction} rows={9} placeholder="说明团队目标、成员分工、协作方式和交付要求" className="w-full resize-y rounded-xl bg-muted/40 px-4 py-3 text-sm leading-6 outline-none focus:bg-muted/55" onChange={(event) => set_instruction(event.target.value)} /></Field><Field label="群聊模型"><ModelSelector current_model_id={model_id} models={text_models} loading={models_loading} trigger_label="选择模型" class_name="h-11 w-full max-w-none justify-start rounded-xl bg-muted/40 px-4" on_select_model={set_model_id} /></Field><Field label="成员"><div className="space-y-1">{agents.map((agent) => <div key={agent.agent_id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/30"><AgentAvatar agent={agent} class_name="size-8" /><div className="min-w-0 flex-1"><div className="text-sm font-medium">{agent.name}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description}</div></div><Switch checked={member_agent_ids.includes(agent.agent_id)} onCheckedChange={(enabled) => set_member_agent_ids((current) => enabled ? [...new Set([...current, agent.agent_id])] : current.filter((agent_id) => agent_id !== agent.agent_id))} /></div>)}</div></Field></div>{error ? <p className="mt-6 text-xs text-destructive">{error}</p> : null}<div className="mt-10 flex justify-end"><Button type="submit" variant="primary" disabled={!name.trim() || !model_id || member_agent_ids.length === 0 || submitting}>{submitting ? "创建中…" : "创建 Group"}</Button></div></form>}
  </main></MainViewBody></MainViewLayout>;
}

/** 创建页中的无装饰字段分组。 */
function Field({ label, children }: { /** 字段名称。 */ label: string; /** 字段内容。 */ children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-medium text-foreground">{label}</span>{children}</label>;
}
