/** 设置中心内的 Plugin Config 与 Profile 管理页面。 */

import { useCallback, useEffect, useState } from "react";
import { TbPlus, TbTrash } from "react-icons/tb";
import type { PluginJsonValue } from "@downcity/plugin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PluginIcon } from "@/lib/plugin/PluginIcon";
import { PluginRendererHost } from "@/lib/plugin/PluginRendererHost";
import { cn } from "@/lib/utils";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginDefinition } from "@common/types/DesktopApi";

/** 只列出声明 Config 的 Plugin，并在选中 Profile 后渲染 Config。 */
export function PluginSettings({ controller }: { /** Renderer 根控制器。 */ readonly controller: DesktopViewController }) {
  const plugins = controller.plugins.filter((plugin) => plugin.has_config);
  const [plugin_id, set_plugin_id] = useState(plugins[0]?.plugin_id ?? "");
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  const [profile_id, set_profile_id] = useState("");
  const [dialog, set_dialog] = useState<"create" | "remove">();
  const [new_profile_id, set_new_profile_id] = useState("");
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");
  const get_plugin = controller.get_plugin;
  const invoke_plugin_action = controller.invoke_plugin_action;
  const plugin = plugins.find((item) => item.plugin_id === plugin_id) ?? plugins[0];
  const selected_plugin_id = plugin?.plugin_id ?? "";
  const load = useCallback(async () => {
    if (!selected_plugin_id) return;
    set_error("");
    try {
      const next = await get_plugin(selected_plugin_id);
      set_definition(next);
      set_profile_id((current) => next.profile_ids.includes(current) ? current : next.profile_ids[0] ?? "");
    } catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
  }, [get_plugin, selected_plugin_id]);
  useEffect(() => { void load(); }, [load]);

  const create_profile = async () => {
    if (!plugin || !new_profile_id.trim()) return;
    set_busy(true);
    try {
      const next = await controller.create_plugin_profile(plugin.plugin_id, { profile_id: new_profile_id });
      set_definition(next);
      set_profile_id(new_profile_id.trim().toLowerCase());
      set_new_profile_id("");
      set_dialog(undefined);
    } catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
    finally { set_busy(false); }
  };
  const remove_profile = async () => {
    if (!plugin || !profile_id) return;
    set_busy(true);
    try {
      const next = await controller.remove_plugin_profile(plugin.plugin_id, profile_id);
      set_definition(next);
      set_profile_id(next.profile_ids[0] ?? "");
      set_dialog(undefined);
    } catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
    finally { set_busy(false); }
  };
  const invoke_config = useCallback((action_id: string, input?: PluginJsonValue) => invoke_plugin_action(selected_plugin_id, {
    surface: "config",
    profile_id,
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_plugin_action, profile_id, selected_plugin_id]);
  if (!plugin) return <div className="rounded-lg bg-surface-subtle px-5 py-12 text-center text-xs text-muted-foreground">没有需要配置的 Plugin</div>;
  const renderer = plugin.source === "builtin" ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id] : undefined;
  return <div className="flex min-w-0 flex-col gap-5">
    <section><h2 className="mb-2 px-1 text-xs text-muted-foreground">Plugins</h2><div className="flex flex-wrap gap-2">{plugins.map((item) => <button key={item.plugin_id} type="button" onClick={() => { set_plugin_id(item.plugin_id); set_definition(undefined); set_profile_id(""); }} className={cn("flex h-9 items-center gap-2 rounded-lg px-3 text-xs", item.plugin_id === plugin.plugin_id ? "bg-interaction-selected text-foreground" : "bg-surface-subtle text-muted-foreground hover:bg-interaction-hover")}><PluginIcon plugin_id={item.plugin_id} icon_url={item.icon_url} />{item.title}</button>)}</div></section>
    <section className="overflow-hidden rounded-lg bg-surface-subtle">
      <div className="flex min-h-11 items-center border-b border-divider px-2">
        <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto">{definition?.profile_ids.map((id) => <button key={id} type="button" onClick={() => set_profile_id(id)} className={cn("relative h-10 shrink-0 px-3 text-xs after:absolute after:inset-x-2 after:bottom-0 after:h-0.5", id === profile_id ? "text-foreground after:bg-primary" : "text-muted-foreground after:bg-transparent")}>{id}</button>)}</div>
        <Button size="icon" title="新建 Profile" aria-label="新建 Profile" onClick={() => set_dialog("create")}><TbPlus /></Button>
        {profile_id ? <Button size="icon" title="删除 Profile" aria-label="删除 Profile" onClick={() => set_dialog("remove")}><TbTrash /></Button> : null}
      </div>
      <div className="p-4">{error ? <div className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}{profile_id ? <PluginRendererHost key={`${plugin.plugin_id}:${profile_id}`} plugin_id={plugin.plugin_id} slot="config" capabilities={plugin} builtin_renderer={renderer} renderer_url={definition?.renderer_url} invoke_mainview={async () => { throw new Error("Config cannot invoke Mainview actions"); }} invoke_config={invoke_config} /> : <div className="py-12 text-center text-xs text-muted-foreground">创建 Profile 后配置 {plugin.title}</div>}</div>
    </section>
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open) set_dialog(undefined); }}><DialogContent size="sm">{dialog === "create" ? <><DialogHeader><div><DialogTitle>新建 Profile</DialogTitle><DialogDescription>Profile 是 {plugin.title} 的独立配置空间。</DialogDescription></div></DialogHeader><DialogBody><input autoFocus value={new_profile_id} onChange={(event) => set_new_profile_id(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none" placeholder="default" /></DialogBody><DialogFooter><Button onClick={() => set_dialog(undefined)}>取消</Button><Button variant="primary" disabled={busy || !new_profile_id.trim()} onClick={() => void create_profile()}>创建</Button></DialogFooter></> : <><DialogHeader><div><DialogTitle>删除 Profile？</DialogTitle><DialogDescription>{plugin.plugin_id}/{profile_id} 的配置将被删除。</DialogDescription></div></DialogHeader><DialogFooter><Button onClick={() => set_dialog(undefined)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => void remove_profile()}>删除</Button></DialogFooter></>}</DialogContent></Dialog>
  </div>;
}
