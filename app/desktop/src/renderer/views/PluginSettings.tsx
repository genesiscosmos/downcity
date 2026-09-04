/** Plugin Catalog 详情页内的 Config 与 Profile 面板。 */

import { useCallback, useEffect, useState } from "react";
import { TbPlus, TbTrash } from "react-icons/tb";
import type { PluginJsonValue } from "@downcity/city/plugin";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PluginRendererHost } from "@/lib/plugin/PluginRendererHost";
import { cn } from "@/lib/utils";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginDefinition, DesktopPluginSummary } from "@common/types/DesktopApi";

/** 为一个声明 Config 的 Plugin 管理 Profile 并渲染配置正文。 */
export function PluginConfigPanel({ controller, plugin, definition, set_definition }: {
  /** Renderer 根控制器。 */ readonly controller: DesktopViewController;
  /** 当前 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** 已加载的完整 Plugin 定义。 */ readonly definition?: DesktopPluginDefinition;
  /** 更新详情页持有的 Plugin 定义。 */ readonly set_definition: (definition: DesktopPluginDefinition) => void;
}) {
  const [profile_id, set_profile_id] = useState("");
  const [dialog, set_dialog] = useState<"create" | "remove">();
  const [new_profile_id, set_new_profile_id] = useState("");
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");
  const invoke_plugin_action = controller.invoke_plugin_action;
  useEffect(() => {
    set_profile_id((current) => definition?.profile_ids.includes(current) ? current : definition?.profile_ids[0] ?? "");
  }, [definition]);
  const create_profile = async () => {
    if (!new_profile_id.trim()) return;
    set_busy(true);
    try {
      const next = await controller.create_plugin_profile(plugin.plugin_id, { profile_id: new_profile_id });
      set_definition(next);
      set_profile_id(new_profile_id.trim().toLowerCase());
      set_new_profile_id("");
      set_dialog(undefined);
    } catch (reason) { set_error(to_error_message(reason)); }
    finally { set_busy(false); }
  };
  const remove_profile = async () => {
    if (!profile_id) return;
    set_busy(true);
    try {
      const next = await controller.remove_plugin_profile(plugin.plugin_id, profile_id);
      set_definition(next);
      set_profile_id(next.profile_ids[0] ?? "");
      set_dialog(undefined);
    } catch (reason) { set_error(to_error_message(reason)); }
    finally { set_busy(false); }
  };
  const invoke_config = useCallback((action_id: string, input?: PluginJsonValue) => invoke_plugin_action(plugin.plugin_id, {
    surface: "config",
    profile_id,
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_plugin_action, plugin.plugin_id, profile_id]);
  const renderer = plugin.source === "builtin" ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id] : undefined;
  return <section className="overflow-hidden rounded-xl bg-surface-subtle">
    <div className="flex min-h-11 items-center border-b border-divider px-2">
      <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto">{definition?.profile_ids.map((id) => <button key={id} type="button" onClick={() => set_profile_id(id)} className={cn("relative h-10 shrink-0 px-3 text-xs after:absolute after:inset-x-2 after:bottom-0 after:h-0.5", id === profile_id ? "text-foreground after:bg-primary" : "text-muted-foreground after:bg-transparent")}>{id}</button>)}</div>
      <Button size="icon" title="新建 Profile" aria-label="新建 Profile" onClick={() => set_dialog("create")}><TbPlus /></Button>
      {profile_id ? <Button size="icon" title="删除 Profile" aria-label="删除 Profile" onClick={() => set_dialog("remove")}><TbTrash /></Button> : null}
    </div>
    <div className="p-4">{error ? <div className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}{profile_id ? <PluginRendererHost key={`${plugin.plugin_id}:${profile_id}`} plugin_id={plugin.plugin_id} slot="config" capabilities={plugin} builtin_renderer={renderer} renderer_url={definition?.renderer_url} invoke_mainview={async () => { throw new Error("Config cannot invoke workspace actions"); }} invoke_config={invoke_config} /> : <div className="py-12 text-center text-xs text-muted-foreground">创建 Profile 后配置 {plugin.title}</div>}</div>
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open) set_dialog(undefined); }}><DialogContent size="sm">{dialog === "create" ? <><DialogHeader><div><DialogTitle>新建 Profile</DialogTitle><DialogDescription>Profile 是 {plugin.title} 的独立配置空间。</DialogDescription></div></DialogHeader><DialogBody><input autoFocus value={new_profile_id} onChange={(event) => set_new_profile_id(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none" placeholder="default" /></DialogBody><DialogFooter><Button onClick={() => set_dialog(undefined)}>取消</Button><Button variant="primary" disabled={busy || !new_profile_id.trim()} onClick={() => void create_profile()}>创建</Button></DialogFooter></> : <><DialogHeader><div><DialogTitle>删除 Profile？</DialogTitle><DialogDescription>{plugin.plugin_id}/{profile_id} 的配置将被删除。</DialogDescription></div></DialogHeader><DialogFooter><Button onClick={() => set_dialog(undefined)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => void remove_profile()}>删除</Button></DialogFooter></>}</DialogContent></Dialog>
  </section>;
}

/** 把未知失败转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
