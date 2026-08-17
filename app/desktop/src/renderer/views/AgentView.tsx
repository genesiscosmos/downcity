/** Agent 身份、配置索引与右侧定义编辑容器。 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TbChevronRight, TbComponents, TbFileText, TbFolder, TbGhost3, TbMessageCircle } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import { ModelSelector } from "@/components/model/ModelSelector";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import { SHELL_PANEL_TRANSITION } from "@/layouts/shellMotion";
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
  /** 创建空对话。 */ create_session(): Promise<void>;
  /** 进入 Session。 */ select_session(session_id: string): Promise<void>;
}

/** 左侧展示 Agent 摘要，点击配置项后在右侧展开对应编辑容器。 */
export function AgentView({ agent, workspaces, plugins, sessions, controller, create_session, select_session }: AgentViewProps) {
  const [editor_section, set_editor_section] = useState<AgentEditorSection>();
  const [definition, set_definition] = useState<DesktopAgentDefinition>();
  const [loading_definition, set_loading_definition] = useState(false);
  const [saving, set_saving] = useState(false);
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
    set_editor_error("");
  }, [agent.agent_id]);

  const open_editor = (section: AgentEditorSection) => {
    set_editor_section(section);
    if (!definition && !loading_definition) void load_definition();
  };

  const save_definition = async () => {
    if (!definition) return;
    set_saving(true);
    set_editor_error("");
    try {
      const plugins_input = Object.fromEntries(Object.entries(definition.plugins).map(([plugin_id, reference]) => [plugin_id, { profile: reference.profile.trim() || "default" }]));
      await controller.update_agent(agent.agent_id, { model_id: definition.model_id, instruction: definition.instruction, plugins: plugins_input });
      await load_definition();
    } catch (reason) {
      set_editor_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_saving(false);
    }
  };

  return <div className="flex h-full min-h-0 min-w-0 flex-1 bg-background">
    <MainViewLayout>
      <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2"><div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-xs text-muted-foreground"><TbGhost3 /><span className="truncate font-medium text-foreground/80">{agent.agent_id}</span></div><Button variant="primary" onClick={() => void create_session()}><TbMessageCircle /><span>新对话</span></Button></header>
      <MainViewBody>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[42rem] px-6 pb-12 pt-14">
        <div className="mb-9 flex min-w-0 items-center gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-muted-foreground"><TbGhost3 className="size-6" /></div><div className="min-w-0"><h1 className="truncate text-lg font-semibold text-foreground">{agent.agent_id}</h1><p className="mt-1 truncate text-xs text-muted-foreground">可进入 {workspaces.length} 个 Workspace</p></div></div>
        <SettingsGroup title="Definition">
          <EditablePropertyRow icon={<LLMModelIcon model_id={agent.model_id} size_class="size-4" />} label="Model" value={agent.model_id || "未配置"} active={editor_section === "model"} on_select={() => open_editor("model")} />
          <EditablePropertyRow icon={<TbFileText />} label="SOUL.md" value={definition ? `${definition.instruction.length} characters` : "Agent instruction"} active={editor_section === "soul"} on_select={() => open_editor("soul")} />
          <EditablePropertyRow icon={<TbComponents />} label="Plugins" value={`${bound_plugins.length} enabled`} active={editor_section === "plugins"} on_select={() => open_editor("plugins")} last />
        </SettingsGroup>
        <SettingsGroup title="Runtime"><PropertyRow icon={<TbFolder />} label="Workspaces" value={`${workspaces.length} available`} /><PropertyRow icon={<TbGhost3 />} label="Version" value={agent.version} last /></SettingsGroup>
        <SettingsGroup title="Recent Sessions">{recent_sessions.length > 0 ? recent_sessions.map((session, index) => <button key={session.session_id} className={`flex min-h-11 w-full items-center gap-3 px-3.5 text-left hover:bg-foreground/[0.04] ${index === recent_sessions.length - 1 ? "" : "border-b border-border/45"}`} onClick={() => void select_session(session.session_id)}><TbMessageCircle className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{session.title || "新对话"}</span><span className="text-[0.625rem] text-muted-foreground">{session.message_count} messages</span></button>) : <EmptyRow text="暂无 Session" />}</SettingsGroup>
      </div></div>
      </MainViewBody>
    </MainViewLayout>
    {editor_section ? <AgentEditorPanel section={editor_section} definition={definition} plugins={plugins} controller={controller} loading={loading_definition} saving={saving} error={editor_error} set_definition={set_definition} save_definition={save_definition} cancel_edit={() => void load_definition()} close_editor={() => set_editor_section(undefined)} /> : null}
  </div>;
}

