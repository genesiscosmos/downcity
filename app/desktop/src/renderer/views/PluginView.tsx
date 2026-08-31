/** Plugin 专属 Mainview 页面。 */

import { useCallback, useEffect, useState } from "react";
import { TbChevronDown } from "react-icons/tb";
import type { PluginJsonValue } from "@downcity/plugin";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { PluginIcon } from "@/lib/plugin/PluginIcon";
import { PluginRendererHost } from "@/lib/plugin/PluginRendererHost";
import { Markdown } from "@/lib/markdown/Markdown";
import { cn } from "@/lib/utils";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginDefinition, DesktopPluginSummary } from "@common/types/DesktopApi";

/** 展示 Plugin 介绍与专属 Mainview，不承载 Config 或 Profile。 */
export function PluginView({ plugin, controller }: {
  /** 当前 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** Renderer 根控制器。 */ readonly controller: DesktopViewController;
}) {
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  const [error, set_error] = useState("");
  const get_plugin = controller.get_plugin;
  const invoke_plugin_action = controller.invoke_plugin_action;
  const load = useCallback(async () => {
    set_error("");
    try { set_definition(await get_plugin(plugin.plugin_id)); }
    catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
  }, [get_plugin, plugin.plugin_id]);
  useEffect(() => { void load(); }, [load]);
  const renderer = plugin.source === "builtin" ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id] : undefined;
  const invoke = useCallback((action_id: string, input?: PluginJsonValue) => invoke_plugin_action(plugin.plugin_id, {
    surface: "mainview",
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_plugin_action, plugin.plugin_id]);
  return <MainViewLayout>
    <MainViewHeader />
    <MainViewBody><main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-[90rem] flex-col gap-5 px-4 pb-8 pt-3 md:px-6 md:pb-10 md:pt-4">
        <PluginOverview plugin={definition ?? plugin} />
        {error ? <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <PluginRendererHost
          plugin_id={plugin.plugin_id}
          slot="mainview"
          capabilities={plugin}
          builtin_renderer={renderer}
          renderer_url={definition?.renderer_url}
          invoke_mainview={invoke}
          route={controller.plugin_route}
          navigate={controller.navigate_plugin}
        />
      </div>
    </main></MainViewBody>
  </MainViewLayout>;
}

/** 展示可折叠的 Plugin 身份与用户说明。 */
function PluginOverview({ plugin }: {
  /** 当前 Plugin 摘要与可选 README。 */ readonly plugin: DesktopPluginSummary & Partial<Pick<DesktopPluginDefinition, "readme">>;
}) {
  const [expanded, set_expanded] = useState(false);
  return <section className="min-w-0 overflow-hidden rounded-xl bg-surface-subtle">
    <div className="flex min-h-16 items-center gap-3 px-4 py-3.5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary"><PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} class_name="size-5" /></div>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-foreground">{plugin.title}</div><div className="mt-1 text-[10px] text-muted-foreground">{plugin.description}</div></div>
      {plugin.readme ? <button type="button" aria-expanded={expanded} onClick={() => set_expanded((current) => !current)} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-interaction-hover"><TbChevronDown className={cn("size-4 transition-transform", !expanded && "-rotate-90")} /></button> : null}
    </div>
    {expanded && plugin.readme ? <div className="border-t border-divider px-4 py-4"><Markdown text={plugin.readme} mode="static" class_name="plugin-readme !h-auto" /></div> : null}
  </section>;
}
