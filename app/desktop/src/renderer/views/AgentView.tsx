/** Agent 身份、配置索引与右侧定义编辑容器。 */

import { useEffect, useRef, useState } from "react";
import { TbCheck, TbChevronRight, TbComponents, TbFileText, TbGhost3, TbMessageCircle, TbPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DetailEditorSidebar } from "@/components/DetailEditorSidebar";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import { cn } from "@/lib/utils";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopAgentDefinition, DesktopAgentPluginReference, DesktopAgentSummary, DesktopPluginSummary, DesktopSessionSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Agent 页面可以在右侧编辑的定义分区。 */
type AgentEditorSection = "model" | "soul" | "plugins";

/** Agent 管理页属性。 */
interface AgentViewProps {
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 全部 Workspace。 */ workspaces: DesktopWorkspaceSummary[];
  /** 当前可用 Plugin。 */ plugins: DesktopPluginSummary[];
  /** 当前 Agent 的 Session。 */ sessions: DesktopSessionSummary[];
  /** Renderer 根控制器。 */ controller: DesktopViewController;
  /** 进入 Session。 */ select_session(session_id: string): Promise<void>;
}

/** 左侧展示 Agent 摘要，点击配置项后在右侧展开对应编辑容器。 */
export function AgentView({ agent, workspaces, plugins, sessions, controller, select_session }: AgentViewProps) {
  const [editor_section, set_editor_section] = useState<AgentEditorSection>();
  const [definition, set_definition] = useState<DesktopAgentDefinition>();
  const [loading_definition, set_loading_definition] = useState(false);
  const [saving, set_saving] = useState(false);
  const [definition_dirty, set_definition_dirty] = useState(false);
  const definition_version_ref = useRef(0);
  const [editor_error, set_editor_error] = useState("");
  const bound_plugins = plugins.filter((plugin) => plugin.agent_ids.includes(agent.agent_id));
  const recent_sessions = [...sessions].sort((left, right) => right.updated_at - left.updated_at).slice(0, 5);

  const load_definition = async () => {
    set_loading_definition(true);
    set_editor_error("");
    try {
      set_definition(await controller.get_agent(agent.agent_id));
    } catch (reason) {
      set_editor_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_loading_definition(false);
    }
  };

  useEffect(() => {
    set_editor_section(undefined);
    set_definition(undefined);
    set_definition_dirty(false);
    definition_version_ref.current += 1;
    set_editor_error("");
  }, [agent.agent_id]);

  const open_editor = (section: AgentEditorSection) => {
    set_editor_section(section);
    if (!definition && !loading_definition) void load_definition();
  };

  const update_definition = (value: DesktopAgentDefinition) => {
    definition_version_ref.current += 1;
    set_definition(value);
    set_definition_dirty(true);
  };

  useEffect(() => {
    if (!definition_dirty || !definition) return;
    const version = definition_version_ref.current;
    const pending_definition = definition;
    const timeout_id = window.setTimeout(() => {
      set_saving(true);
      set_editor_error("");
      const plugins_input = Object.fromEntries(Object.entries(pending_definition.plugins).map(([plugin_id, reference]) => [plugin_id, reference.profile ? { profile: reference.profile.trim() } : {}]));
      void controller.update_agent(agent.agent_id, { model_id: pending_definition.model_id, instruction: pending_definition.instruction, plugins: plugins_input })
        .then(() => {
          if (definition_version_ref.current === version) set_definition_dirty(false);
        })
        .catch((reason) => set_editor_error(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => set_saving(false));
    }, 500);
    return () => window.clearTimeout(timeout_id);
  }, [agent.agent_id, controller.update_agent, definition, definition_dirty]);

  return <div className="flex h-full min-h-0 min-w-0 flex-1 bg-background">
    <MainViewLayout>
      <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2"><div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-xs text-muted-foreground"><TbGhost3 /><span className="truncate font-medium text-foreground/80">{agent.agent_id}</span></div></header>
      <MainViewBody>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[42rem] px-6 pb-12 pt-14">
        <div className="mb-9 flex min-w-0 items-center gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-muted-foreground"><TbGhost3 className="size-6" /></div><div className="min-w-0"><h1 className="truncate text-lg font-semibold text-foreground">{agent.agent_id}</h1><p className="mt-1 truncate text-xs text-muted-foreground">可进入 {workspaces.length} 个 Workspace</p></div></div>
        <SettingsGroup title="Definition">
          <EditablePropertyRow icon={<LLMModelIcon model_id={agent.model_id} size_class="size-4" />} label="Model" value={agent.model_id || "未配置"} active={editor_section === "model"} on_select={() => open_editor("model")} />
          <EditablePropertyRow icon={<TbFileText />} label="SOUL.md" value={definition ? `${definition.instruction.length} characters` : "Agent instruction"} active={editor_section === "soul"} on_select={() => open_editor("soul")} />
          <EditablePropertyRow icon={<TbComponents />} label="Plugins" value={`${bound_plugins.length} enabled`} active={editor_section === "plugins"} on_select={() => open_editor("plugins")} last />
        </SettingsGroup>
        <SettingsGroup title="Recent Sessions">{recent_sessions.length > 0 ? recent_sessions.map((session, index) => <button key={session.session_id} className={`flex min-h-11 w-full items-center gap-3 px-3.5 text-left hover:bg-foreground/[0.04] ${index === recent_sessions.length - 1 ? "" : "border-b border-border/45"}`} onClick={() => void select_session(session.session_id)}><TbMessageCircle className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{session.title || "新对话"}</span><span className="text-[0.625rem] text-muted-foreground">{session.message_count} messages</span></button>) : <EmptyRow text="暂无 Session" />}</SettingsGroup>
      </div></div>
      </MainViewBody>
    </MainViewLayout>
    {editor_section ? <AgentEditorPanel section={editor_section} definition={definition} plugins={plugins} controller={controller} loading={loading_definition} error={editor_error} set_definition={update_definition} close_editor={() => set_editor_section(undefined)} /> : null}
  </div>;
}

/** Agent 页面右侧的分区编辑容器。 */
function AgentEditorPanel({ section, definition, plugins, controller, loading, error, set_definition, close_editor }: {
  /** 当前编辑分区。 */ section: AgentEditorSection;
  /** 当前未提交定义。 */ definition?: DesktopAgentDefinition;
  /** 可注册的全部 Plugin。 */ plugins: DesktopPluginSummary[];
  /** Renderer 根控制器。 */ controller: DesktopViewController;
  /** 是否正在读取定义。 */ loading: boolean;
  /** 当前编辑错误。 */ error: string;
  /** 替换未提交定义。 */ set_definition(value: DesktopAgentDefinition): void;
  /** 收起右侧容器。 */ close_editor(): void;
}) {
  const titles: Record<AgentEditorSection, string> = { model: "Model", soul: "SOUL.md", plugins: "Plugins" };
  return <DetailEditorSidebar title={titles[section]} storage_key="downcity.agent_editor_width" default_width={400} max_width={560} on_close={close_editor}>
        {loading && !definition ? <div className="py-10 text-center text-xs text-muted-foreground">加载中…</div> : null}
        {definition && section === "model" ? <ModelEditor definition={definition} controller={controller} set_definition={set_definition} /> : null}
        {definition && section === "soul" ? <SoulEditor definition={definition} controller={controller} set_definition={set_definition} /> : null}
        {definition && section === "plugins" ? <PluginEditor definition={definition} plugins={plugins} controller={controller} set_definition={set_definition} /> : null}
        {error ? <div className="mt-3 text-[0.6875rem] leading-4 text-destructive">{error}</div> : null}
  </DetailEditorSidebar>;
}

/** 默认模型编辑器。 */
function ModelEditor({ definition, controller, set_definition }: { /** 未提交定义。 */ definition: DesktopAgentDefinition; /** Renderer 根控制器。 */ controller: DesktopViewController; /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  const text_models = controller.models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)));
  if (controller.models_loading && text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">模型加载中…</div>;
  if (text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">暂无文本模型</div>;
  return <div className="-mx-3 divide-y divide-border/45 border-y border-border/45">
    {text_models.map((model) => {
      const active = model.model_id === definition.model_id;
      return <button key={model.model_id} type="button" onClick={() => set_definition({ ...definition, model_id: model.model_id })} aria-pressed={active} className={cn("group flex min-h-10 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-interaction-hover", active && "bg-interaction-selected hover:bg-interaction-active")}>
        <LLMModelIcon model_id={model.model_id} size_class="size-4" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90" title={model.name}>{model.name}</span>
        {model.context_window ? <span className="rounded bg-foreground/[0.04] px-1.5 text-[10px] leading-4 text-muted-foreground/75 tabular-nums">{format_context_window(model.context_window)}</span> : null}
        <TbCheck className={cn("size-4 shrink-0 text-foreground transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden="true" />
      </button>;
    })}
  </div>;
}

/** 格式化模型上下文窗口，保持与设置页模型列表一致。 */
function format_context_window(value: number): string { return value >= 1000 ? `${Math.round(value / 1000)}K context` : `${value} context`; }

/** Agent 主体指令编辑器。 */
function SoulEditor({ definition, controller, set_definition }: { /** 未提交定义。 */ definition: DesktopAgentDefinition; /** Renderer 根控制器。 */ controller: DesktopViewController; /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  const editor_ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = editor_ref.current;
    if (editor && editor.innerText !== definition.instruction) editor.innerText = definition.instruction;
  }, [definition.instruction]);
  return <div
    ref={editor_ref}
    contentEditable
    suppressContentEditableWarning
    role="textbox"
    aria-label="SOUL.md 内容"
    aria-multiline="true"
    autoFocus
    spellCheck={controller.settings.spellcheck_enabled}
    data-placeholder="开始编辑 SOUL.md…"
    className="min-h-full w-full bg-background px-2 py-1 font-mono text-xs leading-6 text-foreground outline-none empty:before:pointer-events-none empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]"
    onInput={(event) => set_definition({ ...definition, instruction: event.currentTarget.innerText })}
  />;
}

/** Plugin 注册与 profile 编辑器。 */
function PluginEditor({ definition, plugins, controller, set_definition }: { /** 未提交定义。 */ definition: DesktopAgentDefinition; /** 可用 Plugin。 */ plugins: DesktopPluginSummary[]; /** Desktop 根控制器。 */ controller: DesktopViewController; /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  const [expanded_plugins, set_expanded_plugins] = useState<Set<string>>(() => new Set());
  const [missing_profile_plugin, set_missing_profile_plugin] = useState<DesktopPluginSummary>();
  const set_plugin = (plugin: DesktopPluginSummary, enabled: boolean) => {
    const next_plugins = { ...definition.plugins };
    if (!enabled) {
      delete next_plugins[plugin.plugin_id];
    } else if (plugin.configuration === "required") {
      const profile = plugin.profile_ids[0];
      if (!profile) {
        set_missing_profile_plugin(plugin);
        return;
      }
      next_plugins[plugin.plugin_id] = { profile };
    } else {
      next_plugins[plugin.plugin_id] = {};
    }
    set_definition({ ...definition, plugins: next_plugins });
  };
  const set_profile = (plugin_id: string, profile: string) => set_definition({
    ...definition,
    plugins: { ...definition.plugins, [plugin_id]: { profile } },
  });
  const toggle_expanded = (plugin_id: string) => set_expanded_plugins((current) => {
    const next = new Set(current);
    if (next.has(plugin_id)) next.delete(plugin_id);
    else next.add(plugin_id);
    return next;
  });
  return <>
    <div className="space-y-1">{plugins.map((plugin) => {
      const reference = definition.plugins[plugin.plugin_id];
      const expanded = expanded_plugins.has(plugin.plugin_id);
      if (plugin.configuration === "none") {
        return <label key={plugin.plugin_id} className="flex min-h-10 items-center gap-2 rounded-lg bg-background px-2.5">
          <input type="checkbox" checked={Boolean(reference)} onChange={(event) => set_plugin(plugin, event.target.checked)} />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{plugin.title}</span>
        </label>;
      }
      return <div key={plugin.plugin_id} className="overflow-hidden rounded-xl border border-border/60 bg-surface-subtle">
        <div className="flex min-h-11 items-center gap-2 px-3 hover:bg-interaction-hover">
          <input type="checkbox" checked={Boolean(reference)} onChange={(event) => set_plugin(plugin, event.target.checked)} />
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle_expanded(plugin.plugin_id)}>
            <TbChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{plugin.title}</span>
            {reference?.profile
              ? <span className="max-w-32 truncate rounded-md bg-primary/[0.1] px-1.5 py-0.5 font-mono text-[0.625rem] text-primary">{reference.profile}</span>
              : <span className={`text-[0.625rem] ${plugin.configuration === "required" ? "text-destructive" : "text-muted-foreground"}`}>{plugin.configuration === "required" ? "需要配置" : "默认配置"}</span>}
          </button>
        </div>
        {expanded ? <div className="grid gap-1.5 border-t border-border/50 bg-background/45 p-2">
          {plugin.configuration === "optional" ? <button type="button" className={`flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-left text-xs transition-colors ${reference && !reference.profile ? "border-primary/40 bg-primary/[0.1] text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:bg-interaction-hover"}`} onClick={() => set_plugin(plugin, true)}>
            <span className={`size-1.5 shrink-0 rounded-full ${reference && !reference.profile ? "bg-primary" : "bg-muted-foreground/40"}`} />
            <span className="min-w-0 flex-1">默认配置</span>
          </button> : null}
          {plugin.profile_ids.map((profile_id) => <button key={profile_id} type="button" className={`flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-left text-xs transition-colors ${reference?.profile === profile_id ? "border-primary/40 bg-primary/[0.1] text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:bg-interaction-hover"}`} onClick={() => set_profile(plugin.plugin_id, profile_id)}>
            <span className={`size-1.5 shrink-0 rounded-full ${reference?.profile === profile_id ? "bg-primary" : "bg-muted-foreground/40"}`} />
            <span className="min-w-0 flex-1 truncate font-mono">{profile_id}</span>
            {reference?.profile === profile_id ? <span className="text-[0.625rem] text-primary">已选择</span> : null}
          </button>)}
          <Button onClick={() => set_missing_profile_plugin(plugin)}><TbPlus />添加配置</Button>
        </div> : null}
      </div>;
    })}{plugins.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">暂无可用 Plugin</div> : null}</div>
    <Dialog open={Boolean(missing_profile_plugin)} onOpenChange={(open) => { if (!open) set_missing_profile_plugin(undefined); }}>
      <DialogContent><DialogHeader><DialogTitle>为 {missing_profile_plugin?.title} 添加配置</DialogTitle><DialogDescription>创建一个命名 Profile 后，Agent 可以显式选择它。</DialogDescription></DialogHeader><DialogBody><div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">创建完成后返回当前 Agent 页面，再展开 Plugin 选择刚刚创建的 Profile。</div></DialogBody><DialogFooter><Button onClick={() => set_missing_profile_plugin(undefined)}>取消</Button><Button variant="primary" onClick={() => { const plugin_id = missing_profile_plugin?.plugin_id; set_missing_profile_plugin(undefined); if (plugin_id) controller.select_plugin(plugin_id); }}>去创建配置</Button></DialogFooter></DialogContent>
    </Dialog>
  </>;
}

/** 设置式信息分组。 */
function SettingsGroup({ title, children }: { /** 分组标题。 */ title: string; /** 分组内容。 */ children: React.ReactNode }) { return <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">{title}</h2><div className="overflow-hidden rounded-lg bg-surface-subtle">{children}</div></section>; }

/** 可打开右侧编辑器的 Agent 定义行。 */
function EditablePropertyRow({ icon, label, value, active, on_select, last = false }: { /** 属性图标。 */ icon: React.ReactNode; /** 属性名称。 */ label: string; /** 属性值。 */ value: string; /** 是否正在编辑。 */ active: boolean; /** 打开编辑器。 */ on_select(): void; /** 是否最后一行。 */ last?: boolean }) { return <button className={`grid min-h-11 w-full grid-cols-[1rem_6rem_minmax(0,1fr)_1rem] items-center gap-3 px-3.5 text-left transition-colors ${active ? "bg-primary/[0.08]" : "hover:bg-foreground/[0.04]"} ${last ? "" : "border-b border-border/45"}`} onClick={on_select}><span className="text-muted-foreground [&_svg]:size-4">{icon}</span><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right text-[0.6875rem] text-foreground/80">{value}</span><TbChevronRight className="size-3.5 text-muted-foreground" /></button>; }

/** 空分组占位。 */
function EmptyRow({ text }: { /** 空状态文本。 */ text: string }) { return <div className="px-3.5 py-4 text-xs text-muted-foreground">{text}</div>; }