/** Agent 页面右侧的分区编辑容器。 */
function AgentEditorPanel({ section, definition, plugins, controller, loading, saving, error, set_definition, save_definition, cancel_edit, close_editor }: {
  /** 当前编辑分区。 */ section: AgentEditorSection;
  /** 当前未提交定义。 */ definition?: DesktopAgentDefinition;
  /** 可注册的全部 Plugin。 */ plugins: DesktopPluginSummary[];
  /** Renderer 根控制器。 */ controller: DesktopViewController;
  /** 是否正在读取定义。 */ loading: boolean;
  /** 是否正在保存定义。 */ saving: boolean;
  /** 当前编辑错误。 */ error: string;
  /** 替换未提交定义。 */ set_definition(value: DesktopAgentDefinition): void;
  /** 保存完整定义。 */ save_definition(): Promise<void>;
  /** 放弃未提交内容并重新读取。 */ cancel_edit(): void;
  /** 收起右侧容器。 */ close_editor(): void;
}) {
  const titles: Record<AgentEditorSection, string> = { model: "Model", soul: "SOUL.md", plugins: "Plugins" };
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.agent_editor_width")) || 400);
  const handle_width_change = useCallback((width: number) => {
    set_stored_width(width);
    localStorage.setItem("downcity.agent_editor_width", String(width));
  }, []);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({
    stored_width,
    min_width: 360,
    max_width: 560,
    default_width: 400,
    resize_edge: "left",
    on_width_change: handle_width_change,
  });

  return <motion.aside initial={false} animate={{ width: current_width }} transition={{ ...SHELL_PANEL_TRANSITION, duration: is_resizing ? 0 : SHELL_PANEL_TRANSITION.duration }} className="relative flex h-full min-h-0 flex-none overflow-hidden bg-muted">
    <div className="absolute inset-y-0 right-0 flex h-full flex-col border-l border-border/45 bg-muted" style={{ width: current_width }}>
      <div onMouseDown={handle_resize_start} className="absolute -left-[3px] top-0 z-10 h-full w-1.5 cursor-ew-resize" />
      <div className="header-drag-region flex h-10 shrink-0 items-center gap-2 px-3"><h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{titles[section]}</h2><Button onClick={close_editor}>关闭</Button></div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/35 p-3">
        {loading && !definition ? <div className="py-10 text-center text-xs text-muted-foreground">加载中…</div> : null}
        {definition && section === "model" ? <ModelEditor definition={definition} controller={controller} set_definition={set_definition} /> : null}
        {definition && section === "soul" ? <SoulEditor definition={definition} controller={controller} set_definition={set_definition} /> : null}
        {definition && section === "plugins" ? <PluginEditor definition={definition} plugins={plugins} set_definition={set_definition} /> : null}
        {error ? <div className="mt-3 text-[0.6875rem] leading-4 text-destructive">{error}</div> : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border/35 p-3"><Button disabled={loading || saving} onClick={cancel_edit}>取消</Button><Button variant="primary" disabled={!definition || loading || saving || !definition.model_id.trim()} onClick={() => void save_definition()}>{saving ? "保存中…" : "保存"}</Button></div>
    </div>
  </motion.aside>;
}

/** 默认模型编辑器。 */
function ModelEditor({ definition, controller, set_definition }: { /** 未提交定义。 */ definition: DesktopAgentDefinition; /** Renderer 根控制器。 */ controller: DesktopViewController; /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  const text_models = controller.models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)));
  return <ModelSelector current_model_id={definition.model_id} models={text_models} loading={controller.models_loading} trigger_label="选择模型" class_name="h-8 w-full max-w-none justify-start rounded-lg border border-input bg-background px-2.5" on_select_model={(model_id) => set_definition({ ...definition, model_id })} />;
}

