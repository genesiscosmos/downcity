/** Plugin manifest、Agent 引用与 Profile 配置编辑页。 */
import { useCallback, useEffect, useState } from "react";
import { TbChevronRight, TbComponents, TbSettings, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DetailEditorSidebar } from "@/components/DetailEditorSidebar";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import { PluginConfigForm } from "@/lib/plugin/PluginConfigForm";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginDefinition, DesktopPluginSummary } from "@common/types/DesktopApi";
import type { JsonObject } from "@downcity/agent";

/** Plugin 详情属性。 */
interface PluginViewProps { /** 当前 Plugin。 */ plugin: DesktopPluginSummary; /** Renderer 根控制器。 */ controller: DesktopViewController; }

/** 展示 Plugin 详情，并从右侧编辑 Profile。 */
export function PluginView({ plugin, controller }: PluginViewProps) {
  const [editor_open, set_editor_open] = useState(false);
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  const [profile_id, set_profile_id] = useState("");
  const [draft, set_draft] = useState<JsonObject>({});
  const [loading, set_loading] = useState(false);
  const [saving, set_saving] = useState(false);
  const [error, set_error] = useState("");

  const select_profile = useCallback((next_id: string, next_definition?: DesktopPluginDefinition) => {
    const current = next_definition ?? definition;
    set_profile_id(next_id);
    set_draft(structuredClone(current?.profiles[next_id] ?? current?.initial_config ?? {}));
  }, [definition]);
  const load_definition = useCallback(async () => {
    set_loading(true); set_error("");
    try { const next = await controller.get_plugin(plugin.plugin_id); set_definition(next); const next_id = profile_id && next.profiles[profile_id] ? profile_id : (Object.keys(next.profiles)[0] ?? ""); select_profile(next_id, next); }
    catch (reason) { set_error(to_error(reason)); } finally { set_loading(false); }
  }, [controller, plugin.plugin_id, profile_id, select_profile]);
  useEffect(() => { set_editor_open(false); set_definition(undefined); set_profile_id(""); set_draft({}); set_error(""); }, [plugin.plugin_id]);
  const save = async () => { set_saving(true); set_error(""); try { const next = await controller.save_plugin_profile(plugin.plugin_id, { profile_id, config: draft }); set_definition(next); select_profile(profile_id, next); } catch (reason) { set_error(to_error(reason)); } finally { set_saving(false); } };
  const remove = async () => { set_saving(true); set_error(""); try { const next = await controller.remove_plugin_profile(plugin.plugin_id, profile_id); set_definition(next); select_profile(Object.keys(next.profiles)[0] ?? "", next); } catch (reason) { set_error(to_error(reason)); } finally { set_saving(false); } };
  const open_editor = (next_profile_id = "") => { set_profile_id(next_profile_id); set_editor_open(true); if (!definition && !loading) void load_definition(); else if (definition) select_profile(next_profile_id); };

  return <div className="flex h-full min-h-0 min-w-0 flex-1 bg-background"><MainViewLayout><header className="header-drag-region flex h-10 items-center gap-2 px-3 text-xs"><TbComponents className="text-muted-foreground" /><span className="truncate font-medium text-foreground/80">{plugin.title}</span></header><MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[42rem] px-6 pb-12 pt-14">
    <div className="mb-9 flex items-start gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-muted-foreground"><TbComponents className="size-6" /></div><div className="min-w-0"><h1 className="text-lg font-semibold text-foreground">{plugin.title}</h1><p className="mt-1 text-xs leading-5 text-muted-foreground">{plugin.description || plugin.plugin_id}</p></div></div>
    <Group title="Plugin"><Row label="Plugin ID" value={plugin.plugin_id} /><Row label="Source" value={plugin.source === "builtin" ? "Official" : "Installed"} /><Row label="Version" value={plugin.version || "Built-in"} last /></Group>
    <Group title="Capabilities"><Row label="Enabled Agents" value={plugin.agent_ids.length ? plugin.agent_ids.join(", ") : "None"} />{plugin.configuration !== "none" ? <div className="divide-y divide-border/45">{plugin.profile_ids.map((id) => <button key={id} type="button" className="flex min-h-11 w-full items-center gap-3 px-3.5 text-left hover:bg-interaction-hover" onClick={() => open_editor(id)}><TbSettings className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span><TbChevronRight className="size-3.5 text-muted-foreground" /></button>)}<button type="button" className="flex min-h-11 w-full items-center gap-3 px-3.5 text-left text-primary hover:bg-interaction-hover" onClick={() => open_editor("")}><TbSettings className="size-4" /><span className="text-xs">添加新配置</span></button></div> : <Row label="Configuration" value="Not required" last />}</Group>
  </div></div></MainViewBody></MainViewLayout>{editor_open ? <PluginEditor definition={definition} profile_id={profile_id} draft={draft} loading={loading} saving={saving} error={error} select_profile={select_profile} set_profile_id={set_profile_id} set_draft={set_draft} save={save} remove={remove} reload={load_definition} close={() => set_editor_open(false)} /> : null}</div>;
}