/** Agent 主体指令编辑器。 */
function SoulEditor({ definition, controller, set_definition }: { /** 未提交定义。 */ definition: DesktopAgentDefinition; /** Renderer 根控制器。 */ controller: DesktopViewController; /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  return <textarea autoFocus value={definition.instruction} rows={18} spellCheck={controller.settings.spellcheck_enabled} className="min-h-72 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 font-mono text-xs leading-5 text-foreground" onChange={(event) => set_definition({ ...definition, instruction: event.target.value })} />;
}

/** Plugin 注册与 profile 编辑器。 */
function PluginEditor({ definition, plugins, set_definition }: { /** 未提交定义。 */ definition: DesktopAgentDefinition; /** 可用 Plugin。 */ plugins: DesktopPluginSummary[]; /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  const set_plugin = (plugin_id: string, enabled: boolean) => {
    const next_plugins = { ...definition.plugins };
    if (enabled) next_plugins[plugin_id] = { profile: "default" };
    else delete next_plugins[plugin_id];
    set_definition({ ...definition, plugins: next_plugins });
  };
  const set_profile = (plugin_id: string, reference: DesktopAgentPluginReference, profile: string) => set_definition({ ...definition, plugins: { ...definition.plugins, [plugin_id]: { ...reference, profile } } });
  return <div className="space-y-1">{plugins.map((plugin) => {
    const reference = definition.plugins[plugin.plugin_id];
    const profile_ids = [...new Set([reference?.profile, ...plugin.profile_ids, "default"].filter((value): value is string => Boolean(value)))];
    return <div key={plugin.plugin_id} className="rounded-lg bg-background px-2.5 py-2"><label className="flex min-h-6 items-center gap-2"><input type="checkbox" checked={Boolean(reference)} onChange={(event) => set_plugin(plugin.plugin_id, event.target.checked)} /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{plugin.title}</span></label>{reference ? <select value={reference.profile} className="mt-2 h-7 w-full rounded-md border border-input bg-background px-2 font-mono text-[0.6875rem] text-foreground" onChange={(event) => set_profile(plugin.plugin_id, reference, event.target.value)}>{profile_ids.map((profile_id) => <option key={profile_id} value={profile_id}>{profile_id}</option>)}</select> : null}</div>;
  })}{plugins.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">暂无可用 Plugin</div> : null}</div>;
}

/** 设置式信息分组。 */
function SettingsGroup({ title, children }: { /** 分组标题。 */ title: string; /** 分组内容。 */ children: React.ReactNode }) { return <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">{title}</h2><div className="overflow-hidden rounded-lg bg-surface-subtle">{children}</div></section>; }

/** 可打开右侧编辑器的 Agent 定义行。 */
function EditablePropertyRow({ icon, label, value, active, on_select, last = false }: { /** 属性图标。 */ icon: React.ReactNode; /** 属性名称。 */ label: string; /** 属性值。 */ value: string; /** 是否正在编辑。 */ active: boolean; /** 打开编辑器。 */ on_select(): void; /** 是否最后一行。 */ last?: boolean }) { return <button className={`grid min-h-11 w-full grid-cols-[1rem_6rem_minmax(0,1fr)_1rem] items-center gap-3 px-3.5 text-left transition-colors ${active ? "bg-primary/[0.08]" : "hover:bg-foreground/[0.04]"} ${last ? "" : "border-b border-border/45"}`} onClick={on_select}><span className="text-muted-foreground [&_svg]:size-4">{icon}</span><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right text-[0.6875rem] text-foreground/80">{value}</span><TbChevronRight className="size-3.5 text-muted-foreground" /></button>; }

/** Agent 只读属性行。 */
function PropertyRow({ icon, label, value, last = false }: { /** 属性图标。 */ icon: React.ReactNode; /** 属性名称。 */ label: string; /** 属性值。 */ value: string; /** 是否最后一行。 */ last?: boolean }) { return <div className={`grid min-h-11 grid-cols-[1rem_7rem_minmax(0,1fr)] items-center gap-3 px-3.5 ${last ? "" : "border-b border-border/45"}`}><span className="text-muted-foreground [&_svg]:size-4">{icon}</span><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right font-mono text-[0.6875rem] text-foreground/80" title={value}>{value}</span></div>; }

/** 空分组占位。 */
function EmptyRow({ text }: { /** 空状态文本。 */ text: string }) { return <div className="px-3.5 py-4 text-xs text-muted-foreground">{text}</div>; }