/** Plugin 页面右侧的 Profile 编辑容器。 */
function PluginEditor(props: { /** 完整定义。 */ definition?: DesktopPluginDefinition; /** 当前 Profile ID。 */ profile_id: string; /** 配置草稿。 */ draft: JsonObject; /** 是否读取中。 */ loading: boolean; /** 是否提交中。 */ saving: boolean; /** 错误文本。 */ error: string; /** 选择 Profile。 */ select_profile(value: string): void; /** 修改 ID。 */ set_profile_id(value: string): void; /** 修改草稿。 */ set_draft(value: JsonObject): void; /** 保存。 */ save(): Promise<void>; /** 删除。 */ remove(): Promise<void>; /** 重载。 */ reload(): Promise<void>; /** 关闭。 */ close(): void }) {
  const { definition, profile_id, draft, loading, saving, error, select_profile, set_profile_id, set_draft, save, remove, reload, close } = props;
  const existing = Boolean(profile_id && definition?.profiles[profile_id]);
  return <DetailEditorSidebar title="Plugin Configuration" storage_key="downcity.plugin_editor_width" default_width={420} on_close={close} footer={<div className="flex flex-col items-center gap-2"><Button size="full" variant="primary" className="h-9 justify-center text-xs" disabled={!definition?.config_schema || !profile_id.trim() || loading || saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</Button><Button size="full" className="h-9 justify-center text-xs" disabled={loading || saving} onClick={() => void reload()}>取消</Button></div>}>
    {loading && !definition ? <div className="py-10 text-center text-xs text-muted-foreground">加载中…</div> : null}
    {definition ? <><div className="mb-4 flex gap-2"><select className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 font-mono text-xs" value={existing ? profile_id : ""} onChange={(event) => select_profile(event.target.value)}><option value="">新建 Profile</option>{Object.keys(definition.profiles).map((id) => <option key={id} value={id}>{id}</option>)}</select>{existing ? <Button aria-label="删除 Profile" title="删除 Profile" disabled={saving} onClick={() => void remove()}><TbTrash /></Button> : null}</div>{!existing ? <input autoFocus className="mb-4 h-8 w-full rounded-lg border border-input bg-background px-2.5 font-mono text-xs" value={profile_id} placeholder="Profile ID" onChange={(event) => set_profile_id(event.target.value)} /> : null}{definition.config_schema ? <PluginConfigForm key={existing ? profile_id : "new"} schema={definition.config_schema} value={draft} on_change={set_draft} /> : <div className="py-10 text-center text-xs text-muted-foreground">此 Plugin 不需要配置</div>}</> : null}{error ? <div className="mt-3 text-[0.6875rem] leading-4 text-destructive">{error}</div> : null}
  </DetailEditorSidebar>;
}

/** 设置式信息分组。 */
function Group({ title, children }: { /** 标题。 */ title: string; /** 内容。 */ children: React.ReactNode }) { return <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold">{title}</h2><div className="overflow-hidden rounded-lg bg-surface-subtle">{children}</div></section>; }
/** Plugin 文本属性行。 */
function Row({ label, value, last = false }: { /** 属性名。 */ label: string; /** 属性值。 */ value: string; /** 是否最后一行。 */ last?: boolean }) { return <div className={`grid min-h-11 grid-cols-[8rem_minmax(0,1fr)] items-center px-3.5 ${last ? "" : "border-b border-border/45"}`}><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right font-mono text-[0.6875rem] text-foreground/80">{value}</span></div>; }
/** 把未知错误转成可见文本。 */
function to_error(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
